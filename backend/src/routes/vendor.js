import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';

const router = Router();

// Body field -> [column, max length]. ContactNo is the form's Mobile No and
// AlternateNo its Phone No. CompanyName is no longer on the form but is kept
// so older rows (and callers that still send it) don't lose it.
const FIELDS = {
  vendorName: ['VendorName', 200],
  companyName: ['CompanyName', 200],
  contactPerson: ['ContactPerson', 150],
  contactNo: ['ContactNo', 20],
  alternateNo: ['AlternateNo', 20],
  address: ['Address', 500],
  state: ['State', 60],
  pincode: ['Pincode', 6],
  gstNo: ['GSTNo', 30],
  dlNo: ['DLNo', 50],
  dlNo2: ['DLNo2', 50],
  email: ['Email', 150],
  status: ['Status', 10],
};

// Stored in capitals whatever case they're typed in.
const UPPER = new Set(['gstNo', 'dlNo', 'dlNo2']);
// Must be filled on create, and an edit that sends them can't clear them.
const REQUIRED = { vendorName: 'Vendor name', address: 'Address', contactNo: 'Mobile No' };

const PHONE = /^\+?[0-9][0-9\s-]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trimmed (and capitalised where needed) values for the fields the body sends.
// A null counts as not sent: callers echoing back a row pass null for empty
// columns, and that shouldn't trip the "can't clear" check.
function clean(body) {
  const out = {};
  for (const key of Object.keys(FIELDS)) {
    if (body[key] == null) continue;
    let v = String(body[key]).trim();
    if (UPPER.has(key)) v = v.toUpperCase();
    out[key] = v;
  }
  return out;
}

// First problem with the values, or null. `isCreate` makes the required fields
// mandatory even when left out of the body.
function validate(v, isCreate) {
  for (const [key, label] of Object.entries(REQUIRED)) {
    if ((isCreate || key in v) && !v[key]) return `${label} is required`;
  }
  for (const [key, [, len]] of Object.entries(FIELDS)) {
    if (v[key] && v[key].length > len) return `${key} must be at most ${len} characters`;
  }
  if (v.contactNo && !PHONE.test(v.contactNo)) return 'Mobile No must contain numbers only';
  if (v.alternateNo && !PHONE.test(v.alternateNo)) return 'Phone No must contain numbers only';
  if (v.pincode && !/^\d{6}$/.test(v.pincode)) return 'Pin code must be 6 digits';
  if (v.gstNo && !/^[0-9A-Z]{15}$/.test(v.gstNo)) return 'GSTIN must be 15 letters / digits';
  if (v.email && !EMAIL.test(v.email)) return 'Enter a valid email address';
  if (v.status && !['Active', 'Inactive'].includes(v.status)) return 'Status must be Active or Inactive';
  return null;
}

function bind(request, v) {
  for (const [key, value] of Object.entries(v)) {
    request.input(key, sql.NVarChar(FIELDS[key][1]), value || null);
  }
  return request;
}

router.get('/', async (req, res) => {
  try {
    const { search = '', activeOnly } = req.query;
    const pool = await getPool();
    const result = await pool
      .request()
      .input('search', sql.NVarChar, `%${search}%`)
      .input('activeOnly', sql.Bit, activeOnly === '1' || activeOnly === 'true' ? 1 : 0)
      .query(`
        SELECT VendorId, VendorName, CompanyName, ContactPerson, ContactNo, AlternateNo,
               Address, State, Pincode, GSTNo, DLNo, DLNo2, Email, Status, CreatedAt
        FROM Vendor
        WHERE IsActive = 1
          AND (@activeOnly = 0 OR Status = 'Active')
          AND (@search = '%%' OR VendorName LIKE @search OR CompanyName LIKE @search
               OR ContactPerson LIKE @search OR ContactNo LIKE @search OR GSTNo LIKE @search
               OR State LIKE @search)
        ORDER BY VendorId DESC
      `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const v = { status: 'Active', ...clean(req.body) };
    if (!v.status) v.status = 'Active';
    const problem = validate(v, true);
    if (problem) return res.status(400).json({ error: problem });
    const pool = await getPool();
    const keys = Object.keys(v);
    const result = await bind(pool.request(), v).query(`
      INSERT INTO Vendor (${keys.map((k) => FIELDS[k][0]).join(', ')})
      OUTPUT INSERTED.*
      VALUES (${keys.map((k) => `@${k}`).join(', ')})
    `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Only the fields the body sends are changed, so a caller that only knows
// some of them (e.g. a rename from Purchase Master) can't wipe the rest.
router.put('/:id', async (req, res) => {
  try {
    const v = clean(req.body);
    if (!Object.keys(v).length) return res.status(400).json({ error: 'Nothing to update' });
    const problem = validate(v, false);
    if (problem) return res.status(400).json({ error: problem });
    const pool = await getPool();
    const sets = Object.keys(v).map((k) => `${FIELDS[k][0]} = @${k}`).join(', ');
    const result = await bind(pool.request(), v)
      .input('id', sql.Int, req.params.id)
      .query(`
        UPDATE Vendor
        SET ${sets}
        OUTPUT INSERTED.*
        WHERE VendorId = @id AND IsActive = 1
      `);
    if (!result.recordset.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input('id', sql.Int, req.params.id)
      .query('UPDATE Vendor SET IsActive = 0 WHERE VendorId = @id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
