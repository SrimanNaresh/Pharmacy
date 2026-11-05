// Item Master Excel template: download (with the current items, so they can be
// edited and uploaded back) and read an uploaded file into import rows.
// exceljs is loaded only when one of these runs, so it isn't in the main bundle.

// Same fields and order as the Item Master form. `list` columns get a drop-down
// of the saved values (new values are still allowed and are added on upload);
// `fixed` columns allow only the values shown.
export const TEMPLATE_COLUMNS = [
  { key: 'itemCode', header: 'Item Code', width: 13, note: 'Leave blank for a new item' },
  { key: 'name', header: 'Item Name *', width: 34 },
  { key: 'pack', header: 'Pack', width: 11 },
  { key: 'unit', header: 'Type / Unit', width: 12, list: 'unit', note: 'Pieces in one pack, e.g. 15' },
  { key: 'hsnCode', header: 'HSN Code', width: 11 },
  { key: 'mrp', header: 'MRP', width: 10, number: true },
  { key: 'cgstPercent', header: 'CGST %', width: 9, number: true },
  { key: 'sgstPercent', header: 'SGST %', width: 9, number: true },
  { key: 'rack', header: 'Rack', width: 9 },
  { key: 'boxNo', header: 'Box', width: 9 },
  { key: 'generic', header: 'Generic Name', width: 22, list: 'generic' },
  { key: 'manufacturer', header: 'Manufacturer', width: 22, list: 'manufacturer' },
  { key: 'category', header: 'Category', width: 16, list: 'category' },
  { key: 'potency', header: 'Potency', width: 10, list: 'potency' },
  { key: 'schedule', header: 'Schedule', width: 10, fixed: ['None', 'H', 'H1'] },
  { key: 'status', header: 'Status', width: 10, fixed: ['Active', 'Inactive'] },
];

const fromItem = (i) => ({
  itemCode: i.ItemCode, name: i.Name, pack: i.Pack, unit: i.UnitName, hsnCode: i.HSNCode,
  mrp: i.MRP == null ? null : Number(i.MRP), cgstPercent: i.CGSTPercent == null ? null : Number(i.CGSTPercent),
  sgstPercent: i.SGSTPercent == null ? null : Number(i.SGSTPercent), rack: i.Rack, boxNo: i.BoxNo,
  generic: i.GenericName, manufacturer: i.ManufacturerName, category: i.Category, potency: i.Potency,
  schedule: i.Schedule || 'None', status: i.Status || 'Active',
});

const colLetter = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

// Builds and downloads Item_Master_Template.xlsx. `items` are Item Master rows
// (empty for a blank template); `lists` is itemMasterApi.lists().
export async function downloadItemTemplate(items, lists) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Ayush Pharmacy';
  const ws = wb.addWorksheet('Items', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  ws.columns = TEMPLATE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell, i) => {
    const c = TEMPLATE_COLUMNS[i - 1];
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.key === 'name' ? 'FF1D4ED8' : 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E3A8A' } } };
    if (c.note) cell.note = c.note;
  });
  for (const i of items) ws.addRow(fromItem(i));

  // Drop-down sources on a hidden sheet.
  const ls = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const ranges = {};
  TEMPLATE_COLUMNS.filter((c) => c.list || c.fixed).forEach((c, i) => {
    const values = c.fixed || (lists?.[c.list] || []).map((v) => v.name);
    ls.getColumn(i + 1).values = [c.header, ...values];
    ranges[c.key] = values.length ? `Lists!$${colLetter(i + 1)}$2:$${colLetter(i + 1)}$${values.length + 1}` : null;
  });

  const lastRow = Math.max(items.length + 500, 1000);
  TEMPLATE_COLUMNS.forEach((c, i) => {
    const letter = colLetter(i + 1);
    for (let r = 2; r <= lastRow; r += 1) {
      const cell = ws.getCell(`${letter}${r}`);
      if (c.number) {
        cell.numFmt = '0.00';
        cell.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true, showErrorMessage: true, errorTitle: c.header, error: 'Enter a number (0 or more)' };
      } else if (ranges[c.key]) {
        cell.dataValidation = {
          type: 'list', allowBlank: true, formulae: [ranges[c.key]],
          showErrorMessage: !!c.fixed, errorStyle: 'stop', errorTitle: c.header, error: `Pick one of: ${(c.fixed || []).join(', ')}`,
        };
      }
    }
  });

  const help = wb.addWorksheet('How to use');
  help.getColumn(1).width = 110;
  [
    'Item Master upload template',
    '',
    '• One row per item. Item Name is required; every other column is optional.',
    '• Item Code: keep it to update that item. Leave it blank to add a new item (an item with the same Item Name is updated instead).',
    '• Type / Unit is the number of pieces in one pack (e.g. 15 for a strip of 15).',
    '• Type / Unit, Generic Name, Manufacturer, Category and Potency offer a drop-down of saved values; a new value typed here is added to the list on upload.',
    '• Schedule: None, H or H1. Status: Active or Inactive (blank = None / Active).',
    '• CGST % + SGST % can be at most 28.',
    '• Stock is not set here — enter opening stock on Stock In > Adjustment.',
    '• Upload on Item > Bulk Update. If any row has a problem nothing is saved and the rows to fix are listed.',
  ].forEach((t, i) => {
    const cell = help.getCell(`A${i + 1}`);
    cell.value = t;
    if (i === 0) cell.font = { bold: true, size: 14, color: { argb: 'FF1D4ED8' } };
    cell.alignment = { wrapText: true };
  });

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = items.length ? 'Item_Master_Items.xlsx' : 'Item_Master_Template.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const norm = (h) => String(h ?? '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// A cell's plain value (rich text, formulas and hyperlinks flattened).
function cellValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return cellValue(v.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return typeof v === 'string' ? v.trim() : v;
}

// Reads the first sheet of an uploaded .xlsx into { rows, missing }: rows are
// { row (Excel row number), ...TEMPLATE_COLUMNS keys }; empty rows are skipped.
// `missing` lists required headings the file doesn't have.
export async function readItemFile(file) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet('Items') || wb.worksheets[0];
  if (!ws) return { rows: [], missing: ['Item Name'] };

  const colOf = {};
  ws.getRow(1).eachCell((cell, n) => {
    const c = TEMPLATE_COLUMNS.find((t) => norm(t.header) === norm(cellValue(cell.value)));
    if (c) colOf[c.key] = n;
  });
  if (!colOf.name) return { rows: [], missing: ['Item Name'] };

  const rows = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const row = { row: n };
    let any = false;
    for (const c of TEMPLATE_COLUMNS) {
      const v = colOf[c.key] ? cellValue(r.getCell(colOf[c.key]).value) : '';
      row[c.key] = v === '' ? '' : String(v);
      if (row[c.key] !== '') any = true;
    }
    if (any) rows.push(row);
  });
  return { rows, missing: [] };
}
