import { sql } from '../db/pool.js';

// Every received batch of the given items with what's left of it:
// received (Stock In) - returned to the vendor (Return) - sold
// (less what customers brought back on a Sales Return).
// SelAmount, MRP and PurchaseRate (P.Rate less Disc%) are the batch's pack
// prices from its latest Stock In line, else MRP and In price from its latest
// Adjust In. A batch is the item + its batch number ('' when it had none), the
// same key returns and sales record. `excludeSaleId` leaves one sale out of
// "sold", so editing a sale can reuse the stock it already took;
// `excludeAdjustmentId` likewise leaves one Stock Adjustment out.
// Stock Adjustments count too: Adjust In as received, Adjust Out as returned.
// Earliest expiry first; batches without an expiry go last.
export async function batchStock(request, itemIds, { excludeSaleId = null, excludeAdjustmentId = null } = {}) {
  const ids = [...new Set(itemIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const result = await request
    .input('bsIds', sql.NVarChar(sql.MAX), ids.join(','))
    .input('bsExclude', sql.Int, excludeSaleId)
    .input('bsExcludeAdj', sql.Int, excludeAdjustmentId)
    .query(`
      WITH Ids AS (SELECT CAST(value AS INT) AS ItemId FROM STRING_SPLIT(@bsIds, ',')),
      Received AS (
        SELECT l.ItemId, l.BatchNo AS Batch, l.ExpDate AS ExpiryDate, l.Quantity + l.FreeQty AS Quantity
        FROM StockInItem l JOIN StockIn h ON h.StockInId = l.StockInId AND h.IsActive = 1
        WHERE l.ItemId IN (SELECT ItemId FROM Ids)
        UNION ALL
        -- Stock Adjustment: Adjust In counts as received into its batch.
        SELECT al.ItemId, al.BatchNo, NULL, al.InQty
        FROM StockAdjustmentItem al JOIN StockAdjustment ah ON ah.AdjustmentId = al.AdjustmentId AND ah.IsActive = 1
        WHERE al.InQty > 0 AND al.ItemId IN (SELECT ItemId FROM Ids)
          AND (@bsExcludeAdj IS NULL OR ah.AdjustmentId <> @bsExcludeAdj)
      ),
      Rcv AS (
        SELECT ItemId, Batch, MIN(ExpiryDate) AS ExpiryDate, SUM(Quantity) AS Qty
        FROM Received GROUP BY ItemId, Batch
      ),
      Returned AS (
        SELECT ri.ItemId, ri.BatchNo AS Batch, ri.Quantity
        FROM StockReturnItem ri JOIN StockReturn rh ON rh.StockReturnId = ri.StockReturnId AND rh.IsActive = 1
        WHERE ri.ItemId IN (SELECT ItemId FROM Ids)
        UNION ALL
        -- Stock Adjustment: Adjust Out takes from its batch.
        SELECT al.ItemId, al.BatchNo, al.OutQty
        FROM StockAdjustmentItem al JOIN StockAdjustment ah ON ah.AdjustmentId = al.AdjustmentId AND ah.IsActive = 1
        WHERE al.OutQty > 0 AND al.ItemId IN (SELECT ItemId FROM Ids)
          AND (@bsExcludeAdj IS NULL OR ah.AdjustmentId <> @bsExcludeAdj)
      ),
      Ret AS (SELECT ItemId, Batch, SUM(Quantity) AS Qty FROM Returned GROUP BY ItemId, Batch),
      Sold AS (
        SELECT ItemId, Batch, SUM(Qty) AS Qty FROM (
          SELECT sbi.ItemId, ISNULL(sbi.Batch, '') AS Batch, sbi.Quantity AS Qty
          FROM SalesBillingItem sbi
          JOIN SalesBilling sb ON sb.SalesBillingId = sbi.SalesBillingId AND sb.IsActive = 1
          WHERE sbi.ItemId IN (SELECT ItemId FROM Ids)
            AND (@bsExclude IS NULL OR sb.SalesBillingId <> @bsExclude)
          UNION ALL
          -- Sales Returns put stock back, so they count as negative sales.
          SELECT sri.ItemId, ISNULL(sri.Batch, ''), -sri.Quantity
          FROM SalesReturnItem sri
          JOIN SalesReturn sr ON sr.SalesReturnId = sri.SalesReturnId AND sr.IsActive = 1
          WHERE sri.ItemId IN (SELECT ItemId FROM Ids)
        ) s GROUP BY ItemId, Batch
      )
      SELECT r.ItemId, r.Batch, r.ExpiryDate, r.Qty AS ReceivedQty,
             ISNULL(ret.Qty, 0) AS ReturnedQty, ISNULL(s.Qty, 0) AS SoldQty,
             r.Qty - ISNULL(ret.Qty, 0) - ISNULL(s.Qty, 0) AS AvailableQty, sel.SelAmount,
             ISNULL(sel.MRP, adj.MRP) AS MRP, ISNULL(sel.PurchaseRate, adj.PurchaseRate) AS PurchaseRate
      FROM Rcv r
      LEFT JOIN Ret ret ON ret.ItemId = r.ItemId AND ret.Batch = r.Batch
      LEFT JOIN Sold s ON s.ItemId = r.ItemId AND s.Batch = r.Batch
      OUTER APPLY (
        SELECT TOP 1 l.SelAmount, l.MRP, l.Rate AS PurchaseRate FROM StockInItem l JOIN StockIn h ON h.StockInId = l.StockInId AND h.IsActive = 1
        WHERE l.ItemId = r.ItemId AND l.BatchNo = r.Batch ORDER BY h.StockInId DESC
      ) sel
      -- A batch no Stock In priced (e.g. started by an Adjust In) takes its
      -- latest adjustment's MRP and In price.
      OUTER APPLY (
        SELECT TOP 1 al.MRP, NULLIF(al.InPrice, 0) AS PurchaseRate FROM StockAdjustmentItem al
        JOIN StockAdjustment ah ON ah.AdjustmentId = al.AdjustmentId AND ah.IsActive = 1
        WHERE al.ItemId = r.ItemId AND al.BatchNo = r.Batch AND al.InQty > 0 ORDER BY ah.AdjustmentId DESC
      ) adj
      ORDER BY r.ItemId, CASE WHEN r.ExpiryDate IS NULL THEN 1 ELSE 0 END, r.ExpiryDate, r.Batch
    `);
  return result.recordset.map((r) => ({
    ...r,
    ReceivedQty: Number(r.ReceivedQty),
    ReturnedQty: Number(r.ReturnedQty),
    SoldQty: Number(r.SoldQty),
    AvailableQty: Number(r.AvailableQty),
    SelAmount: r.SelAmount == null ? null : Number(r.SelAmount),
    MRP: r.MRP == null ? null : Number(r.MRP),
    PurchaseRate: r.PurchaseRate == null ? null : Number(r.PurchaseRate),
  }));
}
