import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNo, docNoSql } from '../utils/docNumber.js';
import { saleLineAmount, saleBill } from '../utils/purchaseCalc.js';
import { batchStock } from '../utils/batchStock.js';

// Pharmacy > Return > Sales Return: goods a customer brings back from one
// sale, found by the Sales Date or by the customer. Saving puts the returned
// quantity back into its batch's stock (read from these rows, see
// utils/batchStock.js). A line can return at most what it sold less what
// earlier returns took; the refund keeps the sale's line and bill discounts.
const router = Router();

const SR_NO = docNoSql('SR', 'h.SalesReturnId');
const S_NO = docNoSql('S', 'sb.SalesBillingId');
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const text = (v) => (v == null ? '' : String(v).trim());

const lockStock = (tx) => new sql.Request(tx).query(
  "EXEC sp_getapplock @Resource = 'pharmacy-stock', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000",
);

// Every customer that has a sale, for the Customer picker.
router.get('/customers', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT sb.CustomerName, ISNULL(sb.MobileNo, '') AS MobileNo, COUNT(*) AS Sales, MAX(sb.TransDate) AS LastDate
      FROM SalesBilling sb
      WHERE sb.IsActive = 1 AND ISNULL(sb.CustomerName, '') <> ''
      GROUP BY sb.CustomerName, ISNULL(sb.MobileNo, '')
      ORDER BY sb.CustomerName`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sales for the Sale No drop-down: ?date=YYYY-MM-DD (that day's sales) or
// ?customer=&mobile= (that customer's sales, newest first).
router.get('/sales', async (req, res) => {
  try {
    const date = text(req.query.date).slice(0, 10);
    const customer = text(req.query.customer);
    const byDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (!byDate && !customer) return res.json([]);
    const pool = await getPool();
    const r = await pool.request()
      .input('date', sql.Date, byDate ? date : null)
      .input('customer', sql.NVarChar(200), customer || null)
      .input('mobile', sql.NVarChar(20), text(req.query.mobile))
      .query(`
        SELECT sb.SalesBillingId, ${S_NO} AS SaleNo, sb.TransDate, sb.CustomerName, sb.MobileNo, sb.TotalAmount
        FROM SalesBilling sb
        WHERE sb.IsActive = 1
          AND (@date IS NULL OR sb.TransDate = @date)
          AND (@customer IS NULL OR (sb.CustomerName = @customer AND ISNULL(sb.MobileNo, '') = @mobile))
        ORDER BY sb.SalesBillingId DESC`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A sale's lines with what other returns (not excludeReturnId) took and
// what's left, in the unit the line was sold in.
async function saleLines(request, saleId, excludeReturnId) {
  const r = await request.input('saleId', sql.Int, saleId).input('exclude', sql.Int, excludeReturnId || null).query(`
    SELECT l.LineId AS SalesLineId, l.ItemId, i.Name AS ItemName, l.Batch, l.ExpiryDate, l.Rate, ISNULL(l.DiscPercent, 0) AS DiscPercent,
           ISNULL(l.SaleUnit, 'pack') AS SaleUnit, ISNULL(l.UnitQty, l.Quantity) AS Sold, ISNULL(l.PackSize, 1) AS PackSize,
           ISNULL((SELECT SUM(ri.UnitQty) FROM SalesReturnItem ri JOIN SalesReturn rh ON rh.SalesReturnId = ri.SalesReturnId AND rh.IsActive = 1
                   WHERE ri.SalesLineId = l.LineId AND (@exclude IS NULL OR rh.SalesReturnId <> @exclude)), 0) AS Returned
    FROM SalesBillingItem l JOIN PharmacyItem i ON i.ItemId = l.ItemId
    WHERE l.SalesBillingId = @saleId ORDER BY l.LineId`);
  return r.recordset.map((l) => ({
    ...l, Rate: Number(l.Rate), DiscPercent: Number(l.DiscPercent), Sold: Number(l.Sold), Returned: Number(l.Returned),
    Left: round2(Number(l.Sold) - Number(l.Returned)),
  }));
}

async function saleHead(request, saleId) {
  const r = await request.input('headId', sql.Int, saleId).query(`
    SELECT sb.SalesBillingId, ${S_NO} AS SaleNo, sb.TransDate, sb.CustomerName, sb.MobileNo, ISNULL(sb.DiscPercent, 0) AS DiscPercent
    FROM SalesBilling sb WHERE sb.SalesBillingId = @headId AND sb.IsActive = 1`);
  return r.recordset[0] || null;
}

router.get('/sale-lines/:saleId', async (req, res) => {
  try {
    const pool = await getPool();
    const saleId = Number(req.params.saleId);
    const head = await saleHead(pool.request(), saleId);
    if (!head) return res.status(404).json({ error: 'Sale not found' });
    res.json({ ...head, DiscPercent: Number(head.DiscPercent), lines: await saleLines(pool.request(), saleId, Number(req.query.excludeReturnId) || null) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pool = await getPool();
    const r = await pool.request().input('search', sql.NVarChar, `%${search}%`).query(`
      SELECT h.SalesReturnId, ${SR_NO} AS ReturnNo, h.TransDate AS ReturnDate, h.CustomerName, h.MobileNo,
             h.SalesBillingId, ${S_NO} AS SaleNo, sb.TransDate AS SaleDate, h.TotalAmount, li.ItemNames, li.Items, li.TotalQty
      FROM SalesReturn h
      JOIN SalesBilling sb ON sb.SalesBillingId = h.SalesBillingId
      OUTER APPLY (
        SELECT STRING_AGG(i.Name, ', ') WITHIN GROUP (ORDER BY l.LineId) AS ItemNames, COUNT(*) AS Items, SUM(l.UnitQty) AS TotalQty
        FROM SalesReturnItem l JOIN PharmacyItem i ON i.ItemId = l.ItemId WHERE l.SalesReturnId = h.SalesReturnId
      ) li
      WHERE h.IsActive = 1
        AND (@search = '%%' OR h.CustomerName LIKE @search OR h.MobileNo LIKE @search OR ${SR_NO} LIKE @search
             OR ${S_NO} LIKE @search OR li.ItemNames LIKE @search)
      ORDER BY h.SalesReturnId DESC`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const head = await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT h.SalesReturnId, ${SR_NO} AS ReturnNo, h.TransDate AS ReturnDate, h.SalesBillingId, ${S_NO} AS SaleNo,
             sb.TransDate AS SaleDate, h.CustomerName, h.MobileNo, h.TotalAmount
      FROM SalesReturn h JOIN SalesBilling sb ON sb.SalesBillingId = h.SalesBillingId
      WHERE h.SalesReturnId = @id AND h.IsActive = 1`);
    if (!head.recordset.length) return res.status(404).json({ error: 'Sales Return not found' });
    const lines = await pool.request().input('id', sql.Int, req.params.id)
      .query('SELECT SalesLineId, UnitQty FROM SalesReturnItem WHERE SalesReturnId = @id ORDER BY LineId');
    res.json({ ...head.recordset[0], lines: lines.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Taking a return back (edit to less, or delete) takes its stock out again;
// refuses when a batch has since been sold on and would go below zero.
// `batches` are the [{ itemId, batch }] the change touched.
async function shortBatch(tx, batches) {
  const stock = await batchStock(new sql.Request(tx), batches.map((b) => b.itemId));
  const short = stock.find((s) => s.AvailableQty < -0.00005 && batches.some((b) => b.itemId === s.ItemId && (b.batch || '') === s.Batch));
  return short ? `Batch ${short.Batch || '(none)'} has already been sold again, so this return can't be taken back` : null;
}

const linesOf = async (tx, returnId) => (await new sql.Request(tx).input('rid', sql.Int, returnId)
  .query('SELECT ItemId AS itemId, Batch AS batch FROM SalesReturnItem WHERE SalesReturnId = @rid')).recordset;

// Checks a return body against the sale. Returns { error } or the cleaned
// return; amounts are worked out here, never taken from the screen.
async function checkReturn(tx, body, returnId) {
  const returnDate = text(body.returnDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate) || Number.isNaN(Date.parse(returnDate))) return { error: 'Return Date is required' };
  const saleId = Number(body.salesBillingId);
  if (!(saleId > 0)) return { error: 'Sale No is required' };
  const sale = await saleHead(new sql.Request(tx), saleId);
  if (!sale) return { error: 'Sale not found' };
  if (returnDate < new Date(sale.TransDate).toISOString().slice(0, 10)) return { error: "Return Date can't be before the Sale Date" };

  const left = new Map((await saleLines(new sql.Request(tx), saleId, returnId)).map((l) => [l.SalesLineId, l]));
  const lines = [];
  for (const l of Array.isArray(body.lines) ? body.lines : []) {
    const qty = text(l.quantity) === '' ? 0 : Number(l.quantity);
    if (qty === 0) continue;
    const s = left.get(Number(l.salesLineId));
    if (!s) return { error: "A line isn't on this sale" };
    if (!(qty > 0)) return { error: `${s.ItemName}: Return Qty must be more than 0` };
    if (qty > s.Left + 0.00005) return { error: `${s.ItemName}${s.Batch ? ` (batch ${s.Batch})` : ''}: only ${s.Left} can still be returned` };
    lines.push({
      salesLineId: s.SalesLineId, itemId: s.ItemId, batch: s.Batch, expiryDate: s.ExpiryDate, saleUnit: s.SaleUnit, packSize: s.PackSize,
      unitQty: qty, qty: round4(qty / (s.SaleUnit === 'unit' ? s.PackSize : 1)), rate: s.Rate, discPercent: s.DiscPercent,
      amount: saleLineAmount({ quantity: qty, rate: s.Rate, discPercent: s.DiscPercent }),
    });
  }
  if (!lines.length) return { error: 'Enter a Return Qty on at least one line' };
  const discPercent = Number(sale.DiscPercent) || 0;
  return { returnDate, sale, lines, discPercent, ...saleBill(lines.map((l) => l.amount), discPercent) };
}

async function saveReturn(req, res, returnId) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await lockStock(tx);
    const r = await checkReturn(tx, req.body || {}, returnId);
    if (r.error) { await tx.rollback(); return res.status(400).json({ error: r.error }); }
    const head = new sql.Request(tx)
      .input('date', sql.Date, r.returnDate).input('saleId', sql.Int, r.sale.SalesBillingId)
      .input('customer', sql.NVarChar(200), r.sale.CustomerName).input('mobile', sql.NVarChar(20), r.sale.MobileNo)
      .input('subTotal', sql.Decimal(12, 2), r.subTotal).input('disc', sql.Decimal(5, 2), r.discPercent)
      .input('discAmt', sql.Decimal(12, 2), r.discountAmount).input('total', sql.Decimal(12, 2), r.total);
    let id = returnId;
    const before = returnId ? await linesOf(tx, returnId) : [];
    if (returnId) {
      const upd = await head.input('id', sql.Int, returnId).query(`
        UPDATE SalesReturn SET TransDate = @date, SalesBillingId = @saleId, CustomerName = @customer, MobileNo = @mobile,
            SubTotal = @subTotal, DiscPercent = @disc, DiscountAmount = @discAmt, TotalAmount = @total
        WHERE SalesReturnId = @id AND IsActive = 1`);
      if (!upd.rowsAffected[0]) { await tx.rollback(); return res.status(404).json({ error: 'Sales Return not found' }); }
      await new sql.Request(tx).input('id', sql.Int, returnId).query('DELETE FROM SalesReturnItem WHERE SalesReturnId = @id');
    } else {
      const ins = await head.input('by', sql.NVarChar(100), req.user?.username || null).query(`
        INSERT INTO SalesReturn (TransDate, SalesBillingId, CustomerName, MobileNo, SubTotal, DiscPercent, DiscountAmount, TotalAmount, CreatedBy)
        OUTPUT INSERTED.SalesReturnId VALUES (@date, @saleId, @customer, @mobile, @subTotal, @disc, @discAmt, @total, @by)`);
      id = ins.recordset[0].SalesReturnId;
    }
    for (const l of r.lines) {
      await new sql.Request(tx)
        .input('id', sql.Int, id).input('lineId', sql.Int, l.salesLineId).input('itemId', sql.Int, l.itemId)
        .input('batch', sql.NVarChar(100), l.batch).input('expiry', sql.Date, l.expiryDate)
        .input('saleUnit', sql.NVarChar(10), l.saleUnit).input('unitQty', sql.Decimal(10, 2), l.unitQty).input('packSize', sql.Int, l.packSize)
        .input('qty', sql.Decimal(12, 4), l.qty).input('rate', sql.Decimal(10, 2), l.rate)
        .input('disc', sql.Decimal(5, 2), l.discPercent).input('amount', sql.Decimal(12, 2), l.amount)
        .query(`INSERT INTO SalesReturnItem (SalesReturnId, SalesLineId, ItemId, Batch, ExpiryDate, SaleUnit, UnitQty, PackSize, Quantity, Rate, DiscPercent, Amount)
                VALUES (@id, @lineId, @itemId, @batch, @expiry, @saleUnit, @unitQty, @packSize, @qty, @rate, @disc, @amount)`);
    }
    const short = before.length ? await shortBatch(tx, before) : null;
    if (short) { await tx.rollback(); return res.status(400).json({ error: short }); }
    await tx.commit();
    res.status(returnId ? 200 : 201).json({ SalesReturnId: id, ReturnNo: docNo('SR', id), TotalAmount: r.total });
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

// Soft delete (Admin only): the row stays with IsActive = 0 and its stock
// comes off again.
router.delete('/:id', async (req, res) => {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can delete a Sales Return' });
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    await lockStock(tx);
    const id = Number(req.params.id);
    const before = await linesOf(tx, id);
    await new sql.Request(tx).input('id', sql.Int, id).query('UPDATE SalesReturn SET IsActive = 0 WHERE SalesReturnId = @id');
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
