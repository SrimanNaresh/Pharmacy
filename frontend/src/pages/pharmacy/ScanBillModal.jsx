import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, FileUp, ScanLine, Plus, Trash2, RotateCcw, RotateCw,
  ChevronLeft, ChevronRight, Crop, ArrowLeft, Sparkles, ZoomIn, ZoomOut, Hand, SquareDashedMousePointer, X,
  GripVertical, Eraser, Check,
} from 'lucide-react';
import { Modal } from '../../components/ui.jsx';
import { itemMasterApi } from '../../api/client.js';
import { emptyForm } from './ItemForm.jsx';
import { BILL_FIELDS, buildIndex, compact, extractBillHeader, extractBillRows, extractBillTable, extractItems, matchName } from '../../utils/billScan.js';
import { gridKeys } from '../../components/grid/gridKeys.js';

// Item Master > Scan Bill: add a supplier bill's new items to Item Master.
//  1. Upload a photo / PDF of the bill (or take a photo on a phone).
//  2. The bill is shown, turned upright; drag a box around the Item
//     Description column (or the item table) and only that part is read (OCR,
//     in the browser). Item Master saves only the item names.
//     For a Purchase Order (forOrder) the box covers the item table, header
//     row included, and the bill's columns fill the item's fields:
//       Item Description -> Item Name, HSNCODE -> HSN, Rack -> Rack,
//       MFR -> Manufacturer, Batch -> Category, Pack -> Pack, MRP -> MRP
//     (Qty isn't read: stock comes from Stock In.) A box around just the
//     Item Description column, with no header, reads the names only.
//  3. The items found are listed in tabs:
//     - New items: will be added (Add button at the end of the list)
//     - Similar: close to an existing item and matched to it — pick
//       "Add as a new item" in its dropdown if it's really a different item
//     - Already exists: the same name is in Item Master — skipped
// Each tab is a grid like the Purchase Order item grid. A Manufacturer or
// Category that isn't on its pick-list yet is added to it on save.
//
// forOrder (Purchase Order > Scan Bill): after reading, a Match columns step
// shows the bill's table as read (its own headings and values) above the
// order's header row. Drag a bill heading onto an order heading (or tap one,
// then the other) to say which bill column fills it; headings that clearly
// match are filled in already. The last button adds the new items to Item
// Master and then puts every bill item on the order — new ones, matched ones
// and existing ones — with the bill's MRP, P.Rate, Free, Disc %, Qty and GST %,
// through onLines([{ itemId, qty, mrp, pRate, free, disc, gst }]).

let nextId = 1;
const blankFields = { generic: '', unit: '', hsnCode: '', rack: '', manufacturer: '', category: '', pack: '', mrp: '', pRate: '', free: '', disc: '', qty: '', gst: '' };
// Order fields typed as numbers, and the ones the matched / existing tabs can change.
const NUMERIC = new Set(['mrp', 'pRate', 'free', 'disc', 'qty', 'gst']);
const newRow = (fields) => ({ id: nextId++, ...blankFields, ...fields, include: true, choice: null, result: null });
// The grid's bill columns after Item Name: [field, heading, width class, max length]
const COLS = [
  ['hsnCode', 'HSN', 'w-[11%]', 30],
  ['rack', 'Rack', 'w-[8%]', 50],
  ['generic', 'Generic', 'w-[11%]', 200],
  ['manufacturer', 'Manufacturer', 'w-[13%]', 200],
  ['category', 'Category (Batch)', 'w-[12%]', 100],
  ['pack', 'Pack', 'w-[8%]', 50],
  ['unit', 'Unit', 'w-[6%]', 50],
  ['mrp', 'MRP', 'w-[9%]', null],
];
const BILL_HEADING = {
  name: 'Item Description', hsnCode: 'HSNCODE', rack: 'Rack', manufacturer: 'MFR', category: 'Batch', pack: 'Pack', mrp: 'MRP', qty: 'qty',
};
const ORDER_COLS = [
  ['disc', 'Disc%', 'w-[5%]', null],
  ['pRate', 'P.Rate', 'w-[7%]', null],
  ['qty', 'Qty', 'w-[6%]', null],
  ['free', 'Free', 'w-[5%]', null],
  ['gst', 'GST%', 'w-[5%]', null],
];

// Match columns: every column of the Purchase Order's item grid, in its order
// on screen (plus Rack, kept on the item), as a tile: [key, heading, width px].
//  - Generic, Manufacturer, HSN, Category, Pack, Unit, Rack are saved on new
//    items in Item Master.
//  - Amount (Qty x rate after discount) or Old Price (the rate after
//    discount) give the P.Rate when the bill has no rate column; GST Amt or
//    Total give the GST % when it has none. The order works these out again
//    from its own figures.
const TARGETS = [
  ['name', 'Item Name', 200], ['generic', 'Generic', 110], ['manufacturer', 'Manufacturer', 120], ['hsnCode', 'HSN', 85],
  ['category', 'Category', 100], ['pack', 'Pack', 70], ['unit', 'Unit', 60],
  ['mrp', 'MRP', 75], ['oldPrice', 'Old Price', 75], ['disc', 'Disc%', 60], ['pRate', 'P.Rate', 75],
  ['qty', 'Qty', 60], ['free', 'Free', 60], ['amount', 'Amount', 80],
  ['gst', 'GST%', 60], ['cgst', 'CGST%', 65], ['sgst', 'SGST%', 65], ['gstAmt', 'GST Amt', 75],
  ['total', 'Total', 80], ['rack', 'Rack', 65],
];
// Stock In > Scan Bill (Scan Stock Bill): every column of the Stock In table,
// in its order on screen, as a tile. Rows are matched by Item Name; then
//  - Batch No, Mf.Date, Exp.Date, R.Order, R.Free and S.Disc % fill the row;
//  - Received (split into R.Order + R.Free) or Amount (/ the order's rate)
//    give R.Order when the bill has no such column; Sel.Amount or Unit Price
//    give S.Disc % (of the MRP);
//  - the order's own figures (Pack, Unit, MRP, P.Rate, Disc %, GST, Ordered,
//    Free) help pick the right row when names are alike.
const STOCK_TARGETS = [
  ['name', 'Item Name', 200], ['pack', 'Pack', 70], ['unit', 'Unit', 60], ['mrp', 'MRP', 75],
  ['pRate', 'P.Rate', 75], ['disc', 'Disc%', 60], ['amount', 'Amount', 80],
  ['gst', 'GST%', 60], ['cgst', 'CGST%', 65], ['sgst', 'SGST%', 65], ['gstAmt', 'GST Amt', 75], ['total', 'Total', 80],
  ['ordered', 'Ordered', 65], ['freeOrdered', 'Free', 60], ['received', 'Received', 70],
  ['qty', 'R.Order', 65], ['free', 'R.Free', 60], ['category', 'Batch No', 100],
  ['mfg', 'Mf.Date', 70], ['exp', 'Exp.Date', 70], ['sDisc', 'S.Disc%', 65], ['sel', 'Sel.Amount', 80], ['unitPrice', 'Unit Price', 75],
];
const STOCK_NUMERIC = new Set(['ordered', 'freeOrdered', 'received', 'sDisc', 'sel', 'unitPrice']);
// Stock In > Three in One (IPS): the columns of all three screens, grouped
// Item Master · Purchase / Order · Stock In, as on the IPS table.
const IPS_TARGETS = [
  ['name', 'Item Name', 200], ['generic', 'Generic', 110], ['manufacturer', 'Manufacturer', 120], ['hsnCode', 'HSN', 85],
  ['category', 'Category', 100], ['pack', 'Pack', 70], ['unit', 'Unit', 60], ['rack', 'Rack', 65],
  ['mrp', 'MRP', 75], ['oldPrice', 'Old Price', 75], ['disc', 'Disc%', 60], ['pRate', 'P.Rate', 75],
  ['qty', 'Qty', 60], ['free', 'Free', 60], ['amount', 'Amount', 80],
  ['gst', 'GST%', 60], ['cgst', 'CGST%', 65], ['sgst', 'SGST%', 65], ['gstAmt', 'GST Amt', 75], ['total', 'Total', 80],
  ['batch', 'Batch No', 100], ['mfg', 'Mf.Date', 70], ['exp', 'Exp.Date', 70], ['sDisc', 'S.Disc%', 65], ['sel', 'Sel.Amount', 80],
];
// Bill figures used only to work out P.Rate / GST % (not kept on the row).
const DERIVE_ONLY = ['oldPrice', 'amount', 'gstAmt', 'total', 'cgst', 'sgst'];
const headKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
// A bill heading the reader didn't name, by its words: "Rate" -> P.Rate, "GST %" -> GST%...
const BY_LABEL = [
  ['cgst', (k) => k.startsWith('cgst') && !/amt|amount|value/.test(k)],
  ['sgst', (k) => k.startsWith('sgst') && !/amt|amount|value/.test(k)],
  ['gst', (k) => /^(gst|igst|tax)/.test(k) && !/amt|amount|value|able/.test(k)],
  ['free', (k) => k.startsWith('free') || k === 'fr'],
  ['disc', (k) => /^(disc|dis|discount|cd|sch)/.test(k) && !/amt|amount/.test(k)],
  ['oldPrice', (k) => /^(netrate|nrate|netprice|effrate)$/.test(k)],
  ['pRate', (k) => /^(rate|prate|ptr|pts|purrate|purchaserate|price)$/.test(k)],
  ['gstAmt', (k) => /^(gst|igst|tax)(amt|amount|value)$/.test(k)],
  ['amount', (k) => /^(amt|amount|value|taxable|taxablevalue|taxableamt|grossamt|grossamount)$/.test(k)],
  ['total', (k) => /^(total|netamt|netamount|nettotal|totalamt|totalamount)$/.test(k)],
  ['unit', (k) => /^(unit|uom|type)$/.test(k)],
  ['generic', (k) => /^(generic|genericname|composition|content)$/.test(k)],
  ['received', (k) => /^(received|recd|rec|recqty|receivedqty)$/.test(k)],
  ['ordered', (k) => /^(ordered|ordqty|orderqty|ord)$/.test(k)],
  ['sDisc', (k) => /^(sdisc|salesdisc|saledisc|sellingdisc)$/.test(k)],
  ['sel', (k) => /^(selamount|sellingprice|saleprice|salerate|sp|srate)$/.test(k)],
  ['unitPrice', (k) => /^(unitprice|unitrate|perunit)$/.test(k)],
  // Exp, Expiry, Exp.Date, Exp Dt, Expiry Dt, Expy, ED... / Mfg Dt, Mfd, Mf.Date, MD...
  ['exp', (k) => /^(exp|expy|expiry|expire|expires|expd|ed)(date|dt|on|mmyy|month)?$/.test(k) || k === 'expirydt'],
  ['mfg', (k) => /^(mfg|mfd|mf|md|mfgd|manufacturing|manufactured|manuf)(date|dt|on|mmyy|month)$/.test(k) || /^(mfd|md)$/.test(k)],
];
// The tiles placed already: a column the reader named, or whose heading says
// what it is — only tiles of this screen (targets).
function autoMap(heads, targets = TARGETS) {
  const keys = new Set(targets.map(([k]) => k));
  const map = {};
  heads.forEach((h, i) => {
    const key = keys.has(h.field) ? h.field : BY_LABEL.find(([k, test]) => keys.has(k) && test(headKey(h.label)))?.[0];
    if (key && map[key] == null) map[key] = i;
  });
  return map;
}
// autoMap, plus the date columns by what they hold when their heading didn't
// say: a column of months ("05/27", "MAY-27", "12/2027") is Exp.Date — of two
// such columns, the first is Mf.Date and the second Exp.Date.
function autoMapTable(table, targets = TARGETS) {
  const map = autoMap(table.heads, targets);
  const keys = new Set(targets.map(([k]) => k));
  if (!keys.has('exp') || map.exp != null) return map;
  const taken = new Set(Object.values(map));
  const dated = table.heads.map((_, i) => i).filter((i) => {
    if (taken.has(i)) return false;
    const cells = table.rows.map((r) => String(r[i] || '').trim()).filter(Boolean);
    const months = cells.filter((t) => monthIn(t) && /[/\-.]|[A-Z]{3}/i.test(t) && !/\d{5,}/.test(t));
    return cells.length >= 2 && months.length >= cells.length * 0.6;
  });
  if (dated.length >= 2 && keys.has('mfg') && map.mfg == null) { map.mfg = dated[0]; map.exp = dated[1]; } else if (dated.length) map.exp = dated[dated.length - 1];
  return map;
}

// A bill's month as 'YYYY-MM', or ''. Read: "2/28", "12/27", "03-2028",
// "12/2027", "0527" / "052027" (no separator), "MAY-27", "May 2027", "MAY27",
// and a full date "31/05/2027" (its month and year). OCR's O for 0 is put right.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function monthIn(text) {
  const t = String(text || '').toUpperCase().replace(/(?<=\d)O|O(?=\d)/g, '0').trim();
  const out = (mm, yy) => {
    const mo = Number(mm);
    if (!(mo >= 1 && mo <= 12)) return '';
    const y = String(yy).length === 2 ? `20${yy}` : String(yy);
    return /^20\d{2}$/.test(y) ? `${y}-${String(mo).padStart(2, '0')}` : '';
  };
  let m = /(?:^|\D)\d{1,2}\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(t); // 31/05/2027
  if (m) return out(m[1], m[2]);
  m = /([A-Z]{3})[A-Z]*\.?\s*[-/.,']?\s*(\d{4}|\d{2})(?!\d)/.exec(t); // MAY-27, May 2027
  if (m && MONTHS.includes(m[1])) return out(MONTHS.indexOf(m[1]) + 1, m[2]);
  m = /(?:^|\D)(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/.exec(t); // 05/27, 5-2027
  if (m) return out(m[1], m[2]);
  m = /^(\d{2})(\d{4}|\d{2})$/.exec(t.replace(/\s/g, '')); // 0527, 052027
  return m ? out(m[1], m[2]) : '';
}
// A bill cell as the value for an order column.
const numIn = (t, last = false) => {
  const s = String(t || '').replace(/(?<=\d)[oO]|[oO](?=\d)/g, '0').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2').replace(/,/g, '');
  const all = s.match(/\d+(\.\d+)?/g);
  return all ? String(Number(all[last ? all.length - 1 : 0])) : '';
};
function valueFor(key, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (key === 'exp' || key === 'mfg') return monthIn(t);
  if (key === 'mrp') return numIn(t, true);
  if (NUMERIC.has(key) || DERIVE_ONLY.includes(key) || STOCK_NUMERIC.has(key)) return numIn(t);
  if (key === 'hsnCode') return t.replace(/[oO]/g, '0').replace(/\D/g, '').slice(0, 30);
  if (key === 'category' || key === 'batch') return t.replace(/ /g, '').toUpperCase().slice(0, key === 'batch' ? 50 : 100);
  const max = { name: 200, manufacturer: 200, generic: 200, pack: 50, rack: 50, unit: 50 }[key] || 100;
  return t.toUpperCase().slice(0, max);
}
// The bill's Disc as a percentage. Bills print it either as a % ("35.00"
// with MRP 185.00 and rate 120.25) or as a rupee amount; the line's MRP,
// P.Rate and Qty tell which:
//  - MRP less Disc % gives the rate          -> it's a %, kept
//  - MRP less Disc gives the rate            -> an amount per unit, as a % of MRP
//  - MRP × Qty less Disc gives rate × Qty    -> an amount for the line, as a % of it
// Without a rate to check against, up to 100 is taken as a %, and more than
// that as an amount (per unit if below the MRP, else for the line). A value
// that still isn't 0–100 % is left blank (skipped), not saved wrong.
function discPercent(text, o) {
  const t = String(text || '');
  const num = numIn(t);
  if (num === '') return '';
  const v = Number(num);
  const mrp = Number(o.mrp) || 0;
  const rate = Number(o.pRate) || 0;
  const qty = Number(o.qty) || 0;
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.01);
  const pct = (x) => (x >= 0 && x <= 100 ? String(Math.round(x * 100) / 100) : '');
  if (/%/.test(t)) return pct(v);
  if (mrp > 0 && rate > 0) {
    if (near(mrp * (1 - v / 100), rate)) return pct(v);
    if (near(mrp - v, rate)) return pct((v / mrp) * 100);
    if (qty > 0 && near(mrp * qty - v, rate * qty)) return pct((v / (mrp * qty)) * 100);
  }
  if (v <= 100) return pct(v);
  if (!mrp) return '';
  if (v < mrp) return pct((v / mrp) * 100);
  return qty > 0 ? pct((v / (mrp * qty)) * 100) : '';
}

// One bill line through the column matches -> the fields of a scanned row.
function fieldsOf(cells, map, targets = TARGETS) {
  const o = {};
  for (const [key] of targets) if (map[key] != null) o[key] = valueFor(key, cells[map[key]]);
  if (o.disc != null) o.disc = discPercent(cells[map.disc], o);
  const r2 = (n) => String(Math.round(n * 100) / 100);
  const n = (k) => Number(o[k]) || 0;
  // On the order P.Rate = MRP less Disc % (the order puts that right when the
  // line goes on it). No P.Rate on the bill: the rate is the Amount / Qty, or
  // the Old Price (net rate) column.
  if (!(n('pRate') > 0)) {
    const net = n('amount') > 0 && n('qty') > 0 ? n('amount') / n('qty') : n('oldPrice');
    if (net > 0) o.pRate = r2(net);
  }
  // No GST % on the bill: from CGST + SGST, else GST Amt or Total against the
  // Amount (or Qty x the net rate when there's no Amount column).
  if (!o.gst) {
    const amt = n('amount') || n('qty') * n('oldPrice');
    if (o.cgst || o.sgst) o.gst = r2(n('cgst') + n('sgst'));
    else if (amt > 0 && n('gstAmt') > 0) o.gst = r2((n('gstAmt') / amt) * 100);
    else if (amt > 0 && n('total') > amt) o.gst = r2(((n('total') - amt) / amt) * 100);
    if (o.gst && !(Number(o.gst) <= 100)) o.gst = '';
  }
  for (const k of DERIVE_ONLY) delete o[k];
  return o;
}
// What makes two lines the same: Item Name + HSN + Batch (Category). A bill can
// carry one item in two batches — those are two lines, not a repeat.
const hsnOf = (s) => String(s || '').replace(/\D/g, '');
const batchOf = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const lineKey = (r) => `${compact(r.name)}|${hsnOf(r.hsnCode)}|${batchOf(r.category)}`;
// An Item Master item with the same name is the same item unless its HSN or
// Batch differs from the line's (a blank one on either side doesn't count).
const sameAs = (it, r) => {
  const differs = (a, b) => a !== '' && b !== '' && a !== b;
  return !differs(hsnOf(it.HSNCode), hsnOf(r.hsnCode)) && !differs(batchOf(it.Category), batchOf(r.category));
};
const NEW = 'new';
const code = (it) => it.ItemCode || `ITM${String(it.ItemId).padStart(6, '0')}`;
const MIN_BOX = 0.02; // a selection smaller than this (share of the page) is a slip, not a box

// forStock (Stock In > Scan Bill): Upload, Select table and Match columns as
// for an order, with Stock In's columns; then the bill's lines go back
// through onStockLines([{ name, hsnCode, category (batch), mfg, exp, qty, free }])
// and Stock In fills its rows — no items are added.
// forIps (Stock In > Three in One): the same, with the columns of Item
// Master, Purchase / Order and Stock In; the lines (order maths applied, as
// for an order) go back through onIpsLines and fill the IPS table.
export default function ScanBillModal({ open, onClose, onAdded, forOrder = false, onLines, forStock = false, onStockLines, forIps = false, onIpsLines }) {
  // Item Master's scan reads names only; a Purchase Order's (and Stock In's) also reads the bill's columns.
  const cols = forOrder ? [...COLS, ...ORDER_COLS] : [];
  const tableMode = forOrder || forStock || forIps;
  const targets = forIps ? IPS_TARGETS : forStock ? STOCK_TARGETS : TARGETS;
  const [items, setItems] = useState([]);
  // Matching needs the item list: until it's loaded nothing can be read or
  // added, or every line would look new.
  const [itemsReady, setItemsReady] = useState(false);
  const [step, setStep] = useState('pick'); // pick | select | map (orders) | review
  // Match columns (orders): the bill's table as read, and which bill column
  // fills each order column { targetKey: head index }.
  const [table, setTable] = useState(null);
  const [colMap, setColMap] = useState({});
  const [fileName, setFileName] = useState('');
  const [pages, setPages] = useState([]); // page pictures (canvases), turned upright
  const [pageNo, setPageNo] = useState(0);
  const [box, setBox] = useState(null); // selected area { x, y, w, h } as shares of the page
  const [zoom, setZoom] = useState(1); // preview size: 1 = fit, 2, 3
  const [moving, setMoving] = useState(false); // zoomed in: drag pans the bill instead of drawing a box
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('new');
  const [rawText, setRawText] = useState('');
  const [busy, setBusy] = useState(null); // { stage, percent } while working
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState('');
  // For an order: the supplier and bill date read from the top of page 1
  // ({ vendorName, address, mobile, gstNo, email, billDate }), or null.
  const [supplier, setSupplier] = useState(null);
  const photoRef = useRef(null);
  const fileRef = useRef(null);
  const ocrRef = useRef(null); // Tesseract reader, made on first use

  const loadItems = useCallback(() => itemMasterApi.list().then((list) => { setItems(list); setItemsReady(true); }), []);

  const reset = () => {
    setStep('pick'); setFileName(''); setPages([]); setPageNo(0); setBox(null); setZoom(1); setMoving(false); setRows([]); setTab('new');
    setRawText(''); setError(''); setSummary(''); setBusy(null); setSupplier(null); setTable(null); setColMap({});
  };

  useEffect(() => {
    if (!open) return undefined;
    reset();
    setItemsReady(false);
    loadItems().catch(() => setError("Couldn't load the item list, so bill lines can't be checked against it — close this and try again"));
    // Get the text reader ready while the user picks the bill (the first time
    // it downloads its language data), so the upload doesn't wait for it.
    startOcr();
    return () => {
      // Free the OCR reader when the popup closes.
      const ocr = ocrRef.current;
      ocrRef.current = null;
      ocr?.then((o) => o.done()).catch(() => {});
    };
  }, [open, loadItems]);

  // The reader is started when the popup opens; getOcr waits for it (or starts
  // it again if that failed, e.g. no network then).
  const startOcr = () => {
    if (!ocrRef.current) {
      const p = import('../../utils/billOcr.js').then((m) => m.createOcr());
      ocrRef.current = p;
      p.then(() => { readyRef.current = p; }, () => { if (ocrRef.current === p) ocrRef.current = null; });
    }
    return ocrRef.current;
  };
  const readyRef = useRef(null); // the reader's promise once it has resolved
  const getOcr = async () => {
    const p = startOcr();
    if (readyRef.current !== p) setBusy({ stage: 'Getting the text reader ready (the first time can take a moment)', percent: null });
    return p;
  };

  const index = useMemo(() => buildIndex(items), [items]);

  // Each row with its match, what happens to it and which tab it's on.
  const view = useMemo(() => {
    const seen = new Map();
    return rows.map((r, i) => {
      const key = compact(r.name) ? lineKey(r) : '';
      let m = matchName(r.name, index);
      if (m.exact) {
        // Same name in Item Master: it's that item only if HSN and Batch agree too;
        // otherwise the same-name items are offered (default: add as a new item).
        const twins = index.filter((e) => e.comp === compact(r.name)).map((e) => e.item);
        const same = twins.find((it) => sameAs(it, r));
        m = same ? { ...m, exact: same } : { exact: null, similar: twins.map((item) => ({ item, chars: 1, rank: 1, twin: true })), likely: null };
      } else if (m.likely && !sameAs(m.likely, r)) {
        // A name that's only alike is picked for the line by default only when
        // its HSN and Batch agree too — else it's offered, and a new item is the default.
        m = { ...m, likely: null };
      }
      let status;
      if (r.result?.added) status = 'added';
      else if (!key) status = 'empty';
      else if (seen.has(key)) status = 'dup';
      else if (m.exact) status = 'exists';
      else if (m.similar.length) status = 'similar';
      else status = 'new';
      if (key && !seen.has(key)) seen.set(key, i + 1);
      const choice = r.choice ?? (m.likely ? m.likely.ItemId : NEW);
      const asNew = status === 'new' || status === 'empty' || (status === 'similar' && choice === NEW);
      // Saved rows move to Already Exists (with their new code).
      const tabOf = status === 'added' ? 'exists' : asNew ? 'new' : status === 'similar' ? 'similar' : 'exists';
      const willAdd = r.include && asNew && status !== 'empty';
      return { ...r, m, status, choice, willAdd, tab: tabOf, dupOf: seen.get(key) };
    });
  }, [rows, index]);

  const counts = useMemo(() => {
    const c = { new: 0, similar: 0, exists: 0, add: 0, added: 0 };
    for (const v of view) {
      c[v.tab] += 1;
      if (v.willAdd) c.add += 1;
      if (v.status === 'added') c.added += 1;
    }
    return c;
  }, [view]);

  const update = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, result: patch.result ?? (r.result?.added ? r.result : null) } : r)));
  const remove = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addAfter = (id) => setRows((rs) => {
    const i = rs.findIndex((r) => r.id === id);
    return [...rs.slice(0, i + 1), newRow({ name: '' }), ...rs.slice(i + 1)];
  });

  // 1. A bill was chosen: show it, turned upright.
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    setFileName(file.name);
    try {
      setBusy({ stage: 'Opening the bill', percent: null });
      const { loadBillPages } = await import('../../utils/billOcr.js');
      const loaded = await loadBillPages(file);
      const ocr = await getOcr();
      setBusy({ stage: 'Turning the bill the right way up', percent: null });
      const { rotateCanvas } = await import('../../utils/billOcr.js');
      // A PDF's pages are usually all turned the same way: try page 1's angle first.
      const upright = [];
      let deg = null;
      for (const p of loaded) {
        deg = await ocr.uprightAngle(p, deg);
        upright.push(rotateCanvas(p, deg));
      }
      setPages(upright);
      setStep('select');
    } catch (err) {
      setError(err.message || "Couldn't open this bill");
      setStep('pick');
    } finally {
      setBusy(null);
    }
  };

  const rotate = async (deg) => {
    const { rotateCanvas } = await import('../../utils/billOcr.js');
    setPages((ps) => ps.map((p, i) => (i === pageNo ? rotateCanvas(p, deg) : p)));
    setBox(null);
  };

  // 2. Read the selected column (or the whole page) and add what's found to the list.
  const read = async (whole) => {
    setError(''); setSummary('');
    try {
      const ocr = await getOcr();
      setBusy({ stage: whole ? 'Reading the whole page' : 'Reading the selected area', percent: 0 });
      const { text, layout } = await ocr.read(pages[pageNo], whole ? null : box, (percent) => setBusy((b) => (b ? { ...b, percent } : b)));
      // For an order, once per bill: the supplier's name, address and the
      // bill date, from the top of the first page (above the item table).
      if ((forOrder || forIps) && !supplier) {
        setBusy({ stage: 'Reading the supplier and bill date', percent: 0 });
        try {
          const top = await ocr.read(pages[0], { x: 0, y: 0, w: 1, h: 0.4 }, (percent) => setBusy((b) => (b ? { ...b, percent } : b)));
          setSupplier(extractBillHeader(top.layout));
        } catch {
          setSupplier({ vendorName: '', address: '', mobile: '', gstNo: '', email: '', billDate: '' });
        }
      }
      setRawText((t) => (t ? `${t}\n\n` : '') + text.trim());
      // An order: show the table as read, to match its columns to the order's.
      const billTable = tableMode ? extractBillTable(layout) : null;
      if (billTable?.rows.length) {
        setTable(billTable);
        setColMap(autoMapTable(billTable, targets));
        setStep('map');
        return;
      }
      // With the header row in the area every column is read; without it,
      // just the item names.
      const table = extractBillRows(layout);
      const found = table?.rows.length ? table.rows : extractItems(text, layout, { column: !whole }).map((f) => ({ name: f.name, pack: f.pack }));
      if (!found.length) {
        setError(whole
          ? 'No item lines were found on this page. Drag a box around the item table, header row included.'
          : 'No items were read from the selected part. Make the box cover the item table from its header row (Rack, MFR, Item Description...) to the last item.');
        return;
      }
      const have = new Set(rows.map(lineKey));
      const added = found.filter((f) => !have.has(lineKey({ ...blankFields, ...f }))).map((f) => newRow(f));
      setRows((rs) => [...rs, ...added]);
      setTab('new');
      setStep('review');
      const missing = table?.rows.length ? BILL_FIELDS.filter((f) => !table.fields.includes(f)).map((f) => BILL_HEADING[f]) : null;
      const what = !forOrder ? '' : !missing
        ? 'Only item names were read (no header row in the area) — include the header row to read HSN, Rack, MFR, Batch, Pack, MRP and qty too.'
        : missing.length ? `Columns not found on the bill: ${missing.join(', ')} — fill them in below if needed.` : '';
      if (rows.length) setSummary(`${added.length} more line${added.length === 1 ? '' : 's'} read from the bill. ${what}`.trim());
      else if (what) setSummary(what);
    } catch (err) {
      setError(err.message || "Couldn't read this bill");
    } finally {
      setBusy(null);
    }
  };

  // 2b. (Orders) The columns are matched: the bill's lines go to the list.
  // Every line on screen goes to the list, except repeats of Item Name + HSN +
  // Batch (and lines with no item name).
  const applyColumns = () => {
    // Stock In: the bill's lines (with an item name) go back to fill its rows.
    // Three in One: every line with an item name, with the order's maths
    // (Disc % read as a %, P.Rate / GST % from Amount, Total... when missing).
    if (forIps) {
      const blank = Object.fromEntries(IPS_TARGETS.map(([k]) => [k, '']));
      onIpsLines?.(table.rows.map((cells) => ({ ...blank, ...fieldsOf(cells, colMap, IPS_TARGETS) })).filter((f) => compact(f.name)), { supplier });
      return;
    }
    // Each placed column's value as read (no order maths: Stock In uses them).
    if (forStock) {
      const blank = Object.fromEntries(STOCK_TARGETS.map(([k]) => [k, '']));
      const lines = table.rows.map((cells) => {
        const o = { ...blank };
        for (const [key] of STOCK_TARGETS) if (colMap[key] != null) o[key] = valueFor(key, cells[colMap[key]]);
        return o;
      }).filter((f) => compact(f.name));
      onStockLines?.(lines);
      return;
    }
    const have = new Set(rows.map(lineKey));
    const added = [];
    let repeats = 0;
    for (const cells of table.rows) {
      const f = { ...blankFields, ...fieldsOf(cells, colMap) };
      if (!compact(f.name)) continue;
      const k = lineKey(f);
      if (have.has(k)) { repeats += 1; continue; }
      have.add(k);
      added.push(newRow(f));
    }
    setRows((rs) => [...rs, ...added]);
    setTab('new');
    setStep('review');
    setError('');
    const what = rows.length ? `${added.length} more line${added.length === 1 ? '' : 's'} read from the bill.` : '';
    const skipped = repeats ? `${repeats} repeated line${repeats === 1 ? '' : 's'} (same Item Name, HSN and Batch) left out.` : '';
    setSummary([what, skipped].filter(Boolean).join(' '));
  };

  // 3. Save the new items.
  const addItems = async () => {
    const todo = view.filter((v) => v.willAdd);
    for (const v of todo) {
      const label = `"${v.name.slice(0, 30)}${v.name.length > 30 ? '...' : ''}"`;
      if (v.name.trim().length > 200) return setError(`${label}: Item Name must be at most 200 characters`);
      for (const [f, head, , max] of cols) {
        if (max && String(v[f]).trim().length > max) return setError(`${label}: ${head} must be at most ${max} characters`);
      }
      if (String(v.mrp).trim() !== '' && !(Number(v.mrp) >= 0)) return setError(`${label}: MRP must be a number, 0 or more`);
    }
    // For an order: every bill line that goes on it (the new ones once added).
    const forLines = forOrder ? view.filter((v) => v.include && v.status !== 'dup' && v.status !== 'empty') : [];
    for (const v of forLines) {
      const label = `"${v.name.slice(0, 30)}"`;
      const set = (f) => String(v[f]).trim() !== '';
      if (set('qty') && !(Number(v.qty) > 0)) return setError(`${label}: Qty must be more than 0`);
      if (set('pRate') && !(Number(v.pRate) >= 0)) return setError(`${label}: P.Rate must be a number, 0 or more`);
      if (set('free') && !(Number(v.free) >= 0)) return setError(`${label}: Free must be a number, 0 or more`);
      if (set('disc') && !(Number(v.disc) >= 0 && Number(v.disc) <= 100)) return setError(`${label}: Disc % must be 0–100`);
      if (set('gst') && !(Number(v.gst) >= 0 && Number(v.gst) <= 100)) return setError(`${label}: GST % must be 0–100`);
    }
    setSaving(true); setError(''); setSummary('');
    // Manufacturer and Category must be on their pick-lists: add the bill's
    // new ones (a value already there is just looked up).
    const listed = { manufacturer: new Map(), category: new Map(), generic: new Map(), unit: new Map() };
    const listError = {};
    for (const f of forOrder ? Object.keys(listed) : []) {
      const names = [...new Set(todo.map((v) => v[f].trim().toUpperCase()).filter(Boolean))];
      for (const n of names) {
        // A second try for a slip of the network.
        for (let tries = 0; tries < 2 && !listed[f].has(n); tries += 1) {
          try {
            listed[f].set(n, (await itemMasterApi.addListValue(f, n)).name);
            delete listError[`${f}:${n}`];
          } catch (err) {
            const why = err.response?.data?.error || err.message;
            listError[`${f}:${n}`] = `Couldn't add "${n}" to the ${{ category: 'Category (Batch)', manufacturer: 'Manufacturer', generic: 'Generic Name', unit: 'Type / Unit' }[f]} list${why ? `: ${why}` : ''}`;
          }
        }
      }
    }
    let ok = 0;
    let failed = 0;
    let firstError = '';
    const createdId = new Map(); // row id -> new ItemId
    for (const v of todo) {
      // The Batch is part of what makes the line its own item, so without it
      // the item isn't saved; a Manufacturer that couldn't be listed is just
      // left off the item (it can be set in Item Master later).
      const bad = listError[`category:${v.category.trim().toUpperCase()}`];
      if (bad) {
        update(v.id, { result: { error: bad } });
        firstError ||= bad;
        failed += 1;
        continue;
      }
      try {
        // Item Master's scan saves the name only; fill the rest from the Item List.
        const r = await itemMasterApi.create(!forOrder ? { ...emptyForm, name: v.name.trim() } : {
          ...emptyForm,
          name: v.name.trim(),
          hsnCode: v.hsnCode.trim(),
          rack: v.rack.trim(),
          pack: v.pack.trim(),
          mrp: String(v.mrp).trim(),
          manufacturer: listed.manufacturer.get(v.manufacturer.trim().toUpperCase()) || '',
          generic: listed.generic.get(v.generic.trim().toUpperCase()) || '',
          unit: listed.unit.get(v.unit.trim().toUpperCase()) || '',
          category: listed.category.get(v.category.trim().toUpperCase()) || '',
        });
        update(v.id, { result: { added: true, code: r.ItemCode, itemId: r.ItemId } });
        createdId.set(v.id, r.ItemId);
        ok += 1;
      } catch (err) {
        const why = err.response?.data?.error || (err.message ? `Save failed: ${err.message}` : 'Save failed');
        update(v.id, { result: { error: why } });
        firstError ||= why;
        failed += 1;
      }
    }
    // Manufacturer, Generic or Unit values that couldn't be listed (items saved without them).
    const noMfr = Object.keys(listError).filter((k) => !k.startsWith('category:'));
    await loadItems().catch(() => {});
    setSaving(false);
    if (ok) onAdded?.(ok);
    if (forOrder) {
      if (failed) {
        setTab('new');
        setSummary(`${ok} new item${ok === 1 ? '' : 's'} added to Item Master · ${failed} failed (${firstError}) — fix the red rows (or delete them) and press the button again`);
        return;
      }
      if (noMfr.length) setError(`${listError[noMfr[0]]} — those items were saved without it; set it in Item Master if needed.`);
      const byId = new Map(items.map((it) => [it.ItemId, it]));
      const lines = [];
      let inactive = 0;
      for (const v of forLines) {
        let itemId = createdId.get(v.id) ?? v.result?.itemId ?? null;
        if (!itemId && v.status === 'exists') itemId = v.m.exact.ItemId;
        if (!itemId && v.status === 'similar' && v.choice !== NEW) itemId = v.choice;
        if (!itemId) continue;
        if (byId.get(itemId)?.Status === 'Inactive') { inactive += 1; continue; }
        const s = (f) => String(v[f]).trim();
        lines.push({ itemId, qty: s('qty'), mrp: s('mrp'), pRate: s('pRate'), free: s('free'), disc: s('disc'), gst: s('gst') });
      }
      onLines?.(lines, { added: ok, inactive, supplier });
      return;
    }
    setSummary(`${ok} item${ok === 1 ? '' : 's'} added to Item Master${failed ? ` · ${failed} failed — see the red rows` : ''}`);
    if (!failed) setTab('exists');
  };

  // Bill lines that go on the order: all but repeats and empty rows.
  const orderCount = forOrder ? view.filter((v) => v.include && v.status !== 'dup' && v.status !== 'empty').length : 0;
  const working = Boolean(busy) || saving;
  const page = pages[pageNo];
  const tabRows = view.filter((v) => v.tab === tab);

  return (
    <Modal open={open} onClose={working ? () => {} : onClose} size="xl" title={forIps ? 'Scan Bill · Three in One' : forStock ? 'Scan Stock Bill' : 'Scan Purchase Bill'}>
      <div className="space-y-3">
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={onFile} />

        <Steps step={step} forOrder={tableMode} last={forIps ? 'Fill the table' : forStock ? 'Fill Stock In' : undefined} />

        {/* Step 1: pick the bill */}
        {step === 'pick' && !busy && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-4 py-8 text-center">
            <ScanLine size={28} className="text-brand-500" />
            <div className="text-sm text-ink-600">
              <p className="font-semibold text-ink-800">Upload the supplier&apos;s bill</p>
              <p className="text-xs">A photo (JPG / PNG) or a PDF. Next you&apos;ll mark {tableMode ? 'the item table on it, header row included' : 'the Item Description column on it'}.</p>
            </div>
            <div className="flex w-full max-w-sm gap-2">
              <button type="button" className="btn-secondary min-w-0 flex-1 whitespace-nowrap px-2 sm:hidden" disabled={!itemsReady} onClick={() => photoRef.current?.click()}>
                <Camera size={16} /> Take Photo
              </button>
              <button type="button" className="btn-primary min-w-0 flex-1 whitespace-nowrap px-2" disabled={!itemsReady} onClick={() => fileRef.current?.click()}>
                <FileUp size={16} /> {itemsReady ? 'Upload Photo / PDF' : 'Loading items...'}
              </button>
            </div>
          </div>
        )}

        {busy && <Progress busy={busy} />}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
        {summary && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{summary}</p>}

        {/* Step 2: preview, select the Item Description column */}
        {step === 'select' && page && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-600">
                {tableMode
                  ? <><b className="text-ink-800">Drag a box around the item table, header row included</b> — from the column headings (Rack, MFR, Item Description, HSNCODE, Batch, Pack, MRP, qty) to the last item. Only that part is read.</>
                  : <><b className="text-ink-800">Drag a box around the Item Description column</b> — from the first item name to the last (or the whole item table, header row included). Only that part is read.</>}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {pages.length > 1 && (
                  <>
                    <button type="button" className="btn-ghost px-1.5 py-1" disabled={working || pageNo === 0} title="Previous page" onClick={() => { setPageNo((n) => n - 1); setBox(null); }}><ChevronLeft size={16} /></button>
                    <span className="text-xs tabular-nums text-ink-500">Page {pageNo + 1} / {pages.length}</span>
                    <button type="button" className="btn-ghost px-1.5 py-1" disabled={working || pageNo === pages.length - 1} title="Next page" onClick={() => { setPageNo((n) => n + 1); setBox(null); }}><ChevronRight size={16} /></button>
                    <span className="mx-1 h-4 w-px bg-ink-200" />
                  </>
                )}
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={working} title="Turn left" onClick={() => rotate(270)}><RotateCcw size={16} /></button>
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={working} title="Turn right" onClick={() => rotate(90)}><RotateCw size={16} /></button>
                <span className="mx-1 h-4 w-px bg-ink-200" />
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={zoom === 1} title="Zoom out" onClick={() => { const z = zoom - 1; setZoom(z); if (z === 1) setMoving(false); }}><ZoomOut size={16} /></button>
                <span className="w-7 text-center text-xs tabular-nums text-ink-500">{zoom}×</span>
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={zoom === 3} title="Zoom in" onClick={() => setZoom((z) => z + 1)}><ZoomIn size={16} /></button>
                {zoom > 1 && (
                  <div className="ml-1 flex overflow-hidden rounded-lg border border-ink-200 text-xs font-semibold">
                    <button type="button" className={`flex items-center gap-1 px-2 py-1 ${moving ? 'bg-brand-600 text-white' : 'text-ink-500'}`} title="Drag to move around the bill" onClick={() => setMoving(true)}><Hand size={14} /> Move</button>
                    <button type="button" className={`flex items-center gap-1 px-2 py-1 ${!moving ? 'bg-brand-600 text-white' : 'text-ink-500'}`} title="Drag to mark the item table" onClick={() => setMoving(false)}><SquareDashedMousePointer size={14} /> Select</button>
                  </div>
                )}
              </div>
            </div>

            <BoxSelect page={page} box={box} onBox={setBox} disabled={working} zoom={zoom} moving={moving} forOrder={tableMode} />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" disabled={working} onClick={() => fileRef.current?.click()}>
                  <FileUp size={16} /> Another Bill
                </button>
                {rows.length > 0 && (
                  <button type="button" className="btn-secondary" disabled={working} onClick={() => setStep('review')}>
                    <ArrowLeft size={16} /> Back to List
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {box && (
                  <button type="button" className="btn-secondary" disabled={working} onClick={() => setBox(null)} title="Clear the selected area">
                    <X size={16} /> Cancel Selection
                  </button>
                )}
                <button type="button" className="btn-secondary" disabled={working} onClick={() => read(true)} title="Read the whole page and pick out the item lines">
                  <Sparkles size={16} /> Read Whole Page
                </button>
                <button type="button" className="btn-primary" disabled={working || !box} onClick={() => read(false)}>
                  <Crop size={16} /> {box ? 'Read Selected Area' : tableMode ? 'Select the item table first' : 'Select the column first'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2b (orders): match the bill's columns to the order's */}
        {step === 'map' && table && (
          <ColumnMatch
            table={table}
            map={colMap}
            setMap={setColMap}
            onRemoveCol={(i) => {
              // Drop the bill's column i; tiles on the columns after it move along with them.
              setTable((t) => ({ heads: t.heads.filter((_, c) => c !== i), rows: t.rows.map((r) => r.filter((_, c) => c !== i)) }));
              setColMap((m) => Object.fromEntries(Object.entries(m).filter(([, c]) => c !== i).map(([k, c]) => [k, c > i ? c - 1 : c])));
            }}
            disabled={working}
            onBack={() => setStep('select')}
            onDone={applyColumns}
            hasRows={rows.length > 0}
            targets={targets}
            forStock={forStock}
            forIps={forIps}
          />
        )}

        {/* Step 3: the items, in tabs */}
        {step === 'review' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-xs text-ink-500">
                <p className="truncate">From <b className="text-ink-700">{fileName}</b> · {rows.length} line{rows.length === 1 ? '' : 's'} read</p>
                {forOrder && supplier && (
                  <p className="truncate">
                    Supplier: <b className="text-ink-700">{supplier.vendorName || 'not read'}</b>
                    {supplier.billDate && <> · Bill date: <b className="text-ink-700">{supplier.billDate.split('-').reverse().join('-')}</b></>}
                    <span className="text-ink-400"> — filled in on the order</span>
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary px-3 text-xs" disabled={working || !pages.length} onClick={() => { setBox(null); setSummary(''); setError(''); setStep('select'); }}>
                  <Crop size={14} /> Read More From Bill
                </button>
                <button type="button" className="btn-secondary px-3 text-xs" disabled={working} onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} /> Another Bill
                </button>
              </div>
            </div>

            <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink-100 no-scrollbar">
              {[
                ['new', 'New Items', counts.new, 'text-brand-700'],
                ['similar', 'Similar · Matched', counts.similar, 'text-amber-700'],
                ['exists', 'Already Exists', counts.exists, 'text-ink-500'],
              ].map(([key, label, n, tone]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === key ? `border-brand-600 ${tone}` : 'border-transparent text-ink-400 hover:text-ink-600'}`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 text-[11px] ${tab === key ? 'bg-brand-50' : 'bg-ink-100'}`}>{n}</span>
                </button>
              ))}
            </div>

            <p className="text-[11px] text-ink-500">
              {tab === 'new' && (forOrder
                ? 'These will be added to Item Master with the HSN, Rack, Manufacturer, Category (the bill\'s Batch), Pack and MRP read from the bill. Check them (OCR can misread digits) and delete any row you don\'t want.'
                : 'These will be added to Item Master. Check the names (OCR can misread digits) and delete any row you don\'t want.')}
              {tab === 'similar' && (forOrder
                ? 'Each of these looks like an item you already have, so it goes on the order as that item. If one is really a different item, pick "Not the same — add as a new item" in its Matched to list — it moves to New Items.'
                : 'Each of these looks like an item you already have, so it is skipped. If one is really a different item, pick "Not the same — add as a new item" in its Matched to list — it moves to New Items.')}
              {tab === 'exists' && (forOrder ? 'Already in Item Master — these go on the order as they are (inactive items are left out).' : 'Already in Item Master — skipped.')}
            </p>

            <ItemGrid tab={tab} rows={tabRows} disabled={working} update={update} remove={remove} addAfter={addAfter} cols={cols} forOrder={forOrder} />

            {forOrder ? (
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <p className="text-[11px] text-ink-500">
                  {counts.add ? `${counts.add} new item${counts.add === 1 ? '' : 's'} will be added to Item Master first.` : 'No new items to add to Item Master.'}
                </p>
                <button type="button" className="btn-primary" disabled={working || !itemsReady || orderCount === 0} onClick={addItems}>
                  <Plus size={16} /> {saving ? 'Adding...' : `Add ${orderCount} Item${orderCount === 1 ? '' : 's'} to Order`}
                </button>
              </div>
            ) : tab === 'new' && (
              <div className="flex justify-end pt-1">
                <button type="button" className="btn-primary" disabled={working || !itemsReady || counts.add === 0} onClick={addItems}>
                  <Plus size={16} /> {saving ? 'Adding...' : `Add ${counts.add} New Item${counts.add === 1 ? '' : 's'}`}
                </button>
              </div>
            )}

            {rawText && (
              <details className="rounded-lg border border-ink-100 px-3 py-2 text-xs text-ink-500">
                <summary className="cursor-pointer font-medium">Text read from the bill</summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-600">{rawText}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Steps({ step, forOrder, last = 'Review & add' }) {
  const all = [['pick', 'Upload'], ['select', 'Select table'], ...(forOrder ? [['map', 'Match columns']] : []), ['review', last]];
  const at = all.findIndex(([k]) => k === step);
  return (
    <ol className="flex items-center gap-2 text-[11px] font-semibold">
      {all.map(([k, label], i) => (
        <li key={k} className={`flex items-center gap-1.5 ${i <= at ? 'text-brand-700' : 'text-ink-400'}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i < at ? 'bg-brand-600 text-white' : i === at ? 'border-2 border-brand-600' : 'border border-ink-300'}`}>{i + 1}</span>
          <span className={i === at ? '' : 'max-sm:hidden'}>{label}</span>
          {i < all.length - 1 && <span className="mx-1 h-px w-5 bg-ink-200" />}
        </li>
      ))}
    </ol>
  );
}

function Progress({ busy }) {
  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink-600">
        <ScanLine size={14} className="animate-pulse text-brand-600" /> {busy.stage}
        {busy.percent != null && <span className="ml-auto tabular-nums">{busy.percent}%</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={`h-full rounded-full bg-brand-500 transition-all ${busy.percent == null ? 'w-1/3 animate-pulse' : ''}`}
          style={busy.percent != null ? { width: `${busy.percent}%` } : undefined}
        />
      </div>
    </div>
  );
}

// The bill picture; drag on it (mouse or finger) to mark the area to read.
// box / onBox use shares of the picture (0..1), so they don't depend on its
// size on screen. zoom > 1 shows it larger in a scrolling box; while `moving`,
// a drag scrolls the bill (a finger pans) instead of drawing.
function BoxSelect({ page, box, onBox, disabled, zoom = 1, moving = false, forOrder = false }) {
  const url = useMemo(() => page.toDataURL('image/jpeg', 0.85), [page]);
  const wrap = useRef(null);
  const start = useRef(null);
  const [draft, setDraft] = useState(null);

  const at = (e) => {
    const r = wrap.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  const down = (e) => {
    if (disabled || moving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = at(e);
    setDraft({ ...start.current, w: 0, h: 0 });
  };
  const move = (e) => { if (start.current) setDraft(rectOf(start.current, at(e))); };
  const up = (e) => {
    if (!start.current) return;
    const r = rectOf(start.current, at(e));
    start.current = null;
    setDraft(null);
    if (r.w >= MIN_BOX && r.h >= MIN_BOX) onBox(r);
  };

  const shown = draft || box;
  const zoomed = zoom > 1;
  return (
    <div className={`max-h-[62vh] overflow-auto rounded-xl border border-ink-100 bg-ink-50 p-2 ${zoomed ? '' : 'flex justify-center'}`}>
      <div
        ref={wrap}
        className={`relative select-none overflow-hidden ${zoomed ? 'block' : 'inline-block'} ${disabled ? 'cursor-wait' : moving ? 'cursor-grab' : 'cursor-crosshair'}`}
        style={{ touchAction: moving ? 'pan-x pan-y' : 'none', width: zoomed ? `${zoom * 100}%` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { start.current = null; setDraft(null); }}
      >
        <img src={url} alt="The bill" draggable={false} className={zoomed ? 'block w-full' : 'block max-h-[calc(62vh-1rem)] max-w-full'} />
        {shown && (
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-brand-500"
            style={{
              left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%`,
              boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
            }}
          />
        )}
        {!shown && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="rounded-full bg-ink-900/75 px-3 py-1 text-[11px] font-medium text-white">{forOrder ? 'Drag over the item table, header row included' : 'Drag over the Item Description column'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Match columns (orders). Top: the bill's table as read, values only — each
// column's heading is a slot for the order column it fills. Below: the
// Purchase Order's headings as tiles. Drag a tile onto a column (or tap the
// tile, then the column — or the column, then the tile — for a phone). A
// column holds one tile and a tile sits on one column; dropping a tile that's
// already placed moves it. Tiles that clearly match are placed already.
function ColumnMatch({ table, map, setMap, onRemoveCol, disabled, onBack, onDone, hasRows, targets = TARGETS, forStock = false, forIps = false }) {
  // Tapped and waiting for its partner: { tile: key } or { col: index }.
  const [picked, setPicked] = useState(null);
  const [over, setOver] = useState(null); // column a tile is being dragged over
  const { heads, rows } = table;
  const tiles = targets;
  const label = Object.fromEntries(targets.map(([k, l]) => [k, l]));
  const tileOn = (i) => Object.keys(map).find((k) => map[k] === i);
  const place = (key, i) => {
    setMap((m) => {
      const n = {};
      for (const [k, c] of Object.entries(m)) if (k !== key && c !== i) n[k] = c;
      n[key] = i;
      return n;
    });
    setPicked(null);
  };
  const clear = (key) => setMap((m) => { const n = { ...m }; delete n[key]; return n; });
  const tapTile = (key) => {
    if (disabled) return;
    if (picked?.col != null) place(key, picked.col);
    else setPicked((p) => (p?.tile === key ? null : { tile: key }));
  };
  const tapCol = (i) => {
    if (disabled) return;
    if (picked?.tile) place(picked.tile, i);
    else setPicked((p) => (p?.col === i ? null : { col: i }));
  };
  const dropProps = (i) => (disabled ? {} : {
    onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(i); },
    onDragLeave: () => setOver((o) => (o === i ? null : o)),
    onDrop: (e) => {
      e.preventDefault();
      setOver(null);
      const key = e.dataTransfer.getData('text/plain');
      if (label[key]) place(key, i);
    },
  });
  const dragTile = (key) => (e) => { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; setPicked(null); };
  const matched = Object.keys(map).length;
  const names = map.name == null ? 0 : rows.filter((cells) => compact(cells[map.name])).length;
  const width = (i) => (i === map.name || heads[i].field === 'name' ? 200 : 100);

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-600">
        <b className="text-ink-800">Pick the right tile for each column read from the bill</b> — drag a tile onto the column, or tap the tile and then the column.
        Tiles that clearly match are placed already; check them. Columns left without a tile aren&apos;t used.
      </p>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          {forIps ? 'Item · Purchase · Stock columns' : forStock ? 'Stock In columns' : 'Order columns'} · {matched} placed
          {picked?.tile && <span className="ml-1 normal-case tracking-normal text-brand-700">— now tap the column for “{label[picked.tile]}”</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          {tiles.map(([key, name]) => {
            const placed = map[key] != null;
            const sel = picked?.tile === key;
            return (
              <button
                key={key}
                type="button"
                disabled={disabled}
                draggable={!disabled}
                onDragStart={dragTile(key)}
                onClick={() => tapTile(key)}
                title={placed ? 'Placed on a column — drag it to another to move it' : 'Drag onto a bill column, or tap it then the column'}
                className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${
                  sel ? 'border-brand-600 bg-brand-600 text-white'
                    : placed ? 'border-brand-200 bg-brand-50 text-brand-400'
                      : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50'}`}
              >
                <GripVertical size={12} className="opacity-50" />
                {name}
                {placed && <Check size={12} />}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-400">{forIps
          ? 'The lines fill the Three in One table: Item Master columns (new items are added on save), Purchase / Order columns (P.Rate = MRP less Disc %; Amount or Old Price give the rate, GST Amt or Total the GST %, when missing) and Stock In columns (Batch No, dates as MM/YY, S.Disc %, Sel.Amount). Category is used as the Batch No when there is no Batch No column.'
          : forStock
          ? 'Each bill line fills the Stock In row of the same item on the order: Batch No, Mf.Date, Exp.Date, R.Order, R.Free and S.Disc%. Received (split into R.Order + R.Free) or Amount give R.Order when there is no R.Order column; Sel.Amount or Unit Price give S.Disc% of the MRP. The order\'s own columns (Pack, Unit, MRP, P.Rate, Disc%, GST, Ordered, Free) help pick the row when names are alike. Dates like 2/28 or 12/2027 are read as MM/YY. Lines not on the order are listed, not added.'
          : <>Generic, Manufacturer, HSN, Category, Pack, Unit and Rack are saved on new items. Amount or Old Price give the P.Rate, and GST Amt or Total the GST %, when the bill has no such column; the order works out its own Amount, GST Amt and Total. A discount printed as an amount is turned into Disc % (of MRP); one that can&apos;t be worked out is left blank.</>}</p>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Read from the bill · {rows.length} line{rows.length === 1 ? '' : 's'}</p>
        <div className="max-h-[42vh] overflow-auto rounded-lg border border-ink-200">
          <table className="w-full table-fixed border-collapse text-left text-[12px]" style={{ minWidth: 40 + heads.reduce((s, _, i) => s + width(i), 0) }}>
            <thead className="sticky top-0 z-10">
              <tr className="bg-ink-50">
                <th className={`${hd} w-10 text-ink-400`}>#</th>
                {heads.map((_, i) => {
                  const key = tileOn(i);
                  const active = over === i || picked?.col === i;
                  return (
                    <th
                      key={i}
                      style={{ width: width(i) }}
                      className={`${hd} !p-1 ${disabled ? '' : 'cursor-pointer'} ${active ? '!bg-brand-100' : ''} ${picked?.tile && !key ? 'ring-1 ring-inset ring-brand-300' : ''}`}
                      title={key ? `Fills ${label[key]} on the ${forIps ? 'table' : forStock ? 'Stock In' : 'order'}` : 'Drop a tile here'}
                      onClick={() => tapCol(i)}
                      {...dropProps(i)}
                    >
                      {key ? (
                        <span
                          className="flex items-center justify-between gap-1 rounded-md bg-brand-600 px-1.5 py-1 text-[11px] font-bold text-white shadow-sm"
                          draggable={!disabled}
                          onDragStart={dragTile(key)}
                        >
                          <span className="truncate">{label[key]}</span>
                          <button type="button" className="shrink-0 rounded text-white/70 hover:text-white" title="Remove" disabled={disabled} onClick={(e) => { e.stopPropagation(); clear(key); }}><X size={12} /></button>
                        </span>
                      ) : (
                        <span className={`block rounded-md border border-dashed px-1.5 py-1 text-[11px] font-medium ${active ? 'border-brand-400 text-brand-600' : 'border-ink-300 text-ink-400'}`}>
                          {picked?.col === i ? 'Now tap a tile' : 'Drop a tile'}
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
              {/* Remove a column read from the bill that isn't wanted (or was read wrong). */}
              <tr className="bg-ink-50">
                <th className={`${hd} !py-0.5`} />
                {heads.map((_, i) => (
                  <th key={i} className={`${hd} !py-0.5`}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      title="Remove this column"
                      disabled={disabled || heads.length <= 1}
                      onClick={() => { setPicked(null); setOver(null); onRemoveCol(i); }}
                    >
                      <Trash2 size={11} /> Remove
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, r) => (
                <tr key={r}>
                  <td className={`${cell} text-center text-ink-400`}>{r + 1}</td>
                  {cells.map((t, i) => (
                    <td key={i} className={`${cell} px-1.5 ${tileOn(i) ? 'text-ink-800' : 'text-ink-400'} ${over === i ? 'bg-brand-50' : ''}`} {...dropProps(i)}>{t}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={disabled} onClick={onBack}><ArrowLeft size={16} /> Select Again</button>
          <button type="button" className="btn-secondary" disabled={disabled || !matched} onClick={() => { setMap({}); setPicked(null); }}><Eraser size={16} /> Clear All</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {map.name == null && <p className="text-[11px] font-medium text-amber-700">Place the Item Name tile on the item name column first.</p>}
          <button type="button" className="btn-primary" disabled={disabled || !names} onClick={onDone}>
            <Plus size={16} /> {forIps ? `Fill the Table with ${names} Line${names === 1 ? '' : 's'}` : forStock ? `Fill Stock In from ${names} Line${names === 1 ? '' : 's'}` : `Add ${names} Line${names === 1 ? '' : 's'} to the ${hasRows ? 'List' : 'Review'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// The tab's rows as a grid, styled like the Purchase Order item grid.
//  - New Items:        #  | Item Name | HSN | Rack | Manufacturer | Category (Batch) | Pack | MRP (all editable) | + / delete
//  - Similar · Matched: # | Name on Bill               | Matched to (dropdown, or "Add as a new item")
//  - Already Exists:   #  | Name on Bill               | Item in Item Master
// For an order, New Items has a Qty column too, and the other two tabs MRP and Qty.
const cell = 'border border-ink-200 px-1 py-0.5 break-words align-middle';
const hd = 'border border-ink-200 px-1.5 py-1.5 text-center align-middle text-[11px]';
const box = 'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] uppercase focus:border-brand-400 focus:bg-white focus:outline-none disabled:text-ink-500';

function ItemGrid({ tab, rows, disabled, update, remove, addAfter, cols: fields, forOrder }) {
  const second = tab === 'similar' ? 'Matched to' : tab === 'exists' ? 'Item in Item Master' : null;
  // For an order, matched and existing items go on it too: their Qty / MRP can be changed here.
  const extra = tab === 'new' ? fields : forOrder ? fields.filter(([f]) => NUMERIC.has(f)) : [];
  const cols = 2 + extra.length + (second ? 1 : 0) + (tab === 'new' ? 1 : 0);
  const rename = (v) => (e) => update(v.id, { name: e.target.value.toUpperCase(), choice: null });
  const setField = (v, f) => (e) => update(v.id, { [f]: NUMERIC.has(f) ? e.target.value : e.target.value.toUpperCase() });
  const at = tab === 'new' ? 1 : 2; // grid column (data-c) of the first extra cell
  const extraCells = (v, r) => extra.map(([f, head], c) => (
    <td key={f} className={cell}>
      <input
        className={`${box} ${NUMERIC.has(f) ? 'text-right' : ''}`}
        data-r={r}
        data-c={c + at}
        inputMode={NUMERIC.has(f) ? 'decimal' : undefined}
        value={v[f]}
        disabled={disabled || v.status === 'dup'}
        aria-label={head}
        onChange={setField(v, f)}
      />
    </td>
  ));

  return (
    <div className="overflow-x-auto">
      <table className={`w-full table-fixed border-collapse text-left text-[12px] ${tab === 'new' && extra.length ? 'min-w-[1100px]' : ''} ${tab !== 'new' && extra.length ? 'min-w-[760px]' : ''} ${tab === 'new' && !extra.length ? 'max-w-2xl' : ''}`} {...gridKeys}>
        <thead>
          <tr className="bg-brand-50 text-[11px] font-bold leading-tight text-brand-700">
            <th className={`${hd} w-10`}>#</th>
            <th className={`${hd} !text-left`}>{tab === 'new' ? 'Item Name' : 'Name on Bill'}</th>
            {tab === 'new' && extra.map(([f, head, width]) => <th key={f} className={`${hd} ${width}`}>{head}</th>)}
            {second && <th className={`${hd} ${extra.length ? 'w-[40%]' : 'w-[48%]'} !text-left`}>{second}</th>}
            {tab !== 'new' && extra.map(([f, head]) => <th key={f} className={`${hd} w-20`}>{head}</th>)}
            {tab === 'new' && <th className={`${hd} w-24`}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={cols} className={`${cell} py-6 text-center text-ink-400`}>Nothing here.</td></tr>
          )}
          {rows.map((v, r) => {
            const bad = v.result?.error;
            return (
              <tr key={v.id} className={bad ? 'bg-red-50' : v.status === 'added' ? 'bg-emerald-50/60' : ''} title={bad || ''}>
                <td className={`${cell} text-center text-ink-400`}>{r + 1}</td>

                {tab === 'new' && (
                  <>
                    <td className={cell}>
                      <input className={box} data-r={r} data-c={0} value={v.name} disabled={disabled} placeholder="Type the item name" onChange={rename(v)} />
                      {bad && <p className="px-1 text-[11px] text-red-600">{bad}</p>}
                    </td>
                    {extraCells(v, r)}
                    <td className={cell}>
                      <div className="flex justify-center gap-3">
                        <button type="button" data-r={r} data-c={extra.length + 1} className="rounded p-1 text-brand-600 hover:bg-brand-50" disabled={disabled} title="Add a row below" onClick={() => addAfter(v.id)}><Plus size={16} /></button>
                        <button type="button" data-r={r} data-c={extra.length + 2} className="rounded p-1 text-red-500 hover:bg-red-50" disabled={disabled} title="Delete row" onClick={() => remove(v.id)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </>
                )}

                {tab === 'similar' && (
                  <>
                    <td className={cell}>
                      <input className={box} data-r={r} data-c={0} value={v.name} disabled={disabled} onChange={rename(v)} />
                    </td>
                    <td className={cell}>
                      <select
                        className={`${box} normal-case`}
                        data-r={r}
                        data-c={1}
                        data-own-updown
                        value={v.choice}
                        disabled={disabled}
                        onChange={(e) => update(v.id, { choice: e.target.value === NEW ? NEW : Number(e.target.value) })}
                      >
                        {v.m.similar.map((s) => (
                          <option key={s.item.ItemId} value={s.item.ItemId}>
                            {s.item.Name} ({code(s.item)}) · {s.twin
                              ? `same name · HSN ${s.item.HSNCode || '—'} · Batch ${s.item.Category || '—'}`
                              : `${Math.round(s.chars * 100)}% alike`}
                          </option>
                        ))}
                        <option value={NEW}>➕ Not the same — add as a new item</option>
                      </select>
                    </td>
                    {extraCells(v, r)}
                  </>
                )}

                {tab === 'exists' && (
                  <>
                    <td className={`${cell} px-2 uppercase text-ink-700`}>{v.name}</td>
                    <td className={`${cell} px-2`}>
                      {v.status === 'added' && <span className="font-medium text-emerald-700">Added now · {v.result.code}</span>}
                      {v.status === 'exists' && <span className="text-ink-600">{v.m.exact.Name} <span className="text-ink-400">({code(v.m.exact)}){v.m.exact.Status === 'Inactive' ? ' · Inactive' : ''}</span></span>}
                      {v.status === 'dup' && <span className="text-ink-400">Repeated on the bill (same Item Name, HSN and Batch as line {v.dupOf})</span>}
                    </td>
                    {extraCells(v, r)}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
