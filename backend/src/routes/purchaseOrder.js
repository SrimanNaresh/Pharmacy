import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNo, docNoSql } from '../utils/docNumber.js';
import { purchaseLine, round2, roundOffOf } from '../utils/purchaseCalc.js';

// Pharmacy > Purchase / Order: orders placed with a vendor. An order doesn't
// change stock. Every amount is worked out here with the same formulas the
// screen uses (utils/purchaseCalc.js); the screen's sums are never trusted.
const router = Router();

const ORDER_NO = docNoSql('PO', 'h.PurchaseOrderId');

// Once goods have come in against an order it can't be changed.
async function receivedLock(request, orderId) {
  const r = await request.input('lockOrderId', sql.Int, orderId)
    .query('SELECT COUNT(*) AS n FROM StockIn WHERE PurchaseOrderId = @lockOrderId AND IsActive = 1');
  return r.recordset[0].n ? 'A Stock In has been made against this order, so it can no longer be changed' : null;
}
const MAX_GST = 28;

router.get('/', async (req, res) => {
  try {
    const { search = '' } = req.query;
    const pool = await getPool();
    const result = await pool.request()
      .input('search', sql.NVarChar, `%${search}%`)
      .query(`
        SELECT h.PurchaseOrderId, ${ORDER_NO} AS OrderNo, h.OrderDate, h.VendorId, v.VendorName,
               (SELECT COUNT(*) FROM PurchaseOrderItem l WHERE l.PurchaseOrderId = h.PurchaseOrderId) AS Items,
               h.TotalAmount
        FROM PurchaseOrder h JOIN Vendor v ON v.VendorId = h.VendorId
        WHERE h.IsActive = 1
          AND (@search = '%%' OR v.VendorName LIKE @search OR ${ORDER_NO} LIKE @search
               OR EXISTS (SELECT 1 FROM PurchaseOrderItem l WHERE l.PurchaseOrderId = h.PurchaseOrderId AND l.ItemName LIKE @search))
        ORDER BY h.PurchaseOrderId DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The Old Price column: each item's rate on this vendor's latest earlier order,
// its P.Rate (MRP less Disc %, the line's Rate), as { itemId: rate }.
// ?excludeOrderId= leaves out the order being edited; items this vendor never
// supplied aren't in it.
router.get('/last-rates', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('vendorId', sql.Int, Number(req.query.vendorId) || 0)
      .input('exclude', sql.Int, Number(req.query.excludeOrderId) || null)
      .query(`
        SELECT ItemId, Rate FROM (
          SELECT l.ItemId, l.Rate, ROW_NUMBER() OVER (PARTITION BY l.ItemId ORDER BY h.OrderDate DESC, h.PurchaseOrderId DESC, l.LineId DESC) AS rn
          FROM PurchaseOrderItem l JOIN PurchaseOrder h ON h.PurchaseOrderId = l.PurchaseOrderId AND h.IsActive = 1
          WHERE h.VendorId = @vendorId AND (@exclude IS NULL OR h.PurchaseOrderId <> @exclude)
        ) x WHERE rn = 1`);
    res.json(Object.fromEntries(r.recordset.map((x) => [x.ItemId, Number(x.Rate)])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const head = await pool.request().input('id', sql.Int, req.params.id).query(`
      SELECT h.PurchaseOrderId, ${ORDER_NO} AS OrderNo, h.OrderDate, h.VendorId, v.VendorName, h.VendorDetails, h.TotalAmount, h.RoundOff
      FROM PurchaseOrder h JOIN Vendor v ON v.VendorId = h.VendorId
      WHERE h.PurchaseOrderId = @id AND h.IsActive = 1`);
    if (!head.recordset.length) return res.status(404).json({ error: 'Order not found' });
    const lines = await pool.request().input('id', sql.Int, req.params.id)
      .query(`SELECT l.*, ISNULL(l.PRate, l.MRP) AS PRateShown, ISNULL(l.Unit, u.Name) AS UnitShown
              FROM PurchaseOrderItem l
              LEFT JOIN PharmacyItem i ON i.ItemId = l.ItemId LEFT JOIN UnitMaster u ON u.UnitId = i.UnitId
              WHERE l.PurchaseOrderId = @id ORDER BY l.LineId`);
    // Lines saved before P.Rate / Unit existed show the MRP and the item's current unit.
    res.json({ ...head.recordset[0], lines: lines.recordset.map(({ PRateShown, UnitShown, ...l }) => ({ ...l, PRate: PRateShown, Unit: UnitShown })), locked: await receivedLock(pool.request(), Number(req.params.id)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const text = (v) => (v == null ? '' : String(v).trim());
const numOr = (v, d) => (text(v) === '' ? d : Number(v));

// Checks an order body. Returns { error } or the header and lines to save.
// Item details (name, generic, manufacturer, HSN, category, pack, unit) are copied
// from the item on file; a line already on the order keeps the copy it has.
async function checkOrder(pool, body, orderId) {
  const orderDate = text(body.orderDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || Number.isNaN(Date.parse(orderDate))) return { error: 'Date is required' };
  const vendorId = Number(body.vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) return { error: 'Vendor Name is required' };
  const vendor = await pool.request().input('id', sql.Int, vendorId)
    .query('SELECT VendorId FROM Vendor WHERE VendorId = @id AND IsActive = 1');
  if (!vendor.recordset.length) return { error: 'Vendor not found' };
  const vendorDetails = text(body.vendorDetails).slice(0, 1000) || null;

  const raw = (Array.isArray(body.lines) ? body.lines : []).filter((l) => l && (l.itemId || text(l.quantity)));
  if (!raw.length) return { error: 'Add at least one item' };

  const ids = [...new Set(raw.map((l) => Number(l.itemId)).filter((n) => Number.isInteger(n) && n > 0))];
  const items = new Map();
  if (ids.length) {
    const r = await pool.request().input('ids', sql.NVarChar(sql.MAX), ids.join(',')).query(`
      SELECT i.ItemId, i.Name, g.Name AS GenericName, m.Name AS Manufacturer, i.HSNCode, i.Category, i.Pack, un.Name AS Unit
      FROM PharmacyItem i
      LEFT JOIN UnitMaster un ON un.UnitId = i.UnitId
      LEFT JOIN GenericNameMaster g ON g.GenericNameId = i.GenericNameId
      LEFT JOIN ManufacturerMaster m ON m.ManufacturerId = i.ManufacturerId
      WHERE i.IsActive = 1 AND i.ItemId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`);
    for (const it of r.recordset) items.set(it.ItemId, it);
  }
  const saved = new Map();
  if (orderId) {
    const r = await pool.request().input('id', sql.Int, orderId)
      .query('SELECT * FROM PurchaseOrderItem WHERE PurchaseOrderId = @id');
    for (const l of r.recordset) saved.set(l.LineId, l);
  }

  const lines = [];
  for (const [i, l] of raw.entries()) {
    const row = `Row ${i + 1}`;
    const keep = saved.get(Number(l.lineId));
    const item = items.get(Number(l.itemId));
    if (!item) return { error: `${row}: pick an item` };
    const name = item.Name;
    const qty = Number(l.quantity);
    if (!(qty > 0)) return { error: `${row} (${name}): Quantity must be more than 0` };
    const mrp = Number(l.mrp);
    if (!(mrp > 0)) return { error: `${row} (${name}): MRP must be more than 0` };
    const pRate = Number(l.pRate);
    if (!(pRate > 0)) return { error: `${row} (${name}): P.Rate must be more than 0` };
    if (pRate > mrp) return { error: `${row} (${name}): P.Rate ${pRate.toFixed(2)} can't be above MRP ${mrp.toFixed(2)}` };
    const free = numOr(l.freeQty, 0);
    if (!(free >= 0)) return { error: `${row} (${name}): Free must be 0 or more` };
    const disc = numOr(l.discPercent, 0);
    if (!(disc >= 0 && disc <= 100)) return { error: `${row} (${name}): Disc % must be between 0 and 100` };
    const cgst = numOr(l.cgstPercent, 0);
    const sgst = numOr(l.sgstPercent, 0);
    if (!(cgst >= 0 && cgst <= MAX_GST) || !(sgst >= 0 && sgst <= MAX_GST)) return { error: `${row} (${name}): CGST % and SGST % must be between 0 and ${MAX_GST}` };
    if (cgst + sgst > MAX_GST) return { error: `${row} (${name}): CGST % + SGST % can't be more than ${MAX_GST}` };
    const calc = purchaseLine({ pRate, discPercent: disc, quantity: qty, cgstPercent: cgst, sgstPercent: sgst });
    const copy = keep && keep.ItemId === item.ItemId
      ? { name: keep.ItemName, generic: keep.GenericName, manufacturer: keep.Manufacturer, hsn: keep.HSNCode, category: keep.Category, pack: keep.Pack, unit: keep.Unit ?? item.Unit }
      : { name: item.Name, generic: item.GenericName, manufacturer: item.Manufacturer, hsn: item.HSNCode, category: item.Category, pack: item.Pack, unit: item.Unit };
    lines.push({ itemId: item.ItemId, ...copy, mrp, pRate, free, disc, qty, cgst, sgst, ...calc });
  }
  const sum = round2(lines.reduce((s, l) => s + l.total, 0));
  // body.roundOff: true rounds the Sum of Total to the nearest rupee.
  const roundOff = body.roundOff ? roundOffOf(sum) : 0;
  return { orderDate, vendorId, vendorDetails, lines, roundOff, total: round2(sum + roundOff) };
}

async function insertLines(tx, orderId, lines) {
  for (const l of lines) {
    await new sql.Request(tx)
      .input('orderId', sql.Int, orderId)
      .input('itemId', sql.Int, l.itemId)
      .input('name', sql.NVarChar(200), l.name)
      .input('generic', sql.NVarChar(200), l.generic)
      .input('manufacturer', sql.NVarChar(200), l.manufacturer)
      .input('hsn', sql.NVarChar(30), l.hsn)
      .input('category', sql.NVarChar(100), l.category)
      .input('pack', sql.NVarChar(50), l.pack)
      .input('unit', sql.NVarChar(50), l.unit)
      .input('mrp', sql.Decimal(10, 2), l.mrp)
      .input('pRate', sql.Decimal(10, 2), l.pRate)
      .input('free', sql.Decimal(10, 2), l.free)
      .input('disc', sql.Decimal(5, 2), l.disc)
      .input('rate', sql.Decimal(10, 2), l.rate)
      .input('qty', sql.Decimal(10, 2), l.qty)
      .input('amount', sql.Decimal(12, 2), l.amount)
      .input('cgst', sql.Decimal(5, 2), l.cgst)
      .input('sgst', sql.Decimal(5, 2), l.sgst)
      .input('gst', sql.Decimal(5, 2), l.gstPercent)
      .input('gstAmount', sql.Decimal(12, 2), l.gstAmount)
      .input('total', sql.Decimal(12, 2), l.total)
      .query(`
        INSERT INTO PurchaseOrderItem (PurchaseOrderId, ItemId, ItemName, GenericName, Manufacturer, HSNCode, Category, Pack, Unit,
                                       MRP, PRate, FreeQty, DiscPercent, Rate, Quantity, Amount, CGSTPercent, SGSTPercent, GSTPercent, GSTAmount, Total)
        VALUES (@orderId, @itemId, @name, @generic, @manufacturer, @hsn, @category, @pack, @unit,
                @mrp, @pRate, @free, @disc, @rate, @qty, @amount, @cgst, @sgst, @gst, @gstAmount, @total)`);
  }
}

async function saveOrder(req, res, orderId) {
  const pool = await getPool();
  if (orderId) {
    const locked = await receivedLock(pool.request(), orderId);
    if (locked) return res.status(400).json({ error: locked });
  }
  const o = await checkOrder(pool, req.body || {}, orderId);
  if (o.error) return res.status(400).json({ error: o.error });
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const head = new sql.Request(tx)
      .input('date', sql.Date, o.orderDate)
      .input('vendorId', sql.Int, o.vendorId)
      .input('details', sql.NVarChar(1000), o.vendorDetails)
      .input('total', sql.Decimal(12, 2), o.total)
      .input('roundOff', sql.Decimal(10, 2), o.roundOff);
    let id = orderId;
    if (orderId) {
      const upd = await head.input('id', sql.Int, orderId).query(`
        UPDATE PurchaseOrder SET OrderDate = @date, VendorId = @vendorId, VendorDetails = @details, TotalAmount = @total, RoundOff = @roundOff
        WHERE PurchaseOrderId = @id AND IsActive = 1`);
      if (!upd.rowsAffected[0]) {
        await tx.rollback();
        return res.status(404).json({ error: 'Order not found' });
      }
      await new sql.Request(tx).input('id', sql.Int, orderId).query('DELETE FROM PurchaseOrderItem WHERE PurchaseOrderId = @id');
    } else {
      const ins = await head.input('by', sql.NVarChar(100), req.user?.username || null).query(`
        INSERT INTO PurchaseOrder (OrderDate, VendorId, VendorDetails, TotalAmount, RoundOff, CreatedBy)
        OUTPUT INSERTED.PurchaseOrderId VALUES (@date, @vendorId, @details, @total, @roundOff, @by)`);
      id = ins.recordset[0].PurchaseOrderId;
    }
    await insertLines(tx, id, o.lines);
    await tx.commit();
    res.status(orderId ? 200 : 201).json({ PurchaseOrderId: id, OrderNo: docNo('PO', id), TotalAmount: o.total });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  }
}

router.post('/', (req, res) => saveOrder(req, res, null));

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad order id' });
  return saveOrder(req, res, id);
});

// Only an Admin may delete an order, and not once goods have come in against it.
router.delete('/:id', async (req, res) => {
  try {
    if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can delete an order' });
    const pool = await getPool();
    const locked = await receivedLock(pool.request(), Number(req.params.id));
    if (locked) return res.status(400).json({ error: locked });
    await pool.request().input('id', sql.Int, req.params.id)
      .query('UPDATE PurchaseOrder SET IsActive = 0 WHERE PurchaseOrderId = @id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
