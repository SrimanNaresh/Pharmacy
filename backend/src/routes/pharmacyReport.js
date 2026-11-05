import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNoSql } from '../utils/docNumber.js';
import { EVENTS } from '../utils/stockEvents.js';
import allInOneRoutes from './allInOneReport.js';

// Pharmacy > Report: Stock Report (item-wise, with each item's history) and
// Vendor Payments. Both read the documents themselves, so they always agree
// with the documents as they are now, later edits included.
const router = Router();

// ?search (name / code / generic), ?category, ?show = history (default) |
// instock | outofstock | all. Current = Opening + Stock In - Return - Sold + Adjustment.
router.get('/stock', async (req, res) => {
  try {
    const { search = '', category = '', show = 'history' } = req.query;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('itemId', sql.Int, null)
      .input('search', sql.NVarChar, `%${search}%`)
      .input('category', sql.NVarChar, category)
      .query(`
        WITH Ev AS (${EVENTS}),
        Totals AS (
          SELECT ItemId,
                 SUM(CASE WHEN Kind = 'opening' THEN Qty ELSE 0 END) AS Opening,
                 SUM(CASE WHEN Kind = 'purchase' THEN Qty ELSE 0 END) AS StockIn,
                 -SUM(CASE WHEN Kind = 'return' THEN Qty ELSE 0 END) AS Returned,
                 -SUM(CASE WHEN Kind IN ('issue', 'sales-return') THEN Qty ELSE 0 END) AS Sold,
                 SUM(CASE WHEN Kind = 'adjustment' THEN Qty ELSE 0 END) AS Adjustment,
                 SUM(Qty) AS CurrentStock,
                 COUNT(*) AS Events
          FROM Ev GROUP BY ItemId
        )
        SELECT i.ItemId, 'ITM' + RIGHT('000000' + CAST(i.ItemId AS VARCHAR(10)), 6) AS ItemCode, i.Name AS ItemName,
               i.Category, i.Pack, g.Name AS GenericName,
               ISNULL(t.Opening, 0) AS Opening, ISNULL(t.StockIn, 0) AS StockIn, ISNULL(t.Returned, 0) AS Returned,
               ISNULL(t.Sold, 0) AS Sold, ISNULL(t.Adjustment, 0) AS Adjustment, ISNULL(t.CurrentStock, 0) AS CurrentStock,
               ISNULL(i.SellPrice, i.MRP) AS SellPrice,
               ISNULL(t.CurrentStock, 0) * ISNULL(ISNULL(i.SellPrice, i.MRP), 0) AS StockValue,
               ISNULL(t.Events, 0) AS Events
        FROM PharmacyItem i
        LEFT JOIN Totals t ON t.ItemId = i.ItemId
        LEFT JOIN GenericNameMaster g ON g.GenericNameId = i.GenericNameId
        WHERE i.IsActive = 1
          AND (@search = '%%' OR i.Name LIKE @search OR g.Name LIKE @search
               OR 'ITM' + RIGHT('000000' + CAST(i.ItemId AS VARCHAR(10)), 6) LIKE @search)
          AND (@category = '' OR i.Category = @category)
        ORDER BY i.Name
      `);
    const keep = {
      history: (r) => r.Events > 0,
      instock: (r) => r.CurrentStock > 0,
      outofstock: (r) => r.Events > 0 && r.CurrentStock <= 0,
      all: () => true,
    }[show] || ((r) => r.Events > 0);
    res.json(result.recordset.filter(keep));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One item's stock history, oldest first, with the stock after each change.
router.get('/stock/:itemId/history', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('itemId', sql.Int, req.params.itemId)
      .query(`
        WITH Ev AS (${EVENTS})
        SELECT Kind, Qty, At, DocDate, Details, VendorName, ByUser, RefType, RefId,
               SUM(Qty) OVER (ORDER BY At, RefType, RefId ROWS UNBOUNDED PRECEDING) AS BalanceAfter
        FROM Ev
        ORDER BY At, RefType, RefId
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stock Ins and Returns per vendor, optionally between ?from and ?to
// (YYYY-MM-DD, either may be left out).
// Stock In: Amount = Qty x Cur.Rate, GST from its order line's CGST + SGST %.
// Return: Amount = Qty x Cur.Rate, GST % of the Stock In line it came from.
// Free units aren't paid for: a Stock In charges only its paid Quantity, and
// a return is credited at the Stock In line's rate spread over its paid +
// free units (the returned units may have been free ones).
const DOCS = `
  SELECT h.VendorId, 'stock-in' AS Type, h.StockInId AS DocId, ${docNoSql('SI', 'h.StockInId')} AS DocNo,
         h.InDate AS DocDate, ${docNoSql('PO', 'h.PurchaseOrderId')} AS Against,
         i.Name AS ItemName, l.Quantity AS Qty,
         ROUND(l.Quantity * l.Rate, 2) AS Amount,
         pol.CGSTPercent + pol.SGSTPercent AS GSTPercent
  FROM StockInItem l
  JOIN StockIn h ON h.StockInId = l.StockInId AND h.IsActive = 1
  JOIN PurchaseOrderItem pol ON pol.LineId = l.PoLineId
  JOIN PharmacyItem i ON i.ItemId = l.ItemId
  UNION ALL
  SELECT h.VendorId, 'return', h.StockReturnId, ${docNoSql('RT', 'h.StockReturnId')},
         h.ReturnDate, ${docNoSql('SI', 'h.StockInId')},
         i.Name, l.Quantity, ROUND(l.Quantity * l.Rate * sl.Quantity / (sl.Quantity + sl.FreeQty), 2),
         pol.CGSTPercent + pol.SGSTPercent
  FROM StockReturnItem l
  JOIN StockReturn h ON h.StockReturnId = l.StockReturnId AND h.IsActive = 1
  JOIN StockInItem sl ON sl.LineId = l.StockInLineId
  JOIN PurchaseOrderItem pol ON pol.LineId = sl.PoLineId
  JOIN PharmacyItem i ON i.ItemId = l.ItemId
`;

const dateOrNull = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);

function docsRequest(pool, req) {
  return pool.request()
    .input('from', sql.Date, dateOrNull(req.query.from))
    .input('to', sql.Date, dateOrNull(req.query.to));
}

router.get('/vendor-payments', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await docsRequest(pool, req).query(`
      WITH D AS (
        SELECT *, ROUND(Amount * GSTPercent / 100, 2) AS GST FROM (${DOCS}) x
        WHERE (@from IS NULL OR DocDate >= @from) AND (@to IS NULL OR DocDate <= @to)
      )
      SELECT v.VendorId, v.VendorName, v.ContactNo AS MobileNo,
             COUNT(DISTINCT CASE WHEN D.Type = 'stock-in' THEN D.Type + CAST(D.DocId AS VARCHAR(10)) END) AS StockInCount,
             SUM(CASE WHEN D.Type = 'stock-in' THEN D.Amount ELSE 0 END) AS StockInAmount,
             SUM(CASE WHEN D.Type = 'stock-in' THEN D.GST ELSE 0 END) AS StockInGST,
             SUM(CASE WHEN D.Type = 'stock-in' THEN D.Amount + D.GST ELSE 0 END) AS StockInTotal,
             COUNT(DISTINCT CASE WHEN D.Type = 'return' THEN D.Type + CAST(D.DocId AS VARCHAR(10)) END) AS ReturnCount,
             SUM(CASE WHEN D.Type = 'return' THEN D.Amount + D.GST ELSE 0 END) AS ReturnTotal
      FROM D JOIN Vendor v ON v.VendorId = D.VendorId
      GROUP BY v.VendorId, v.VendorName, v.ContactNo
      ORDER BY v.VendorName
    `);
    res.json(result.recordset.map((r) => ({ ...r, NetPayable: Number(r.StockInTotal) - Number(r.ReturnTotal) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One vendor's Stock Ins and Returns, one row per document, newest first.
router.get('/vendor-payments/:vendorId', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await docsRequest(pool, req)
      .input('vendorId', sql.Int, req.params.vendorId)
      .query(`
        WITH D AS (
          SELECT *, ROUND(Amount * GSTPercent / 100, 2) AS GST FROM (${DOCS}) x
          WHERE VendorId = @vendorId
            AND (@from IS NULL OR DocDate >= @from) AND (@to IS NULL OR DocDate <= @to)
        )
        SELECT Type, DocId, DocNo, DocDate, MAX(Against) AS Against,
               STRING_AGG(ItemName, ', ') AS ItemNames, COUNT(*) AS Items, SUM(Qty) AS Qty,
               SUM(Amount) AS Amount, SUM(GST) AS GST, SUM(Amount + GST) AS Total
        FROM D
        GROUP BY Type, DocId, DocNo, DocDate
        ORDER BY DocDate DESC, DocId DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All in One: any screen, with the columns picked.
router.use('/all-in-one', allInOneRoutes);

export default router;
