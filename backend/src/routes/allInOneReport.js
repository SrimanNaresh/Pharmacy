import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNoSql } from '../utils/docNumber.js';
import { CURRENT_STOCK } from '../utils/stockEvents.js';

// Pharmacy > Report > All in One: pick a screen, then the columns to show.
// Each screen lists its columns here as SQL expressions, so only these can be
// asked for. A screen with item lines has `lines`: picking any line column
// gives one row per line (header columns repeat on each); otherwise one row
// per document. Deleted (soft-deleted) documents are left out.
const router = Router();

const ITEM_CODE = `'ITM' + RIGHT('000000' + CAST(i.ItemId AS VARCHAR(10)), 6)`;
const SCHEDULE = `CASE WHEN i.ScheduleH1 = 1 THEN 'H1' WHEN i.ScheduleH = 1 THEN 'H' ELSE 'None' END`;
const docOrNull = (prefix, idExpr) => `CASE WHEN ${idExpr} IS NULL THEN NULL ELSE ${docNoSql(prefix, idExpr)} END`;

// Column: [key, label, sql, type]; type is text (default) | date | qty | money | percent.
const SCREENS = {
  item: {
    label: 'Item',
    from: `PharmacyItem i
      LEFT JOIN UnitMaster u ON u.UnitId = i.UnitId
      LEFT JOIN GenericNameMaster g ON g.GenericNameId = i.GenericNameId
      LEFT JOIN ManufacturerMaster m ON m.ManufacturerId = i.ManufacturerId
      LEFT JOIN (${CURRENT_STOCK}) st ON st.ItemId = i.ItemId`,
    where: 'i.IsActive = 1',
    order: 'i.Name',
    filters: ['generic', 'manufacturer', 'category', 'potency', 'unit', 'schedule', 'status'],
    fixedValues: { schedule: ['None', 'H', 'H1'], status: ['Active', 'Inactive'] },
    columns: [
      ['itemCode', 'Item Code', ITEM_CODE],
      ['itemName', 'Item Name', 'i.Name'],
      ['generic', 'Generic Name', 'g.Name'],
      ['manufacturer', 'Manufacturer', 'm.Name'],
      ['category', 'Category', 'i.Category'],
      ['potency', 'Potency', 'i.Potency'],
      ['unit', 'Type / Unit', 'u.Name'],
      ['pack', 'Pack', 'i.Pack'],
      ['hsn', 'HSN', 'i.HSNCode'],
      ['rack', 'Rack', 'i.Rack'],
      ['box', 'Box', 'i.BoxNo'],
      ['mrp', 'MRP', 'i.MRP', 'money'],
      ['sellPrice', 'Sell Price', 'i.SellPrice', 'money'],
      ['cgst', 'CGST %', 'ISNULL(i.CGSTPercent, i.GSTPercent / 2)', 'percent'],
      ['sgst', 'SGST %', 'ISNULL(i.SGSTPercent, i.GSTPercent / 2)', 'percent'],
      ['gst', 'GST %', 'i.GSTPercent', 'percent'],
      ['schedule', 'Schedule', SCHEDULE],
      ['status', 'Status', 'i.Status'],
      ['stock', 'Current Stock', 'ISNULL(st.CurrentStock, 0)', 'qty'],
      ['stockValue', 'Stock Value', 'ISNULL(st.CurrentStock, 0) * ISNULL(i.SellPrice, 0)', 'money'],
    ],
  },
  vendor: {
    label: 'Vendor',
    from: 'Vendor v',
    where: 'v.IsActive = 1',
    order: 'v.VendorName',
    filters: ['state', 'status'],
    fixedValues: { status: ['Active', 'Inactive'] },
    columns: [
      ['vendorName', 'Vendor Name', 'v.VendorName'],
      ['company', 'Company', 'v.CompanyName'],
      ['contactPerson', 'Contact Person', 'v.ContactPerson'],
      ['contactNo', 'Contact No', 'v.ContactNo'],
      ['alternateNo', 'Alternate No', 'v.AlternateNo'],
      ['email', 'Email', 'v.Email'],
      ['address', 'Address', 'v.Address'],
      ['state', 'State', 'v.State'],
      ['pincode', 'Pincode', 'v.Pincode'],
      ['gstNo', 'GST No', 'v.GSTNo'],
      ['dlNo', 'DL No', 'v.DLNo'],
      ['dlNo2', 'DL No 2', 'v.DLNo2'],
      ['status', 'Status', 'v.Status'],
    ],
  },
  purchaseOrder: {
    label: 'Purchase / Order',
    from: 'PurchaseOrder h JOIN Vendor v ON v.VendorId = h.VendorId',
    where: 'h.IsActive = 1',
    date: 'h.OrderDate',
    order: 'h.OrderDate, h.PurchaseOrderId',
    filters: ['vendor', 'createdBy', 'manufacturer', 'category', 'unit'],
    columns: [
      ['orderNo', 'PO No', docNoSql('PO', 'h.PurchaseOrderId')],
      ['orderDate', 'Order Date', 'h.OrderDate', 'date'],
      ['vendor', 'Vendor', 'v.VendorName'],
      ['roundOff', 'Round Off', 'h.RoundOff', 'money'],
      ['totalAmount', 'Total Amount', 'h.TotalAmount', 'money'],
      ['createdBy', 'Created By', 'h.CreatedBy'],
    ],
    lines: {
      join: 'JOIN PurchaseOrderItem l ON l.PurchaseOrderId = h.PurchaseOrderId',
      order: 'l.LineId',
      columns: [
        ['itemName', 'Item Name', 'l.ItemName'],
        ['generic', 'Generic Name', 'l.GenericName'],
        ['manufacturer', 'Manufacturer', 'l.Manufacturer'],
        ['category', 'Category', 'l.Category'],
        ['hsn', 'HSN', 'l.HSNCode'],
        ['pack', 'Pack', 'l.Pack'],
        ['unit', 'Unit', 'l.Unit'],
        ['quantity', 'Quantity', 'l.Quantity', 'qty'],
        ['freeQty', 'Free Qty', 'l.FreeQty', 'qty'],
        ['pRate', 'P.Rate', 'l.PRate', 'money'],
        ['mrp', 'MRP', 'l.MRP', 'money'],
        ['discPercent', 'Disc %', 'l.DiscPercent', 'percent'],
        ['rate', 'Rate', 'l.Rate', 'money'],
        ['amount', 'Amount', 'l.Amount', 'money'],
        ['gstPercent', 'GST %', 'l.GSTPercent', 'percent'],
        ['gstAmount', 'GST Amount', 'l.GSTAmount', 'money'],
        ['lineTotal', 'Line Total', 'l.Total', 'money'],
      ],
    },
  },
  stockIn: {
    label: 'Stock In',
    from: 'StockIn h JOIN Vendor v ON v.VendorId = h.VendorId',
    where: 'h.IsActive = 1',
    date: 'h.InDate',
    order: 'h.InDate, h.StockInId',
    filters: ['vendor', 'createdBy'],
    columns: [
      ['stockInNo', 'Stock In No', docNoSql('SI', 'h.StockInId')],
      ['inDate', 'In Date', 'h.InDate', 'date'],
      ['vendor', 'Vendor', 'v.VendorName'],
      ['orderNo', 'PO No', docOrNull('PO', 'h.PurchaseOrderId')],
      ['createdBy', 'Created By', 'h.CreatedBy'],
    ],
    lines: {
      join: 'JOIN StockInItem l ON l.StockInId = h.StockInId JOIN PharmacyItem i ON i.ItemId = l.ItemId',
      order: 'l.LineId',
      columns: [
        ['itemCode', 'Item Code', ITEM_CODE],
        ['itemName', 'Item Name', 'i.Name'],
        ['batch', 'Batch', 'l.BatchNo'],
        ['mfgDate', 'Mfg Date', 'l.MfgDate', 'date'],
        ['expDate', 'Exp Date', 'l.ExpDate', 'date'],
        ['quantity', 'Quantity', 'l.Quantity', 'qty'],
        ['freeQty', 'Free Qty', 'l.FreeQty', 'qty'],
        ['rate', 'Rate', 'l.Rate', 'money'],
        ['mrp', 'MRP', 'l.MRP', 'money'],
        ['discPercent', 'Disc %', 'l.DiscPercent', 'percent'],
        ['selAmount', 'Sel.Amount', 'l.SelAmount', 'money'],
        ['amount', 'Amount (Qty × Rate)', 'l.Quantity * l.Rate', 'money'],
      ],
    },
  },
  stockReturn: {
    label: 'Return (to Vendor)',
    from: 'StockReturn h JOIN Vendor v ON v.VendorId = h.VendorId',
    where: 'h.IsActive = 1',
    date: 'h.ReturnDate',
    order: 'h.ReturnDate, h.StockReturnId',
    filters: ['vendor', 'createdBy'],
    columns: [
      ['returnNo', 'Return No', docNoSql('RT', 'h.StockReturnId')],
      ['returnDate', 'Return Date', 'h.ReturnDate', 'date'],
      ['vendor', 'Vendor', 'v.VendorName'],
      ['stockInNo', 'Stock In No', docOrNull('SI', 'h.StockInId')],
      ['totalAmount', 'Total Amount', 'h.TotalAmount', 'money'],
      ['createdBy', 'Created By', 'h.CreatedBy'],
    ],
    lines: {
      join: 'JOIN StockReturnItem l ON l.StockReturnId = h.StockReturnId JOIN PharmacyItem i ON i.ItemId = l.ItemId',
      order: 'l.LineId',
      columns: [
        ['itemCode', 'Item Code', ITEM_CODE],
        ['itemName', 'Item Name', 'i.Name'],
        ['batch', 'Batch', 'l.BatchNo'],
        ['mfgDate', 'Mfg Date', 'l.MfgDate', 'date'],
        ['expDate', 'Exp Date', 'l.ExpDate', 'date'],
        ['quantity', 'Quantity', 'l.Quantity', 'qty'],
        ['rate', 'Rate', 'l.Rate', 'money'],
        ['amount', 'Amount', 'l.Amount', 'money'],
      ],
    },
  },
  sales: {
    label: 'Sales',
    from: 'SalesBilling h',
    where: 'h.IsActive = 1',
    date: 'h.TransDate',
    order: 'h.TransDate, h.SalesBillingId',
    filters: ['createdBy', 'saleUnit'],
    columns: [
      ['billNo', 'Bill No', docNoSql('S', 'h.SalesBillingId')],
      ['billDate', 'Bill Date', 'h.TransDate', 'date'],
      ['customer', 'Customer', 'h.CustomerName'],
      ['mobile', 'Mobile No', 'h.MobileNo'],
      ['subTotal', 'Sub Total', 'h.SubTotal', 'money'],
      ['discPercent', 'Bill Disc %', 'h.DiscPercent', 'percent'],
      ['discount', 'Discount', 'h.DiscountAmount', 'money'],
      ['roundOff', 'Round Off', 'h.RoundOff', 'money'],
      ['totalAmount', 'Total Amount', 'h.TotalAmount', 'money'],
      ['createdBy', 'Created By', 'h.CreatedBy'],
    ],
    lines: {
      join: 'JOIN SalesBillingItem l ON l.SalesBillingId = h.SalesBillingId JOIN PharmacyItem i ON i.ItemId = l.ItemId',
      order: 'l.LineId',
      columns: [
        ['itemCode', 'Item Code', ITEM_CODE],
        ['itemName', 'Item Name', 'i.Name'],
        ['batch', 'Batch', 'l.Batch'],
        ['expiry', 'Expiry', 'l.ExpiryDate', 'date'],
        ['saleUnit', 'Sale Unit', "ISNULL(l.SaleUnit, 'pack')"],
        ['quantity', 'Quantity', 'ISNULL(l.UnitQty, l.Quantity)', 'qty'],
        ['rate', 'Rate', 'l.Rate', 'money'],
        ['lineDisc', 'Item Disc %', 'l.DiscPercent', 'percent'],
        ['amount', 'Amount', 'l.Amount', 'money'],
      ],
    },
  },
  salesReturn: {
    label: 'Sales Return',
    from: 'SalesReturn h',
    where: 'h.IsActive = 1',
    date: 'h.TransDate',
    order: 'h.TransDate, h.SalesReturnId',
    filters: ['createdBy', 'saleUnit'],
    columns: [
      ['returnNo', 'Return No', docNoSql('SR', 'h.SalesReturnId')],
      ['returnDate', 'Return Date', 'h.TransDate', 'date'],
      ['billNo', 'Bill No', docOrNull('S', 'h.SalesBillingId')],
      ['customer', 'Customer', 'h.CustomerName'],
      ['mobile', 'Mobile No', 'h.MobileNo'],
      ['subTotal', 'Sub Total', 'h.SubTotal', 'money'],
      ['discPercent', 'Disc %', 'h.DiscPercent', 'percent'],
      ['discount', 'Discount', 'h.DiscountAmount', 'money'],
      ['totalAmount', 'Total Amount', 'h.TotalAmount', 'money'],
      ['createdBy', 'Created By', 'h.CreatedBy'],
    ],
    lines: {
      join: 'JOIN SalesReturnItem l ON l.SalesReturnId = h.SalesReturnId JOIN PharmacyItem i ON i.ItemId = l.ItemId',
      order: 'l.LineId',
      columns: [
        ['itemCode', 'Item Code', ITEM_CODE],
        ['itemName', 'Item Name', 'i.Name'],
        ['batch', 'Batch', 'l.Batch'],
        ['expiry', 'Expiry', 'l.ExpiryDate', 'date'],
        ['saleUnit', 'Unit', "ISNULL(l.SaleUnit, 'pack')"],
        ['quantity', 'Quantity', 'ISNULL(l.UnitQty, l.Quantity)', 'qty'],
        ['rate', 'Rate', 'l.Rate', 'money'],
        ['lineDisc', 'Item Disc %', 'l.DiscPercent', 'percent'],
        ['amount', 'Amount', 'l.Amount', 'money'],
      ],
    },
  },
  stockAdjustment: {
    label: 'Stock Adjustment',
    from: 'StockAdjustment h',
    where: 'h.IsActive = 1',
    date: 'h.AdjDate',
    order: 'h.AdjDate, h.AdjustmentId',
    filters: ['createdBy'],
    columns: [
      ['adjNo', 'Adjustment No', docNoSql('ADJ', 'h.AdjustmentId')],
      ['adjDate', 'Date', 'h.AdjDate', 'date'],
      ['remarks', 'Remarks', 'h.Remarks'],
      ['inTotal', 'In Total', 'h.InTotal', 'money'],
      ['outTotal', 'Out Total', 'h.OutTotal', 'money'],
      ['createdBy', 'Created By', 'h.CreatedBy'],
    ],
    lines: {
      join: 'JOIN StockAdjustmentItem l ON l.AdjustmentId = h.AdjustmentId JOIN PharmacyItem i ON i.ItemId = l.ItemId',
      order: 'l.LineId',
      columns: [
        ['itemCode', 'Item Code', ITEM_CODE],
        ['itemName', 'Item Name', 'i.Name'],
        ['batch', 'Batch', 'l.BatchNo'],
        ['curStock', 'Stock Then', 'l.CurStock', 'qty'],
        ['inQty', 'In Qty', 'l.InQty', 'qty'],
        ['inPrice', 'In Price', 'l.InPrice', 'money'],
        ['outQty', 'Out Qty', 'l.OutQty', 'qty'],
        ['outPrice', 'Out Price', 'l.OutPrice', 'money'],
        ['mrp', 'MRP', 'l.MRP', 'money'],
      ],
    },
  },
  vendorPayment: {
    label: 'Vendor Payment',
    from: 'VendorPayment h JOIN Vendor v ON v.VendorId = h.VendorId',
    where: 'h.IsActive = 1',
    date: 'h.PayDate',
    order: 'h.PayDate, h.PaymentId',
    filters: ['vendor', 'payMode', 'createdBy'],
    columns: [
      ['paymentNo', 'Payment No', docNoSql('VP', 'h.PaymentId')],
      ['payDate', 'Pay Date', 'h.PayDate', 'date'],
      ['vendor', 'Vendor', 'v.VendorName'],
      ['stockInNo', 'Against Stock In', docOrNull('SI', 'h.StockInId')],
      ['amount', 'Amount', 'h.Amount', 'money'],
      ['payMode', 'Pay Mode', 'h.PayMode'],
      ['referenceNo', 'Reference No', 'h.ReferenceNo'],
      ['notes', 'Notes', 'h.Notes'],
      ['createdBy', 'Created By', 'h.CreatedBy'],
    ],
  },
};

// filter: the column is a pick-list value (a dropdown on its own screen), so
// the report can be narrowed to some of its values.
const asColumn = (s, line) => ([key, label, , type = 'text']) => ({ key, label, type, line, filter: Boolean(s.filters?.includes(key)) });

// The screens and their columns, header columns first, for the pickers.
router.get('/screens', (req, res) => {
  res.json(Object.entries(SCREENS).map(([key, s]) => ({
    key,
    label: s.label,
    hasDate: Boolean(s.date),
    columns: [...s.columns.map(asColumn(s, false)), ...(s.lines?.columns || []).map(asColumn(s, true))],
  })));
});

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

// A screen's column by key: { col, line } or null.
function findColumn(s, key) {
  const l = s.lines?.columns.find((c) => c[0] === key);
  if (l) return { col: l, line: true };
  const h = s.columns.find((c) => c[0] === key);
  return h ? { col: h, line: false } : null;
}

// ?screen, ?column: the values a filter column has, for its dropdown — its
// fixed options (fixedValues) if it has them, else the values saved. A blank
// value comes back as '' (the screen shows it as "(Blank)").
router.get('/values', async (req, res) => {
  const s = SCREENS[req.query.screen];
  const found = s && findColumn(s, String(req.query.column || ''));
  if (!found || !s.filters?.includes(found.col[0])) return res.status(400).json({ error: 'Not a filter column' });
  if (s.fixedValues?.[found.col[0]]) return res.json(s.fixedValues[found.col[0]]);
  try {
    const pool = await getPool();
    const r = await pool.request().input('itemId', sql.Int, null).query(`
      SELECT DISTINCT TOP 1000 ISNULL(CAST(${found.col[2]} AS NVARCHAR(300)), '') AS v
      FROM ${s.from} ${found.line ? s.lines.join : ''}
      WHERE ${s.where}
      ORDER BY v`);
    res.json(r.recordset.map((x) => x.v));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ?screen, ?columns = comma-separated keys (in the order to show), ?from / ?to
// as YYYY-MM-DD (either may be blank), ?filters = JSON { columnKey: [values] }
// for filter columns ('' matches a blank). Returns { grain: 'document' | 'line', rows }.
router.get('/', async (req, res) => {
  const s = SCREENS[req.query.screen];
  if (!s) return res.status(400).json({ error: 'Pick a screen' });
  const wanted = String(req.query.columns || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!wanted.length) return res.status(400).json({ error: 'Pick at least one column' });

  const picked = [];
  let byLine = false;
  for (const k of wanted) {
    const found = findColumn(s, k);
    if (!found) return res.status(400).json({ error: `Unknown column "${k}"` });
    if (!picked.includes(found.col)) picked.push(found.col);
    byLine ||= found.line;
  }

  let filters = {};
  try {
    filters = req.query.filters ? JSON.parse(req.query.filters) : {};
  } catch {
    return res.status(400).json({ error: 'Bad filters' });
  }
  const where = [s.where];
  const params = []; // filter values, as @f0, @f1...
  for (const [key, values] of Object.entries(filters || {})) {
    if (!Array.isArray(values) || !values.length) continue;
    const found = findColumn(s, key);
    if (!found || !s.filters?.includes(key)) return res.status(400).json({ error: `Can't filter on "${key}"` });
    if (values.length > 1000) return res.status(400).json({ error: 'Too many filter values' });
    // A filter on an item-line column needs the lines, even if none is shown.
    byLine ||= found.line;
    const expr = `ISNULL(CAST(${found.col[2]} AS NVARCHAR(300)), '')`;
    const names = values.map((v) => {
      params.push(String(v));
      return `@f${params.length - 1}`;
    });
    where.push(`${expr} IN (${names.join(', ')})`);
  }

  const { from, to } = req.query;
  if (s.date && isDate(from)) where.push(`${s.date} >= @from`);
  if (s.date && isDate(to)) where.push(`${s.date} <= @to`);
  const query = `
    SELECT ${picked.map((c) => `${c[2]} AS [${c[0]}]`).join(', ')}
    FROM ${s.from} ${byLine ? s.lines.join : ''}
    WHERE ${where.join(' AND ')}
    ORDER BY ${s.order}${byLine ? `, ${s.lines.order}` : ''}`;
  try {
    const request = (await getPool()).request();
    params.forEach((v, i) => request.input(`f${i}`, sql.NVarChar(300), v));
    const r = await request
      .input('itemId', sql.Int, null) // CURRENT_STOCK for every item
      .input('from', sql.Date, isDate(from) ? from : null)
      .input('to', sql.Date, isDate(to) ? to : null)
      .query(query);
    res.json({ grain: byLine ? 'line' : 'document', rows: r.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
