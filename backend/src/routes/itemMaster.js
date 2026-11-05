import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { CURRENT_STOCK } from '../utils/stockEvents.js';

// Pharmacy > Item: Item Master (add / edit; stock itself changes only through
// Stock In, Sales, Returns and Stock Adjustment), Item List and Bulk Update,
// Excel import, plus the pick-lists the Item form uses.
const router = Router();

// Pick-lists: field -> table, id column, and the item column it fills. Type /
// Unit, Generic Name and Manufacturer are stored on the item by id (so a
// rename shows on items); Category and Potency are stored as text (a rename
// leaves items already saved as they were).
const LISTS = {
  unit: { table: 'UnitMaster', id: 'UnitId', label: 'Type / Unit', max: 50 },
  generic: { table: 'GenericNameMaster', id: 'GenericNameId', label: 'Generic Name', max: 200 },
  manufacturer: { table: 'ManufacturerMaster', id: 'ManufacturerId', label: 'Manufacturer', max: 200 },
  category: { table: 'CategoryMaster', id: 'CategoryId', label: 'Category', max: 100, sorted: true },
  potency: { table: 'PotencyMaster', id: 'PotencyId', label: 'Potency', max: 50, sorted: true },
};

const ITEM_CODE = `'ITM' + RIGHT('000000' + CAST(i.ItemId AS VARCHAR(10)), 6)`;
const MAX_GST = 28;

// Every item column the Item screens show. CGST / SGST fall back to half the
// old single GST % for items saved before the split.
const ITEM_SELECT = `
  SELECT i.ItemId, ${ITEM_CODE} AS ItemCode, i.Name, i.UnitId, u.Name AS UnitName,
         i.GenericNameId, g.Name AS GenericName, i.ManufacturerId, m.Name AS ManufacturerName,
         i.Category, i.Potency, i.HSNCode, i.Pack, i.Rack, i.BoxNo,
         i.MRP, i.SellPrice,
         ISNULL(i.CGSTPercent, i.GSTPercent / 2) AS CGSTPercent,
         ISNULL(i.SGSTPercent, i.GSTPercent / 2) AS SGSTPercent,
         i.GSTPercent,
         CASE WHEN i.ScheduleH1 = 1 THEN 'H1' WHEN i.ScheduleH = 1 THEN 'H' ELSE 'None' END AS Schedule,
         i.Status, ISNULL(st.CurrentStock, 0) AS Stock,
         ISNULL((SELECT TOP 1 pol.PRate FROM PurchaseOrderItem pol
                 JOIN PurchaseOrder po ON po.PurchaseOrderId = pol.PurchaseOrderId AND po.IsActive = 1
                 WHERE pol.ItemId = i.ItemId AND pol.PRate IS NOT NULL ORDER BY pol.LineId DESC), i.PurchaseRate) AS LastPRate
  FROM PharmacyItem i
  LEFT JOIN UnitMaster u ON u.UnitId = i.UnitId
  LEFT JOIN GenericNameMaster g ON g.GenericNameId = i.GenericNameId
  LEFT JOIN ManufacturerMaster m ON m.ManufacturerId = i.ManufacturerId
  LEFT JOIN (${CURRENT_STOCK}) st ON st.ItemId = i.ItemId
`;

// ---------- Pick-lists ----------

async function listValues(request, field) {
  const L = LISTS[field];
  const r = await request.query(`
    SELECT ${L.id} AS id, Name AS name FROM ${L.table} WHERE IsActive = 1
    ORDER BY ${L.sorted ? 'CASE WHEN SortOrder = 0 THEN 1 ELSE 0 END, SortOrder, ' : ''}Name
  `);
  return r.recordset;
}

// All pick-lists at once, plus the Pack values items already use.
router.get('/lists', async (req, res) => {
  try {
    const pool = await getPool();
    const out = {};
    for (const field of Object.keys(LISTS)) out[field] = await listValues(pool.request(), field);
    const packs = await pool.request().query(`
      SELECT DISTINCT LTRIM(RTRIM(Pack)) AS name FROM PharmacyItem
      WHERE IsActive = 1 AND LTRIM(RTRIM(ISNULL(Pack, ''))) <> '' ORDER BY name`);
    out.pack = packs.recordset.map((r) => r.name);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const listOf = (req, res) => {
  const L = LISTS[req.params.field];
  if (!L) res.status(404).json({ error: 'Unknown list' });
  return L;
};
const cleanName = (L, v) => {
  const name = String(v ?? '').trim();
  if (!name) return { error: 'Enter a name' };
  if (name.length > L.max) return { error: `${L.label} must be at most ${L.max} characters` };
  return { name };
};

// Adds a value; one that was deleted earlier comes back instead of a duplicate.
router.post('/lists/:field', async (req, res) => {
  try {
    const L = listOf(req, res);
    if (!L) return undefined;
    const { name, error } = cleanName(L, req.body?.name);
    if (error) return res.status(400).json({ error });
    const pool = await getPool();
    const found = await pool.request().input('name', sql.NVarChar, name)
      .query(`SELECT ${L.id} AS id, Name AS name, IsActive FROM ${L.table} WHERE LOWER(Name) = LOWER(@name)`);
    const hit = found.recordset.find((r) => r.IsActive) || found.recordset[0];
    if (hit) {
      if (!hit.IsActive) await pool.request().input('id', sql.Int, hit.id).query(`UPDATE ${L.table} SET IsActive = 1 WHERE ${L.id} = @id`);
      return res.json({ id: hit.id, name: hit.name });
    }
    const ins = await pool.request().input('name', sql.NVarChar, name)
      .query(`INSERT INTO ${L.table} (Name) OUTPUT INSERTED.${L.id} AS id, INSERTED.Name AS name VALUES (@name)`);
    res.status(201).json(ins.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/lists/:field/:id', async (req, res) => {
  try {
    const L = listOf(req, res);
    if (!L) return undefined;
    const { name, error } = cleanName(L, req.body?.name);
    if (error) return res.status(400).json({ error });
    const pool = await getPool();
    const dup = await pool.request().input('name', sql.NVarChar, name).input('id', sql.Int, req.params.id)
      .query(`SELECT 1 FROM ${L.table} WHERE IsActive = 1 AND LOWER(Name) = LOWER(@name) AND ${L.id} <> @id`);
    if (dup.recordset.length) return res.status(400).json({ error: `"${name}" already exists` });
    await pool.request().input('name', sql.NVarChar, name).input('id', sql.Int, req.params.id)
      .query(`UPDATE ${L.table} SET Name = @name WHERE ${L.id} = @id`);
    res.json({ id: Number(req.params.id), name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete only hides the value; items keep it.
router.delete('/lists/:field/:id', async (req, res) => {
  try {
    const L = listOf(req, res);
    if (!L) return undefined;
    const pool = await getPool();
    await pool.request().input('id', sql.Int, req.params.id).query(`UPDATE ${L.table} SET IsActive = 0 WHERE ${L.id} = @id`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Items ----------

// Item List / Bulk Update / pickers: every item with its current stock.
// ?status=Active limits it to active items.
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('itemId', sql.Int, null)
      .input('status', sql.NVarChar, req.query.status || '')
      .query(`${ITEM_SELECT} WHERE i.IsActive = 1 AND (@status = '' OR i.Status = @status) ORDER BY i.Name`);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('itemId', sql.Int, req.params.id)
      .query(`${ITEM_SELECT} WHERE i.ItemId = @itemId AND i.IsActive = 1`);
    if (!result.recordset.length) return res.status(404).json({ error: 'Item not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const text = (v) => (v == null ? '' : String(v).trim());
const isNum = (v) => text(v) !== '' && !Number.isNaN(Number(v));

// Finds a pick-list value by name (ignoring case); undefined when it isn't on the list.
async function findInList(request, field, name) {
  const L = LISTS[field];
  const r = await request.input(`n_${field}`, sql.NVarChar, name)
    .query(`SELECT ${L.id} AS id, Name AS name FROM ${L.table} WHERE IsActive = 1 AND LOWER(Name) = LOWER(@n_${field})`);
  return r.recordset[0];
}

// Checks the GST / MRP fields shared by the Item form and Bulk Update rows.
function checkPricing(v) {
  if (v.mrp !== undefined && v.mrp !== null && !(v.mrp >= 0)) return 'MRP must be 0 or more';
  for (const [k, label] of [['cgst', 'CGST %'], ['sgst', 'SGST %']]) {
    if (!(v[k] >= 0 && v[k] <= MAX_GST)) return `${label} must be between 0 and ${MAX_GST}`;
  }
  if (v.cgst + v.sgst > MAX_GST) return `CGST % + SGST % can't be more than ${MAX_GST}`;
  return null;
}

// Cleans and checks an Item form body against the pick-lists. Returns
// { error } or the values to save (ids resolved, numbers parsed).
async function checkItem(pool, body) {
  const v = {};
  v.name = text(body.name);
  if (!v.name) return { error: 'Item Name is required' };
  if (v.name.length > 200) return { error: 'Item Name must be at most 200 characters' };

  for (const field of ['unit', 'generic', 'manufacturer', 'category', 'potency']) {
    const name = text(body[field]);
    if (!name) { v[field] = null; continue; }
    const hit = await findInList(pool.request(), field, name);
    if (!hit) return { error: `${LISTS[field].label} "${name}" isn't on the list — pick one or add it with + New` };
    v[field] = hit;
  }
  for (const [k, label, max] of [['hsnCode', 'HSN Code', 30], ['pack', 'Pack', 50], ['rack', 'Rack', 50], ['boxNo', 'Box', 50]]) {
    v[k] = text(body[k]) || null;
    if (v[k] && v[k].length > max) return { error: `${label} must be at most ${max} characters` };
  }
  v.mrp = isNum(body.mrp) ? Number(body.mrp) : null;
  v.cgst = isNum(body.cgstPercent) ? Number(body.cgstPercent) : 0;
  v.sgst = isNum(body.sgstPercent) ? Number(body.sgstPercent) : 0;
  const pricing = checkPricing(v);
  if (pricing) return { error: pricing };
  v.schedule = text(body.schedule) || 'None';
  if (!['None', 'H', 'H1'].includes(v.schedule)) return { error: 'Schedule must be None, H or H1' };
  v.status = text(body.status) || 'Active';
  if (!['Active', 'Inactive'].includes(v.status)) return { error: 'Status must be Active or Inactive' };
  return v;
}

function bindItem(request, v) {
  return request
    .input('name', sql.NVarChar(200), v.name)
    .input('unitId', sql.Int, v.unit?.id ?? null)
    .input('genericId', sql.Int, v.generic?.id ?? null)
    .input('manufacturerId', sql.Int, v.manufacturer?.id ?? null)
    .input('category', sql.NVarChar(100), v.category?.name ?? null)
    .input('potency', sql.NVarChar(50), v.potency?.name ?? null)
    .input('hsn', sql.NVarChar(30), v.hsnCode)
    .input('pack', sql.NVarChar(50), v.pack)
    .input('rack', sql.NVarChar(50), v.rack)
    .input('box', sql.NVarChar(50), v.boxNo)
    .input('mrp', sql.Decimal(10, 2), v.mrp)
    .input('cgst', sql.Decimal(5, 2), v.cgst)
    .input('sgst', sql.Decimal(5, 2), v.sgst)
    .input('gst', sql.Decimal(5, 2), v.cgst + v.sgst)
    .input('h', sql.Bit, v.schedule === 'H' ? 1 : 0)
    .input('h1', sql.Bit, v.schedule === 'H1' ? 1 : 0)
    .input('status', sql.NVarChar(10), v.status);
}

// Add: starts with no stock (Stock In or Stock Adjustment adds it); selling
// price starts at MRP.
router.post('/', async (req, res) => {
  const pool = await getPool();
  const v = await checkItem(pool, req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const ins = await bindItem(pool.request(), v).query(`
      INSERT INTO PharmacyItem (Name, UnitId, GenericNameId, ManufacturerId, Category, Potency, HSNCode, Pack, Rack, BoxNo,
                                MRP, SellPrice, CGSTPercent, SGSTPercent, GSTPercent, ScheduleH, ScheduleH1, Status)
      OUTPUT INSERTED.ItemId
      VALUES (@name, @unitId, @genericId, @manufacturerId, @category, @potency, @hsn, @pack, @rack, @box,
              @mrp, @mrp, @cgst, @sgst, @gst, @h, @h1, @status)`);
    const itemId = ins.recordset[0].ItemId;
    res.status(201).json({ ItemId: itemId, ItemCode: `ITM${String(itemId).padStart(6, '0')}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit: item details only — stock isn't changed here. A lower MRP also brings
// the selling price down to it.
router.put('/:id', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: 'Bad item id' });
  const pool = await getPool();
  const v = await checkItem(pool, req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  try {
    const upd = await bindItem(pool.request(), v).input('id', sql.Int, itemId).query(`
      UPDATE PharmacyItem
      SET Name = @name, UnitId = @unitId, GenericNameId = @genericId, ManufacturerId = @manufacturerId,
          Category = @category, Potency = @potency, HSNCode = @hsn, Pack = @pack, Rack = @rack, BoxNo = @box,
          MRP = @mrp, CGSTPercent = @cgst, SGSTPercent = @sgst, GSTPercent = @gst,
          SellPrice = CASE WHEN @mrp IS NOT NULL AND (SellPrice IS NULL OR SellPrice > @mrp) THEN @mrp ELSE SellPrice END,
          ScheduleH = @h, ScheduleH1 = @h1, Status = @status, EditedAt = GETDATE()
      WHERE ItemId = @id AND IsActive = 1`);
    if (!upd.rowsAffected[0]) return res.status(404).json({ error: 'Item not found' });
    res.json({ ItemId: itemId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import from the Excel template (Item > Bulk Update > Upload). Body: { rows:
// [{ row, itemCode, name, pack, unit, hsnCode, mrp, cgstPercent, sgstPercent,
// rack, boxNo, generic, manufacturer, category, potency, schedule, status }] }.
// A row with an Item Code updates that item; otherwise one with the same Item
// Name (ignoring case) is updated, else a new item is added. Pick-list values
// not on the list yet are added. All rows are saved or none: bad rows come back
// as { errors: [{ row, name, error }] }. Admin only.
const IMPORT_MAX = 5000;
router.post('/import', async (req, res) => {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can import items' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'The file has no item rows' });
  if (rows.length > IMPORT_MAX) return res.status(400).json({ error: `At most ${IMPORT_MAX} rows at a time` });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    const errors = [];

    // Pick-list values: add the missing ones (or bring deleted ones back), then
    // keep every list in memory as lower-case name -> { id, name }.
    const lists = {};
    for (const field of Object.keys(LISTS)) {
      const L = LISTS[field];
      const wanted = new Map();
      for (const r of rows) {
        const name = text(r[field]);
        if (!name) continue;
        if (name.length > L.max) errors.push({ row: r.row, name: text(r.name), error: `${L.label} must be at most ${L.max} characters` });
        else if (!wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
      }
      const all = await new sql.Request(tx).query(`SELECT ${L.id} AS id, Name AS name, IsActive FROM ${L.table}`);
      const byName = new Map();
      for (const v of all.recordset) {
        const k = v.name.trim().toLowerCase();
        if (!byName.has(k) || v.IsActive) byName.set(k, v);
      }
      for (const [k, name] of wanted) {
        const hit = byName.get(k);
        if (hit && !hit.IsActive) {
          await new sql.Request(tx).input('id', sql.Int, hit.id).query(`UPDATE ${L.table} SET IsActive = 1 WHERE ${L.id} = @id`);
        } else if (!hit) {
          const ins = await new sql.Request(tx).input('name', sql.NVarChar, name)
            .query(`INSERT INTO ${L.table} (Name) OUTPUT INSERTED.${L.id} AS id, INSERTED.Name AS name VALUES (@name)`);
          byName.set(k, ins.recordset[0]);
        }
      }
      lists[field] = byName;
    }

    const existing = await new sql.Request(tx).query('SELECT ItemId, Name FROM PharmacyItem WHERE IsActive = 1');
    const idByName = new Map(existing.recordset.map((i) => [i.Name.trim().toLowerCase(), i.ItemId]));
    const activeIds = new Set(existing.recordset.map((i) => i.ItemId));

    const plan = [];
    const seenNames = new Map();
    const seenIds = new Set();
    for (const r of rows) {
      const name = text(r.name);
      const fail = (error) => errors.push({ row: r.row, name, error });
      if (!name) { fail('Item Name is required'); continue; }
      if (name.length > 200) { fail('Item Name must be at most 200 characters'); continue; }
      const key = name.toLowerCase();
      if (seenNames.has(key)) { fail(`Same Item Name as row ${seenNames.get(key)}`); continue; }
      seenNames.set(key, r.row);

      let itemId = null;
      const code = text(r.itemCode);
      if (code) {
        const m = /^ITM0*(\d+)$/i.exec(code);
        itemId = m ? Number(m[1]) : null;
        if (!itemId || !activeIds.has(itemId)) { fail(`Item Code ${code} isn't an existing item — leave it blank to add a new item`); continue; }
        const other = idByName.get(key);
        if (other && other !== itemId) { fail(`Another item is already called "${name}"`); continue; }
      } else {
        itemId = idByName.get(key) ?? null;
      }
      if (itemId && seenIds.has(itemId)) { fail('This item is already in the file on another row'); continue; }
      if (itemId) seenIds.add(itemId);

      const v = { name };
      for (const field of Object.keys(LISTS)) {
        const n = text(r[field]);
        v[field] = n ? lists[field].get(n.toLowerCase()) || null : null;
      }
      let bad = null;
      for (const [k, label, max] of [['hsnCode', 'HSN Code', 30], ['pack', 'Pack', 50], ['rack', 'Rack', 50], ['boxNo', 'Box', 50]]) {
        v[k] = text(r[k]) || null;
        if (v[k] && v[k].length > max) bad = `${label} must be at most ${max} characters`;
      }
      for (const [k, label] of [['mrp', 'MRP'], ['cgstPercent', 'CGST %'], ['sgstPercent', 'SGST %']]) {
        if (text(r[k]) !== '' && !isNum(r[k])) bad = bad || `${label} must be a number`;
      }
      v.mrp = isNum(r.mrp) ? Number(r.mrp) : null;
      v.cgst = isNum(r.cgstPercent) ? Number(r.cgstPercent) : 0;
      v.sgst = isNum(r.sgstPercent) ? Number(r.sgstPercent) : 0;
      bad = bad || checkPricing(v);
      const schedule = text(r.schedule) || 'None';
      v.schedule = { none: 'None', h: 'H', h1: 'H1' }[schedule.toLowerCase()];
      if (!v.schedule) bad = bad || 'Schedule must be None, H or H1';
      const status = text(r.status) || 'Active';
      v.status = { active: 'Active', inactive: 'Inactive' }[status.toLowerCase()];
      if (!v.status) bad = bad || 'Status must be Active or Inactive';
      if (bad) { fail(bad); continue; }
      plan.push({ itemId, v });
    }

    if (errors.length) {
      await tx.rollback();
      return res.status(400).json({ error: `${errors.length} row(s) need fixing — nothing was saved`, errors });
    }

    let added = 0;
    let updated = 0;
    for (const { itemId, v } of plan) {
      if (itemId) {
        await bindItem(new sql.Request(tx), v).input('id', sql.Int, itemId).query(`
          UPDATE PharmacyItem
          SET Name = @name, UnitId = @unitId, GenericNameId = @genericId, ManufacturerId = @manufacturerId,
              Category = @category, Potency = @potency, HSNCode = @hsn, Pack = @pack, Rack = @rack, BoxNo = @box,
              MRP = @mrp, CGSTPercent = @cgst, SGSTPercent = @sgst, GSTPercent = @gst,
              SellPrice = CASE WHEN @mrp IS NOT NULL AND (SellPrice IS NULL OR SellPrice > @mrp) THEN @mrp ELSE SellPrice END,
              ScheduleH = @h, ScheduleH1 = @h1, Status = @status, EditedAt = GETDATE()
          WHERE ItemId = @id`);
        updated += 1;
      } else {
        await bindItem(new sql.Request(tx), v).query(`
          INSERT INTO PharmacyItem (Name, UnitId, GenericNameId, ManufacturerId, Category, Potency, HSNCode, Pack, Rack, BoxNo,
                                    MRP, SellPrice, CGSTPercent, SGSTPercent, GSTPercent, ScheduleH, ScheduleH1, Status)
          VALUES (@name, @unitId, @genericId, @manufacturerId, @category, @potency, @hsn, @pack, @rack, @box,
                  @mrp, @mrp, @cgst, @sgst, @gst, @h, @h1, @status)`);
        added += 1;
      }
    }
    await tx.commit();
    res.json({ added, updated });
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    res.status(500).json({ error: err.message });
  }
});

// Delete (Admin only): hides an item that no order, Stock In, return or bill
// uses and that has no stock. One already used can't be deleted, so its
// documents still show it; set it Inactive instead to keep it out of the pickers.
const ITEM_USED_IN = [
  ['PurchaseOrderItem', 'purchase order'], ['StockInItem', 'Stock In'], ['StockReturnItem', 'stock return'],
  ['SalesBillingItem', 'sales bill'], ['SalesReturnItem', 'sales return'], ['StockAdjustmentItem', 'stock adjustment'],
];
router.delete('/:id', async (req, res) => {
  if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can delete an item' });
  const itemId = Number(req.params.id);
  if (!Number.isInteger(itemId) || itemId <= 0) return res.status(400).json({ error: 'Bad item id' });
  try {
    const pool = await getPool();
    const r = await pool.request().input('itemId', sql.Int, itemId).query(`
      SELECT i.Name, ISNULL(st.CurrentStock, 0) AS Stock,
             ${ITEM_USED_IN.map(([t], k) => `(SELECT COUNT(*) FROM ${t} WHERE ItemId = @itemId) AS u${k}`).join(', ')}
      FROM PharmacyItem i
      LEFT JOIN (${CURRENT_STOCK}) st ON st.ItemId = i.ItemId
      WHERE i.ItemId = @itemId AND i.IsActive = 1`);
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: 'Item not found' });
    const used = ITEM_USED_IN.filter((_, k) => row[`u${k}`] > 0).map(([, label]) => label);
    if (used.length) {
      return res.status(409).json({ error: `${row.Name} is used in ${used.join(', ')} — it can't be deleted. Set its Status to Inactive instead.` });
    }
    if (Number(row.Stock) !== 0) {
      return res.status(409).json({ error: `${row.Name} has ${Number(row.Stock)} in stock — it can't be deleted. Set its Status to Inactive instead.` });
    }
    await pool.request().input('itemId', sql.Int, itemId)
      .query('UPDATE PharmacyItem SET IsActive = 0, EditedAt = GETDATE() WHERE ItemId = @itemId');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk Update: saves every changed row in one go, or none of them. Each row is
// { itemId, ...only the fields that changed }. Bad rows come back as
// { errors: [{ itemId, name, error }] } and nothing is saved.
router.post('/bulk-update', async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'Nothing to save' });
  const pool = await getPool();
  try {
    const ids = [...new Set(rows.map((r) => Number(r.itemId)).filter((n) => Number.isInteger(n) && n > 0))];
    const current = await pool.request().input('itemId', sql.Int, null).input('ids', sql.NVarChar(sql.MAX), ids.join(','))
      .query(`${ITEM_SELECT} WHERE i.IsActive = 1 AND i.ItemId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`);
    const byId = new Map(current.recordset.map((r) => [r.ItemId, r]));
    const lists = {};
    for (const f of ['category', 'potency', 'manufacturer']) {
      lists[f] = new Map((await listValues(pool.request(), f)).map((o) => [o.name.toLowerCase(), o]));
    }

    const errors = [];
    const plans = [];
    for (const r of rows) {
      const item = byId.get(Number(r.itemId));
      if (!item) { errors.push({ itemId: r.itemId, name: '', error: 'Item not found' }); continue; }
      const fail = (error) => errors.push({ itemId: item.ItemId, name: item.Name, error });
      const sets = {};
      let bad = false;
      for (const f of ['category', 'potency', 'manufacturer']) {
        if (!(f in r)) continue;
        const name = text(r[f]);
        const hit = name ? lists[f].get(name.toLowerCase()) : null;
        if (name && !hit) { fail(`${LISTS[f].label} "${name}" isn't on the list`); bad = true; break; }
        sets[f] = hit;
      }
      if (bad) continue;
      for (const [k, label, max] of [['pack', 'Pack', 50], ['hsnCode', 'HSN Code', 30], ['rack', 'Rack', 50], ['boxNo', 'Box', 50]]) {
        if (!(k in r)) continue;
        sets[k] = text(r[k]) || null;
        if (sets[k] && sets[k].length > max) { fail(`${label} must be at most ${max} characters`); bad = true; break; }
      }
      if (bad) continue;
      if ('status' in r) {
        sets.status = text(r.status);
        if (!['Active', 'Inactive'].includes(sets.status)) { fail('Status must be Active or Inactive'); continue; }
      }
      // Pricing is checked on the row as it will be after the change.
      const after = {
        mrp: 'mrp' in r ? (text(r.mrp) === '' ? null : Number(r.mrp)) : (item.MRP == null ? null : Number(item.MRP)),
        cgst: 'cgstPercent' in r ? (text(r.cgstPercent) === '' ? 0 : Number(r.cgstPercent)) : Number(item.CGSTPercent || 0),
        sgst: 'sgstPercent' in r ? (text(r.sgstPercent) === '' ? 0 : Number(r.sgstPercent)) : Number(item.SGSTPercent || 0),
      };
      if (('mrp' in r && text(r.mrp) !== '' && !isNum(r.mrp)) || Number.isNaN(after.cgst) || Number.isNaN(after.sgst)) {
        fail('MRP, CGST % and SGST % must be numbers'); continue;
      }
      const pricing = checkPricing(after);
      if (pricing) { fail(pricing); continue; }
      plans.push({ id: item.ItemId, r, sets, after });
    }
    if (errors.length) return res.status(400).json({ error: `${errors.length} row(s) need fixing — nothing was saved`, errors });

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const { id, r, sets, after } of plans) {
        const q = new sql.Request(tx).input('id', sql.Int, id);
        const cols = [];
        const put = (col, name, type, value) => { q.input(name, type, value); cols.push(`${col} = @${name}`); };
        if ('category' in sets) put('Category', 'category', sql.NVarChar(100), sets.category?.name ?? null);
        if ('potency' in sets) put('Potency', 'potency', sql.NVarChar(50), sets.potency?.name ?? null);
        if ('manufacturer' in sets) put('ManufacturerId', 'manufacturerId', sql.Int, sets.manufacturer?.id ?? null);
        if ('pack' in sets) put('Pack', 'pack', sql.NVarChar(50), sets.pack);
        if ('hsnCode' in sets) put('HSNCode', 'hsn', sql.NVarChar(30), sets.hsnCode);
        if ('rack' in sets) put('Rack', 'rack', sql.NVarChar(50), sets.rack);
        if ('boxNo' in sets) put('BoxNo', 'box', sql.NVarChar(50), sets.boxNo);
        if ('status' in sets) put('Status', 'status', sql.NVarChar(10), sets.status);
        if ('mrp' in r) {
          put('MRP', 'mrp', sql.Decimal(10, 2), after.mrp);
          cols.push('SellPrice = CASE WHEN @mrp IS NOT NULL AND (SellPrice IS NULL OR SellPrice > @mrp) THEN @mrp ELSE SellPrice END');
        }
        if ('cgstPercent' in r || 'sgstPercent' in r) {
          put('CGSTPercent', 'cgst', sql.Decimal(5, 2), after.cgst);
          put('SGSTPercent', 'sgst', sql.Decimal(5, 2), after.sgst);
          put('GSTPercent', 'gst', sql.Decimal(5, 2), after.cgst + after.sgst);
        }
        if (!cols.length) continue;
        await q.query(`UPDATE PharmacyItem SET ${cols.join(', ')}, EditedAt = GETDATE() WHERE ItemId = @id`);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
    res.json({ saved: plans.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
