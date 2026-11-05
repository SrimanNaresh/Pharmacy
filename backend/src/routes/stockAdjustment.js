import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNo, docNoSql } from '../utils/docNumber.js';
import { batchStock } from '../utils/batchStock.js';

// Pharmacy > Stock In > Adjustment: corrects a batch's stock. Adjust In adds
// to the batch (a batch number not seen before starts a new batch), Adjust
// Out takes from it, each at its own price per pack; MRP is per pack too. Stock is read from these
// rows (utils/batchStock.js); no batch may go below zero. Delete is a soft
// delete (IsActive = 0), Admin only.
const router = Router();

const ADJ_NO = docNoSql('ADJ', 'h.AdjustmentId');
const round2 = (n) => Math.round(n * 100) / 100;
const text = (v) => (v == null ? '' : String(v).trim());
const qtyOf = (v) => (text(v) === '' ? 0 : Number(v));

const lockStock = (tx) => new sql.Request(tx).query(
  "EXEC sp_getapplock @Resource = 'pharmacy-stock', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000",
);

// An item's batches (with or without stock left) and its purchase price, for
// the Batch box and the suggested price. ?excludeAdjustmentId= leaves that
// adjustment out of Cur Stock, so editing it shows the stock before it.
router.get('/batches/:itemId', async (req, res) => {
  try {
    const pool = await getPool();
    const itemId = Number(req.params.itemId);
    const item = (await pool.request().input('id', sql.Int, itemId).query('SELECT PurchaseRate, MRP FROM PharmacyItem WHERE ItemId = @id')).recordset[0];
    const batches = await batchStock(pool.request(), [itemId], { excludeAdjustmentId: Number(req.query.excludeAdjustmentId) || null });
    const numOrNull = (v) => (v == null ? null : Number(v));
    res.json({
      purchaseRate: numOrNull(item?.PurchaseRate),
      mrp: numOrNull(item?.MRP),
      batches: batches.map((b) => ({ Batch: b.Batch, ExpiryDate: b.ExpiryDate, CurStock: b.AvailableQty, PurchaseRate: b.PurchaseRate, MRP: b.MRP })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pool = await getPool();
    const r = await pool.request().input('search', sql.NVarChar, `%${search}%`).query(`
      SELECT h.AdjustmentId, ${ADJ_NO} AS AdjNo, h.AdjDate, h.Remarks, h.InTotal, h.OutTotal,
             li.ItemNames, li.Items, li.InQty, li.OutQty
      FROM StockAdjustment h
      OUTER APPLY (
        SELECT STRING_AGG(i.Name, ', ') WITHIN GROUP (ORDER BY l.LineId) AS ItemNames, COUNT(*) AS Items,
               SUM(l.InQty) AS InQty, SUM(l.OutQty) AS OutQty
        FROM StockAdjustmentItem l JOIN PharmacyItem i ON i.ItemId = l.ItemId WHERE l.AdjustmentId = h.AdjustmentId
      ) li
      WHERE h.IsActive = 1
        AND (@search = '%%' OR ${ADJ_NO} LIKE @search OR h.Remarks LIKE @search OR li.ItemNames LIKE @search)
      ORDER BY h.AdjustmentId DESC`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const head = await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT h.AdjustmentId, ${ADJ_NO} AS AdjNo, h.AdjDate, h.Remarks, h.InTotal, h.OutTotal
      FROM StockAdjustment h WHERE h.AdjustmentId = @id AND h.IsActive = 1`);
    if (!head.recordset.length) return res.status(404).json({ error: 'Adjustment not found' });
    const lines = await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT l.LineId, l.ItemId, i.Name AS ItemName, l.BatchNo, l.CurStock, l.MRP, l.InQty, l.InPrice, l.OutQty, l.OutPrice
      FROM StockAdjustmentItem l JOIN PharmacyItem i ON i.ItemId = l.ItemId
      WHERE l.AdjustmentId = @id ORDER BY l.LineId`);
    res.json({ ...head.recordset[0], lines: lines.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checks an adjustment body against the stock. Returns { error } or the
// cleaned adjustment; Cur Stock and totals are worked out here.
async function checkAdjustment(tx, body, adjId) {
  const adjDate = text(body.adjDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(adjDate) || Number.isNaN(Date.parse(adjDate))) return { error: 'Date is required' };
  const remarks = text(body.remarks);
  if (remarks.length > 300) return { error: 'Remarks must be at most 300 characters' };

  // Rows with nothing picked are ignored; anything half-filled is an error.
  const raw = (Array.isArray(body.lines) ? body.lines : []).filter((l) => l && (l.itemId || qtyOf(l.inQty) || qtyOf(l.outQty)));
  if (!raw.length) return { error: 'Add at least one item' };
  const ids = [...new Set(raw.map((l) => Number(l.itemId)).filter(Boolean))];
  const items = new Map();
  if (ids.length) {
    const found = await new sql.Request(tx).input('ids', sql.NVarChar(sql.MAX), ids.join(','))
      .query('SELECT ItemId, Name FROM PharmacyItem WHERE IsActive = 1 AND ItemId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, \',\'))');
    for (const r of found.recordset) items.set(r.ItemId, r);
  }
  const stock = await batchStock(new sql.Request(tx), ids, { excludeAdjustmentId: adjId });
  const curOf = (itemId, batch) => stock.find((b) => b.ItemId === itemId && b.Batch === batch)?.AvailableQty ?? 0;

  const lines = [];
  const outBy = new Map(); // "itemId|batch" -> Adjust Out across lines
  for (const [i, l] of raw.entries()) {
    const item = items.get(Number(l.itemId));
    const row = `Row ${i + 1}${item ? ` (${item.Name})` : ''}`;
    if (!item) return { error: `Row ${i + 1}: pick an item` };
    const batch = text(l.batch);
    if (batch.length > 100) return { error: `${row}: Batch must be at most 100 characters` };
    const inQty = qtyOf(l.inQty);
    const outQty = qtyOf(l.outQty);
    const inPrice = qtyOf(l.inPrice);
    const outPrice = qtyOf(l.outPrice);
    const mrp = text(l.mrp) === '' ? null : Number(l.mrp);
    if ([inQty, outQty, inPrice, outPrice, mrp ?? 0].some((n) => !(n >= 0))) return { error: `${row}: quantities and prices can't be negative` };
    if (mrp != null && inQty > 0 && inPrice > mrp) return { error: `${row}: Adjust In Price can't be above MRP ${mrp.toFixed(2)}` };
    if (inQty > 0 && outQty > 0) return { error: `${row}: enter Adjust In or Adjust Out, not both` };
    if (!(inQty > 0 || outQty > 0)) return { error: `${row}: enter Adjust In or Adjust Out` };
    const cur = curOf(item.ItemId, batch);
    if (outQty > 0) {
      const key = `${item.ItemId}|${batch}`;
      outBy.set(key, (outBy.get(key) || 0) + outQty);
      if (outBy.get(key) > cur + 0.00005) return { error: `${row}: only ${round2(cur)} in stock${batch ? ` in batch ${batch}` : ''} to adjust out` };
    }
    lines.push({
      itemId: item.ItemId, batch, curStock: cur, mrp: mrp == null ? null : round2(mrp), inQty, outQty,
      inPrice: inQty > 0 ? round2(inPrice) : 0, outPrice: outQty > 0 ? round2(outPrice) : 0,
    });
  }
  const inTotal = round2(lines.reduce((t, l) => t + round2(l.inQty * l.inPrice), 0));
  const outTotal = round2(lines.reduce((t, l) => t + round2(l.outQty * l.outPrice), 0));
  return { adjDate, remarks: remarks || null, lines, inTotal, outTotal };
}

const linesOf = async (tx, adjId) => (await new sql.Request(tx).input('aid', sql.Int, adjId)
  .query('SELECT ItemId AS itemId, BatchNo AS batch FROM StockAdjustmentItem WHERE AdjustmentId = @aid')).recordset;

// After a change, no batch it touched may be below zero (e.g. an Adjust In
// taken back after its stock was sold).
async function shortBatch(tx, touched) {
  if (!touched.length) return null;
  const stock = await batchStock(new sql.Request(tx), touched.map((t) => t.itemId));
  const short = stock.find((s) => s.AvailableQty < -0.00005 && touched.some((t) => t.itemId === s.ItemId && t.batch === s.Batch));
  return short ? `Batch ${short.Batch || '(none)'} would go below zero: its stock has already been used` : null;
}

async function saveAdjustment(req, res, adjId) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await lockStock(tx);
    const a = await checkAdjustment(tx, req.body || {}, adjId);
    if (a.error) { await tx.rollback(); return res.status(400).json({ error: a.error }); }
    const before = adjId ? await linesOf(tx, adjId) : [];
    const head = new sql.Request(tx).input('date', sql.Date, a.adjDate).input('remarks', sql.NVarChar(300), a.remarks)
      .input('inTotal', sql.Decimal(12, 2), a.inTotal).input('outTotal', sql.Decimal(12, 2), a.outTotal);
    let id = adjId;
    if (adjId) {
      const upd = await head.input('id', sql.Int, adjId).query(`
        UPDATE StockAdjustment SET AdjDate = @date, Remarks = @remarks, InTotal = @inTotal, OutTotal = @outTotal
        WHERE AdjustmentId = @id AND IsActive = 1`);
      if (!upd.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: 'Adjustment not found' }); }
      await new sql.Request(tx).input('id', sql.Int, adjId).query('DELETE FROM StockAdjustmentItem WHERE AdjustmentId = @id');
    } else {
      const ins = await head.input('by', sql.NVarChar(100), req.user?.username || null).query(`
        INSERT INTO StockAdjustment (AdjDate, Remarks, InTotal, OutTotal, CreatedBy)
        OUTPUT INSERTED.AdjustmentId VALUES (@date, @remarks, @inTotal, @outTotal, @by)`);
      id = ins.recordset[0].AdjustmentId;
    }
    for (const l of a.lines) {
      await new sql.Request(tx)
        .input('id', sql.Int, id).input('itemId', sql.Int, l.itemId).input('batch', sql.NVarChar(100), l.batch)
        .input('cur', sql.Decimal(12, 4), l.curStock).input('mrp', sql.Decimal(10, 2), l.mrp)
        .input('inQty', sql.Decimal(10, 2), l.inQty).input('inPrice', sql.Decimal(10, 2), l.inPrice)
        .input('outQty', sql.Decimal(10, 2), l.outQty).input('outPrice', sql.Decimal(10, 2), l.outPrice)
        .query(`INSERT INTO StockAdjustmentItem (AdjustmentId, ItemId, BatchNo, CurStock, MRP, InQty, InPrice, OutQty, OutPrice)
                VALUES (@id, @itemId, @batch, @cur, @mrp, @inQty, @inPrice, @outQty, @outPrice)`);
    }
    const short = await shortBatch(tx, [...before, ...a.lines]);
    if (short) { await tx.rollback(); return res.status(400).json({ error: short }); }
    await tx.commit();
    res.status(adjId ? 200 : 201).json({ AdjustmentId: id, AdjNo: docNo('ADJ', id), InTotal: a.inTotal, OutTotal: a.outTotal });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  }
}

router.post('/', (req, res) => saveAdjustment(req, res, null));
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!(id > 0)) return res.status(400).json({ error: 'Bad adjustment id' });
  return saveAdjustment(req, res, id);
});

// Soft delete (Admin only): the adjustment stays with IsActive = 0 and its
// stock change is undone; refused when that would leave a batch below zero.
router.delete('/:id', async (req, res) => {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can delete an adjustment' });
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await lockStock(tx);
    const id = Number(req.params.id);
    const before = await linesOf(tx, id);
    await new sql.Request(tx).input('id', sql.Int, id).query('UPDATE StockAdjustment SET IsActive = 0 WHERE AdjustmentId = @id');
    const short = await shortBatch(tx, before);
    if (short) { await tx.rollback(); return res.status(400).json({ error: short }); }
    await tx.commit();
    res.json({ success: true });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

export default router;
