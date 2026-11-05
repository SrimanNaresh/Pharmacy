import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNo, docNoSql } from '../utils/docNumber.js';
import { batchStock } from '../utils/batchStock.js';
import { round2 } from '../utils/purchaseCalc.js';

// Pharmacy > Return: goods sent back to the vendor from one Stock In. Saving
// lowers stock (read from these rows, see utils/batchStock.js). A line can't
// return more than its Stock In line received less what earlier returns took,
// and no batch may go below zero.
const router = Router();

const RT_NO = docNoSql('RT', 'h.StockReturnId');
const SI_NO = docNoSql('SI', 'si.StockInId');
const PO_NO = docNoSql('PO', 'po.PurchaseOrderId');
const text = (v) => (v == null ? '' : String(v).trim());

const lockStock = (tx) => new sql.Request(tx).query(
  "EXEC sp_getapplock @Resource = 'pharmacy-stock', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000",
);

// A vendor's Stock Ins for the Stock In No drop-down.
router.get('/stock-ins', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().input('vendorId', sql.Int, Number(req.query.vendorId) || 0).query(`
      SELECT si.StockInId, ${SI_NO} AS StockInNo, si.InDate, ${PO_NO} AS OrderNo
      FROM StockIn si JOIN PurchaseOrder po ON po.PurchaseOrderId = si.PurchaseOrderId
      WHERE si.IsActive = 1 AND si.VendorId = @vendorId ORDER BY si.StockInId DESC`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A Stock In's lines with what other returns (not ?excludeReturnId=) took and what's left.
async function stockInLines(request, stockInId, excludeReturnId) {
  const r = await request.input('stockInId', sql.Int, stockInId).input('exclude', sql.Int, excludeReturnId || null).query(`
    SELECT l.LineId AS StockInLineId, l.ItemId, i.Name AS ItemName, l.BatchNo, l.MfgDate, l.ExpDate, l.Rate, l.Quantity + l.FreeQty AS Received,
           ISNULL((SELECT SUM(ri.Quantity) FROM StockReturnItem ri JOIN StockReturn rh ON rh.StockReturnId = ri.StockReturnId AND rh.IsActive = 1
                   WHERE ri.StockInLineId = l.LineId AND (@exclude IS NULL OR rh.StockReturnId <> @exclude)), 0) AS Returned
    FROM StockInItem l JOIN PharmacyItem i ON i.ItemId = l.ItemId
    WHERE l.StockInId = @stockInId ORDER BY l.LineId`);
  return r.recordset.map((l) => ({ ...l, Received: Number(l.Received), Returned: Number(l.Returned), Left: Number(l.Received) - Number(l.Returned) }));
}

router.get('/stock-in-lines/:stockInId', async (req, res) => {
  try {
    const pool = await getPool();
    res.json(await stockInLines(pool.request(), Number(req.params.stockInId), Number(req.query.excludeReturnId) || null));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pool = await getPool();
    const r = await pool.request().input('search', sql.NVarChar, `%${search}%`).query(`
      SELECT h.StockReturnId, ${RT_NO} AS ReturnNo, h.ReturnDate, v.VendorName, ${SI_NO} AS StockInNo, h.TotalAmount,
             li.ItemNames, li.Items, li.TotalQty
      FROM StockReturn h
      JOIN Vendor v ON v.VendorId = h.VendorId
      JOIN StockIn si ON si.StockInId = h.StockInId
      OUTER APPLY (
        SELECT STRING_AGG(i.Name, ', ') WITHIN GROUP (ORDER BY l.LineId) AS ItemNames, COUNT(*) AS Items, SUM(l.Quantity) AS TotalQty
        FROM StockReturnItem l JOIN PharmacyItem i ON i.ItemId = l.ItemId WHERE l.StockReturnId = h.StockReturnId
      ) li
      WHERE h.IsActive = 1
        AND (@search = '%%' OR v.VendorName LIKE @search OR ${RT_NO} LIKE @search OR ${SI_NO} LIKE @search OR li.ItemNames LIKE @search)
      ORDER BY h.StockReturnId DESC`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const head = await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT h.StockReturnId, ${RT_NO} AS ReturnNo, h.ReturnDate, h.VendorId, h.StockInId, ${SI_NO} AS StockInNo, h.TotalAmount
      FROM StockReturn h JOIN StockIn si ON si.StockInId = h.StockInId
      WHERE h.StockReturnId = @id AND h.IsActive = 1`);
    if (!head.recordset.length) return res.status(404).json({ error: 'Return not found' });
    const lines = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM StockReturnItem WHERE StockReturnId = @id ORDER BY LineId');
    res.json({ ...head.recordset[0], lines: lines.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function checkReturn(tx, body, returnId) {
  const returnDate = text(body.returnDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || Number.isNaN(Date.parse(returnDate))) return { error: 'Date is required' };
  const vendorId = Number(body.vendorId);
  if (!(vendorId > 0)) return { error: 'Vendor Name is required' };
  const stockInId = Number(body.stockInId);
  if (!(stockInId > 0)) return { error: 'Stock In No is required' };
  const si = await new sql.Request(tx).input('id', sql.Int, stockInId).query('SELECT VendorId FROM StockIn WHERE StockInId = @id AND IsActive = 1');
  if (!si.recordset.length) return { error: 'Stock In not found' };
  if (si.recordset[0].VendorId !== vendorId) return { error: "That Stock In isn't from this vendor" };

  const left = new Map((await stockInLines(new sql.Request(tx), stockInId, returnId)).map((l) => [l.StockInLineId, l]));
  const lines = [];
  for (const l of Array.isArray(body.lines) ? body.lines : []) {
    const qty = text(l.quantity) === '' ? 0 : Number(l.quantity);
    if (qty === 0) continue;
    const s = left.get(Number(l.stockInLineId));
    if (!s) return { error: "A line isn't on this Stock In" };
    if (!(qty > 0)) return { error: `${s.ItemName}: Return Qty must be more than 0` };
    if (qty > s.Left) return { error: `${s.ItemName} (batch ${s.BatchNo}): only ${s.Left} can still be returned` };
    lines.push({ stockInLineId: s.StockInLineId, itemId: s.ItemId, batch: s.BatchNo, mfg: s.MfgDate, exp: s.ExpDate, rate: Number(s.Rate), qty, amount: round2(qty * Number(s.Rate)) });
  }
  if (!lines.length) return { error: 'Enter a Return Qty on at least one line' };
  return { returnDate, vendorId, stockInId, lines, total: round2(lines.reduce((t, l) => t + l.amount, 0)) };
}

async function saveReturn(req, res, returnId) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await lockStock(tx);
    const r = await checkReturn(tx, req.body || {}, returnId);
    if (r.error) { await tx.rollback(); return res.status(400).json({ error: r.error }); }
    const head = new sql.Request(tx).input('date', sql.Date, r.returnDate).input('vendorId', sql.Int, r.vendorId)
      .input('stockInId', sql.Int, r.stockInId).input('total', sql.Decimal(12, 2), r.total);
    let id = returnId;
    if (returnId) {
      const upd = await head.input('id', sql.Int, returnId).query(`
        UPDATE StockReturn SET ReturnDate = @date, VendorId = @vendorId, StockInId = @stockInId, TotalAmount = @total
        WHERE StockReturnId = @id AND IsActive = 1`);
      if (!upd.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: 'Return not found' }); }
      await new sql.Request(tx).input('id', sql.Int, returnId).query('DELETE FROM StockReturnItem WHERE StockReturnId = @id');
    } else {
      const ins = await head.input('by', sql.NVarChar(100), req.user?.username || null).query(`
        INSERT INTO StockReturn (ReturnDate, VendorId, StockInId, TotalAmount, CreatedBy)
        OUTPUT INSERTED.StockReturnId VALUES (@date, @vendorId, @stockInId, @total, @by)`);
      id = ins.recordset[0].StockReturnId;
    }
    for (const l of r.lines) {
      await new sql.Request(tx)
        .input('id', sql.Int, id).input('lineId', sql.Int, l.stockInLineId).input('itemId', sql.Int, l.itemId)
        .input('batch', sql.NVarChar(50), l.batch).input('mfg', sql.Date, l.mfg).input('exp', sql.Date, l.exp)
        .input('rate', sql.Decimal(10, 2), l.rate).input('qty', sql.Decimal(10, 2), l.qty).input('amount', sql.Decimal(12, 2), l.amount)
        .query(`INSERT INTO StockReturnItem (StockReturnId, StockInLineId, ItemId, BatchNo, MfgDate, ExpDate, Rate, Quantity, Amount)
                VALUES (@id, @lineId, @itemId, @batch, @mfg, @exp, @rate, @qty, @amount)`);
    }
    // Stock can't go below zero: a batch already sold can't be returned as well.
    const short = (await batchStock(new sql.Request(tx), r.lines.map((l) => l.itemId)))
      .find((b) => b.AvailableQty < 0 && r.lines.some((l) => l.itemId === b.ItemId && l.batch === b.Batch));
    if (short) {
      await tx.rollback();
      return res.status(400).json({ error: `Batch ${short.Batch}: only ${short.AvailableQty + r.lines.filter((l) => l.itemId === short.ItemId && l.batch === short.Batch).reduce((t, l) => t + l.qty, 0)} left in stock to return` });
    }
    await tx.commit();
    res.status(returnId ? 200 : 201).json({ StockReturnId: id, ReturnNo: docNo('RT', id), TotalAmount: r.total });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  }
}

router.post('/', (req, res) => saveReturn(req, res, null));
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!(id > 0)) return res.status(400).json({ error: 'Bad return id' });
  return saveReturn(req, res, id);
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can delete a return' });
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).query('UPDATE StockReturn SET IsActive = 0 WHERE StockReturnId = @id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
