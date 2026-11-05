import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNo, docNoSql } from '../utils/docNumber.js';
import { batchStock } from '../utils/batchStock.js';
import { selAmount } from '../utils/purchaseCalc.js';

// Pharmacy > Stock In: goods received against a Purchase Order. Saving adds
// stock (stock is read from these rows, see utils/batchStock.js) and sets each
// item's selling price to the line's Sel.Amount (MRP less Discount %). A Stock In whose batches a
// Return or a Sale has used can no longer be edited.
const router = Router();

const SI_NO = docNoSql('SI', 'h.StockInId');
const PO_NO = docNoSql('PO', 'po.PurchaseOrderId');
const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthOf = (d) => (d ? new Date(d).toISOString().slice(0, 7) : '');
const firstDay = (ym) => `${ym}-01`;
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const text = (v) => (v == null ? '' : String(v).trim());
const numOr = (v, d) => (text(v) === '' ? d : Number(v));

const lockStock = (tx) => new sql.Request(tx).query(
  "EXEC sp_getapplock @Resource = 'pharmacy-stock', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000",
);

// A vendor's orders for the Purchase No drop-down: only those with something
// still to come in (paid or free). ?includeOrderId= keeps one in the list
// anyway — the order of a Stock In being edited.
router.get('/orders', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('vendorId', sql.Int, Number(req.query.vendorId) || 0)
      .input('include', sql.Int, Number(req.query.includeOrderId) || null)
      .query(`
      SELECT po.PurchaseOrderId, ${PO_NO} AS OrderNo, po.OrderDate, po.TotalAmount
      FROM PurchaseOrder po
      WHERE po.IsActive = 1 AND po.VendorId = @vendorId
        AND (po.PurchaseOrderId = @include OR EXISTS (
          SELECT 1 FROM PurchaseOrderItem l
          OUTER APPLY (
            SELECT SUM(si.Quantity) AS Paid, SUM(si.FreeQty) AS Free
            FROM StockInItem si JOIN StockIn h ON h.StockInId = si.StockInId AND h.IsActive = 1
            WHERE si.PoLineId = l.LineId
          ) rc
          WHERE l.PurchaseOrderId = po.PurchaseOrderId
            AND (ISNULL(rc.Paid, 0) < l.Quantity OR ISNULL(rc.Free, 0) < l.FreeQty)))
      ORDER BY po.PurchaseOrderId DESC`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// An order's lines with what's been received by other Stock Ins (the one
// being edited, ?excludeStockInId=, doesn't count) and what's still due, kept
// apart for the paid units (Ordered / Received / Due) and the free ones
// (FreeOrdered / FreeReceived / FreeDue). Unit is the line's copy, or the
// item's unit for lines saved before units were copied.
async function orderLines(request, orderId, excludeStockInId) {
  const r = await request.input('orderId', sql.Int, orderId).input('exclude', sql.Int, excludeStockInId || null).query(`
    SELECT l.LineId AS PoLineId, l.ItemId, l.ItemName, l.GenericName, l.Manufacturer, l.HSNCode, l.Category, l.Pack,
           ISNULL(l.Unit, u.Name) AS Unit, l.MRP, ISNULL(l.PRate, l.MRP) AS PRate, l.DiscPercent, l.Rate,
           l.Quantity AS Ordered, l.FreeQty AS FreeOrdered,
           l.CGSTPercent, l.SGSTPercent, ISNULL(rc.Paid, 0) AS Received, ISNULL(rc.Free, 0) AS FreeReceived
    FROM PurchaseOrderItem l
    LEFT JOIN PharmacyItem i ON i.ItemId = l.ItemId
    LEFT JOIN UnitMaster u ON u.UnitId = i.UnitId
    OUTER APPLY (
      SELECT SUM(si.Quantity) AS Paid, SUM(si.FreeQty) AS Free
      FROM StockInItem si JOIN StockIn h ON h.StockInId = si.StockInId AND h.IsActive = 1
      WHERE si.PoLineId = l.LineId AND (@exclude IS NULL OR h.StockInId <> @exclude)
    ) rc
    WHERE l.PurchaseOrderId = @orderId ORDER BY l.LineId`);
  return r.recordset.map((l) => {
    const n = { Ordered: Number(l.Ordered), FreeOrdered: Number(l.FreeOrdered), Received: Number(l.Received), FreeReceived: Number(l.FreeReceived) };
    return { ...l, ...n, Due: Math.max(0, n.Ordered - n.Received), FreeDue: Math.max(0, n.FreeOrdered - n.FreeReceived) };
  });
}

router.get('/order-lines/:orderId', async (req, res) => {
  try {
    const pool = await getPool();
    res.json(await orderLines(pool.request(), Number(req.params.orderId), Number(req.query.excludeStockInId) || null));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Every Stock In line with its header, for the list's Item wise / Date wise views.
router.get('/', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pool = await getPool();
    const r = await pool.request().input('search', sql.NVarChar, `%${search}%`).query(`
      SELECT h.StockInId, ${SI_NO} AS StockInNo, h.InDate, h.VendorId, v.VendorName, ${PO_NO} AS OrderNo,
             l.LineId, l.ItemId, i.Name AS ItemName, l.BatchNo, l.MfgDate, l.ExpDate, l.Quantity, l.FreeQty, l.Rate, l.MRP,
             l.SalesPercent, l.DiscPercent, l.SelAmount
      FROM StockIn h
      JOIN Vendor v ON v.VendorId = h.VendorId
      JOIN PurchaseOrder po ON po.PurchaseOrderId = h.PurchaseOrderId
      JOIN StockInItem l ON l.StockInId = h.StockInId
      JOIN PharmacyItem i ON i.ItemId = l.ItemId
      WHERE h.IsActive = 1
        AND (@search = '%%' OR i.Name LIKE @search OR l.BatchNo LIKE @search OR ${SI_NO} LIKE @search OR v.VendorName LIKE @search)
      ORDER BY h.InDate DESC, h.StockInId DESC, l.LineId`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Why a Stock In can't be changed any more, or null.
async function lockReason(request, stockInId) {
  const r = await request.input('lockId', sql.Int, stockInId).query(`
    SELECT
      (SELECT COUNT(*) FROM StockReturnItem ri JOIN StockReturn rh ON rh.StockReturnId = ri.StockReturnId AND rh.IsActive = 1
        JOIN StockInItem l ON l.LineId = ri.StockInLineId WHERE l.StockInId = @lockId) AS Returns,
      (SELECT COUNT(*) FROM SalesBillingItem sbi JOIN SalesBilling sb ON sb.SalesBillingId = sbi.SalesBillingId AND sb.IsActive = 1
        WHERE EXISTS (SELECT 1 FROM StockInItem l WHERE l.StockInId = @lockId AND l.ItemId = sbi.ItemId AND l.BatchNo = sbi.Batch)) AS Sales,
      (SELECT COUNT(*) FROM VendorPayment p WHERE p.StockInId = @lockId AND p.IsActive = 1) AS Payments`);
  const { Returns, Sales, Payments } = r.recordset[0];
  if (Returns) return 'A Return has been made from this Stock In, so it can no longer be changed';
  if (Sales) return 'Its batches have been sold, so this Stock In can no longer be changed';
  if (Payments) return 'The vendor has been paid against this Stock In, so it can no longer be changed';
  return null;
}

router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.id);
    const head = await pool.request().input('id', sql.Int, id).query(`
      SELECT h.StockInId, ${SI_NO} AS StockInNo, h.InDate, h.VendorId, v.VendorName, h.PurchaseOrderId, ${PO_NO} AS OrderNo
      FROM StockIn h JOIN Vendor v ON v.VendorId = h.VendorId JOIN PurchaseOrder po ON po.PurchaseOrderId = h.PurchaseOrderId
      WHERE h.StockInId = @id AND h.IsActive = 1`);
    if (!head.recordset.length) return res.status(404).json({ error: 'Stock In not found' });
    const lines = await pool.request().input('id', sql.Int, id).query('SELECT * FROM StockInItem WHERE StockInId = @id ORDER BY LineId');
    res.json({ ...head.recordset[0], lines: lines.recordset, locked: await lockReason(pool.request(), id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checks a Stock In body against its order. Returns { error } or what to save.
// Rows with no paid or free units are skipped. On edit, an expiry / mfg month the line already
// had is kept even if it's now in the past.
async function checkStockIn(tx, body, stockInId) {
  const inDate = text(body.inDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inDate) || Number.isNaN(Date.parse(inDate))) return { error: 'Date is required' };
  const vendorId = Number(body.vendorId);
  if (!(vendorId > 0)) return { error: 'Vendor Name is required' };
  const orderId = Number(body.purchaseOrderId);
  if (!(orderId > 0)) return { error: 'Purchase No is required' };
  const po = await new sql.Request(tx).input('id', sql.Int, orderId)
    .query('SELECT VendorId FROM PurchaseOrder WHERE PurchaseOrderId = @id AND IsActive = 1');
  if (!po.recordset.length) return { error: 'Purchase order not found' };
  if (po.recordset[0].VendorId !== vendorId) return { error: "That order isn't from this vendor" };

  const due = new Map((await orderLines(new sql.Request(tx), orderId, stockInId)).map((l) => [l.PoLineId, l]));
  const kept = new Map();
  if (stockInId) {
    const r = await new sql.Request(tx).input('id', sql.Int, stockInId).query('SELECT PoLineId, MfgDate, ExpDate FROM StockInItem WHERE StockInId = @id');
    for (const l of r.recordset) kept.set(l.PoLineId, { mfg: monthOf(l.MfgDate), exp: monthOf(l.ExpDate) });
  }
  const now = thisMonth();
  const lines = [];
  const raw = Array.isArray(body.lines) ? body.lines : [];
  for (const l of raw) {
    const qty = numOr(l.quantity, 0);
    const free = numOr(l.freeQty, 0);
    if (qty === 0 && free === 0) continue;
    const po = due.get(Number(l.poLineId));
    if (!po) return { error: "A line isn't on this order" };
    const name = po.ItemName;
    if (!(qty >= 0)) return { error: `${name}: Received must be 0 or more` };
    if (!(free >= 0)) return { error: `${name}: Free Received must be 0 or more` };
    if (qty > po.Due) return { error: `${name}: only ${po.Due} still due on the order` };
    if (free > po.FreeDue) return { error: `${name}: only ${po.FreeDue} free still due on the order` };
    const batch = text(l.batchNo);
    if (!batch) return { error: `${name}: Batch No is required` };
    if (batch.length > 50) return { error: `${name}: Batch No must be at most 50 characters` };
    const exp = text(l.expMonth);
    const mfg = text(l.mfgMonth);
    if (!isMonth(exp)) return { error: `${name}: Exp.Date (month and year) is required` };
    if (mfg && !isMonth(mfg)) return { error: `${name}: Mf.Date must be a month and year` };
    const old = kept.get(po.PoLineId) || {};
    if (exp < now && exp !== old.exp) return { error: `${name}: Exp.Date can't be a past month` };
    if (mfg && mfg > now && mfg !== old.mfg) return { error: `${name}: Mf.Date can't be a future month` };
    if (mfg && exp <= mfg) return { error: `${name}: Exp.Date must be after Mf.Date` };
    // Sales % is no longer used (Sel.Amount comes from the MRP); it's saved as 0.
    const salesPercent = 0;
    const discPercent = numOr(l.discPercent, 0);
    if (!(discPercent >= 0 && discPercent <= 100)) return { error: `${name}: Discount % must be between 0 and 100` };
    const rate = Number(po.Rate);
    const mrp = Number(po.MRP);
    const sel = selAmount({ mrp, discPercent });
    lines.push({ poLineId: po.PoLineId, itemId: po.ItemId, batch, mfg: mfg ? firstDay(mfg) : null, exp: lastDay(exp), qty, free, rate, mrp, salesPercent, discPercent, sel });
  }
  if (!lines.length) return { error: 'Enter a Received quantity on at least one line' };
  return { inDate, vendorId, orderId, lines };
}

async function saveStockIn(req, res, stockInId) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await lockStock(tx);
    if (stockInId) {
      const exists = await new sql.Request(tx).input('id', sql.Int, stockInId).query('SELECT 1 FROM StockIn WHERE StockInId = @id AND IsActive = 1');
      if (!exists.recordset.length) { await tx.rollback(); return res.status(404).json({ error: 'Stock In not found' }); }
      const locked = await lockReason(new sql.Request(tx), stockInId);
      if (locked) { await tx.rollback(); return res.status(400).json({ error: locked }); }
    }
    const s = await checkStockIn(tx, req.body || {}, stockInId);
    if (s.error) { await tx.rollback(); return res.status(400).json({ error: s.error }); }

    // Batches this Stock In had before the edit, to check none goes below zero after it.
    const touched = [];
    let id = stockInId;
    const head = new sql.Request(tx).input('date', sql.Date, s.inDate).input('vendorId', sql.Int, s.vendorId).input('orderId', sql.Int, s.orderId);
    if (stockInId) {
      const before = await new sql.Request(tx).input('id', sql.Int, stockInId).query('SELECT ItemId FROM StockInItem WHERE StockInId = @id');
      touched.push(...before.recordset.map((r) => r.ItemId));
      await head.input('id', sql.Int, stockInId).query('UPDATE StockIn SET InDate = @date, VendorId = @vendorId, PurchaseOrderId = @orderId WHERE StockInId = @id');
      await new sql.Request(tx).input('id', sql.Int, stockInId).query('DELETE FROM StockInItem WHERE StockInId = @id');
    } else {
      const ins = await head.input('by', sql.NVarChar(100), req.user?.username || null)
        .query('INSERT INTO StockIn (InDate, VendorId, PurchaseOrderId, CreatedBy) OUTPUT INSERTED.StockInId VALUES (@date, @vendorId, @orderId, @by)');
      id = ins.recordset[0].StockInId;
    }
    for (const l of s.lines) {
      await new sql.Request(tx)
        .input('id', sql.Int, id).input('poLineId', sql.Int, l.poLineId).input('itemId', sql.Int, l.itemId)
        .input('batch', sql.NVarChar(50), l.batch).input('mfg', sql.Date, l.mfg).input('exp', sql.Date, l.exp)
        .input('qty', sql.Decimal(10, 2), l.qty).input('free', sql.Decimal(10, 2), l.free).input('rate', sql.Decimal(10, 2), l.rate).input('mrp', sql.Decimal(10, 2), l.mrp)
        .input('sales', sql.Decimal(6, 2), l.salesPercent).input('disc', sql.Decimal(5, 2), l.discPercent).input('sel', sql.Decimal(10, 2), l.sel)
        .query(`INSERT INTO StockInItem (StockInId, PoLineId, ItemId, BatchNo, MfgDate, ExpDate, Quantity, FreeQty, Rate, MRP, SalesPercent, DiscPercent, SelAmount)
                VALUES (@id, @poLineId, @itemId, @batch, @mfg, @exp, @qty, @free, @rate, @mrp, @sales, @disc, @sel)`);
      // Each item's selling price becomes its Sel.Amount.
      await new sql.Request(tx).input('itemId', sql.Int, l.itemId).input('sel', sql.Decimal(10, 2), l.sel)
        .query('UPDATE PharmacyItem SET SellPrice = @sel WHERE ItemId = @itemId');
      touched.push(l.itemId);
    }
    const negative = (await batchStock(new sql.Request(tx), touched)).find((b) => b.AvailableQty < 0);
    if (negative) {
      await tx.rollback();
      return res.status(400).json({ error: `That would take batch ${negative.Batch || '(none)'} below zero stock` });
    }
    await tx.commit();
    res.status(stockInId ? 200 : 201).json({ StockInId: id, StockInNo: docNo('SI', id) });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  }
}

router.post('/', (req, res) => saveStockIn(req, res, null));
// Only an Admin may edit a saved Stock In.
router.put('/:id', (req, res) => {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can edit a Stock In' });
  const id = Number(req.params.id);
  if (!(id > 0)) return res.status(400).json({ error: 'Bad Stock In id' });
  return saveStockIn(req, res, id);
});

// Only an Admin may delete a Stock In (its stock goes with it), and not once a
// Return or a Sale has used its batches.
router.delete('/:id', async (req, res) => {
  try {
    if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can delete a Stock In' });
    const pool = await getPool();
    const locked = await lockReason(pool.request(), Number(req.params.id));
    if (locked) return res.status(400).json({ error: locked });
    await pool.request().input('id', sql.Int, req.params.id).query('UPDATE StockIn SET IsActive = 0 WHERE StockInId = @id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
