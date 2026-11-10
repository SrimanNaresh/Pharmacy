import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PackagePlus, Save, X, List, ChevronRight, ChevronLeft, ChevronDown, Lock, ScanLine } from 'lucide-react';
import ScanBillModal from './ScanBillModal.jsx';
import { buildIndex, compact, matchName } from '../../utils/billScan.js';
import { CardHeader, Toast } from '../../components/ui.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { useToast } from '../../hooks/useToast.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { stockInApi, vendorApi } from '../../api/client.js';
import { usePhoneFit, PhoneFooter } from '../../components/PhoneLayout.jsx';
import { selAmount, purchaseLine, round2, unitsPerPack } from '../../utils/purchaseCalc.js';

const pad = (n) => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthOf = (iso) => (iso ? String(iso).slice(0, 7) : '');
const money = (n) => (Number(n) || 0).toFixed(2);
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');
const numStr = (v) => (v == null || v === '' ? '' : String(Number(v)));

// One table row per order line: the order's figures plus what's typed here.
const rowFromLine = (l, saved) => ({
  ...l, ticked: false,
  batchNo: saved?.BatchNo || '', mfg: monthOf(saved?.MfgDate), exp: monthOf(saved?.ExpDate),
  qty: saved ? numStr(saved.Quantity) : String(l.Due || 0),
  free: saved ? numStr(saved.FreeQty || 0) : String(l.FreeDue || 0),
  disc: saved ? numStr(saved.DiscPercent) : '',
  savedMfg: monthOf(saved?.MfgDate), savedExp: monthOf(saved?.ExpDate),
});

// A row's problem (the server checks the same), or null. Rows at 0 are skipped.
// A month typed as MM/YY. The row keeps it as 'YYYY-MM' (what the server
// takes), 'bad' while the text isn't a full, real month, or '' when empty.
const BAD_MONTH = 'bad';
const monthToText = (ym) => (ym && ym !== BAD_MONTH ? `${ym.slice(5, 7)}/${ym.slice(2, 4)}` : '');
function textToMonth(text) {
  if (!text) return '';
  const m = /^(\d{2})\/(\d{2})$/.exec(text);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return BAD_MONTH;
  return `20${m[2]}-${m[1]}`;
}

// The MM/YY box: digits only, the slash is put in after the month.
function MonthBox({ value, onChange, className, ...rest }) {
  const [text, setText] = useState(monthToText(value));
  // Follow changes made from outside (bulk fill, loading a Stock In).
  useEffect(() => {
    if (textToMonth(text) !== value && value !== BAD_MONTH) setText(monthToText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const change = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
    const next = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
    setText(next);
    onChange(textToMonth(next));
  };
  return <input inputMode="numeric" placeholder="MM/YY" maxLength={5} className={className} value={text} onChange={change} {...rest} />;
}

function rowProblem(r) {
  const qty = Number(r.qty || 0);
  const free = Number(r.free || 0);
  if (qty === 0 && free === 0) return null;
  if (!(qty >= 0)) return { qty: '0 or more' };
  if (!(free >= 0)) return { free: '0 or more' };
  if (qty > r.Due) return { qty: `Only ${r.Due} due` };
  if (free > r.FreeDue) return { free: `Only ${r.FreeDue} free due` };
  if (!r.batchNo.trim()) return { batchNo: 'Required' };
  const now = thisMonth();
  if (r.mfg === BAD_MONTH) return { mfg: 'Use MM/YY' };
  if (r.exp === BAD_MONTH) return { exp: 'Use MM/YY' };
  if (!r.exp) return { exp: 'Required' };
  if (r.exp < now && r.exp !== r.savedExp) return { exp: 'Past month' };
  if (r.mfg && r.mfg > now && r.mfg !== r.savedMfg) return { mfg: 'Future month' };
  if (r.mfg && r.exp <= r.mfg) return { exp: 'Must be after Mf.Date' };
  const d = Number(r.disc || 0);
  if (!(d >= 0 && d <= 100)) return { disc: '0–100' };
  return null;
}

const emptyFill = { batchNo: '', mfg: '', exp: '', disc: '' };

// Received is the total arriving now: R.Order (paid) + R.Free (free).
const receivedOf = (r) => (r.qty === '' && r.free === '' ? '' : String(Number(r.qty || 0) + Number(r.free || 0)));
// Typing a Received total fills R.Order first (up to what's due), then R.Free
// (up to the free still due); anything beyond both stays on R.Order, which then
// shows "Only N due".
function splitReceived(r, text) {
  if (text === '') return { qty: '', free: '' };
  const total = Math.max(0, Number(text) || 0);
  const paid = Math.min(total, r.Due);
  const free = Math.min(total - paid, r.FreeDue);
  return { qty: String(paid + (total - paid - free)), free: String(free) };
}

// Pharmacy > Stock In > Master: goods received against a purchase order.
// Saving adds the quantities to stock and sets each item's selling price to
// its Sel.Amount (MRP less Discount %).
export default function StockIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [orders, setOrders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [inDate, setInDate] = useState(today());
  const [rows, setRows] = useState([]);
  // Each arrow opens its own column: Amount › shows P.Rate + Disc% in its
  // place, GST Amt › shows GST% + CGST% + SGST%; the ‹ on the last of them closes it.
  const [showRate, setShowRate] = useState(false);
  const [showGst, setShowGst] = useState(false);
  const extraCols = (showRate ? 1 : 0) + (showGst ? 2 : 0);
  // Sel.Amount › adds a Unit Price column after it (Sel.Amount for one piece).
  const [showUnit, setShowUnit] = useState(false);
  // Column shares (%) for each arrow state — every set adds up to 100, so the
  // table fits; Item Name and the dates give up room as columns open.
  const W0 = {
    chk: 2.5, pack: 3.5, unit: 3.5, mrp: 4.5, amount: 6.5, gstAmt: 6.5, pRate: 4.5, discP: 5.5,
    gst: 4, cgst: 4.5, sgst: 6, total: 5, rec: 5, rOrder: 5, disc: 4.5,
    ...(!showRate && !showGst && { item: 15.25, ord: 4.5, free: 3.5, rFree: 4.5, batch: 6.5, month: 6, sel: 7.25 }),
    ...(showRate && !showGst && { item: 11.75, ord: 4.5, free: 3.5, rFree: 4.5, batch: 6.5, month: 6, sel: 7.25 }),
    ...(!showRate && showGst && { item: 8.5, ord: 4.5, free: 3.5, rFree: 4.5, batch: 5.25, month: 6, sel: 7.25 }),
    ...(showRate && showGst && { item: 7.5, ord: 4.5, free: 3.5, rFree: 4.5, batch: 4.5, month: 5.125, sel: 7.25 }),
  };
  // With Unit Price open every share is scaled down so the set still adds up to 100.
  const W = showUnit
    ? Object.fromEntries(Object.entries({ ...W0, unitPrice: 5.5 }).map(([k, v]) => [k, (v * 100) / 105.5]))
    : W0;
  const w = (key) => ({ width: `${W[key]}%` });
  const [fill, setFill] = useState(emptyFill);
  // Phones: rows whose details are opened with their arrow (by PoLineId).
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggleRow = (id) => setOpenRows((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOpen = rows.length > 0 && rows.every((r) => openRows.has(r.PoLineId));
  const toggleAll = () => setOpenRows(allOpen ? new Set() : new Set(rows.map((r) => r.PoLineId)));
  const [editing, setEditing] = useState(null); // { id, no, locked }
  const [saving, setSaving] = useState(false);

  useEffect(() => { vendorApi.list().then(setVendors).catch(() => show('Failed to load vendors', 'error')); }, [show]);
  const vendorOptions = useMemo(
    () => vendors.filter((v) => v.Status !== 'Inactive' || String(v.VendorId) === vendorId).map((v) => ({ value: String(v.VendorId), label: v.VendorName })),
    [vendors, vendorId],
  );

  // Only orders with something still to receive (plus the edited Stock In's own order).
  const loadOrders = async (vid, includeOrderId) => {
    setOrders([]);
    if (!vid) return;
    try { setOrders(await stockInApi.orders(vid, includeOrderId)); } catch { show('Failed to load orders', 'error'); }
  };
  const loadLines = async (oid, stockIn) => {
    setRows([]);
    if (!oid) return;
    try {
      const lines = await stockInApi.orderLines(oid, stockIn?.StockInId);
      const saved = new Map((stockIn?.lines || []).map((l) => [l.PoLineId, l]));
      setRows(lines.map((l) => rowFromLine(l, stockIn ? saved.get(l.PoLineId) || { Quantity: 0 } : null)));
    } catch { show('Failed to load the order lines', 'error'); }
  };

  const pickVendor = (vid) => { setVendorId(vid); setOrderId(''); setRows([]); loadOrders(vid); };
  const pickOrder = (oid) => { setOrderId(oid); loadLines(oid); };

  // A Stock In opened from the list (Admin only, as the server also checks).
  useEffect(() => {
    const id = location.state?.editStockInId;
    if (!id) return;
    navigate(location.pathname, { replace: true, state: null });
    if (!isAdmin) { show('Only an Admin can edit a Stock In', 'error'); return; }
    stockInApi.get(id).then(async (s) => {
      setEditing({ id: s.StockInId, no: s.StockInNo, locked: s.locked });
      setVendorId(String(s.VendorId));
      setInDate(String(s.InDate).slice(0, 10));
      await loadOrders(String(s.VendorId), s.PurchaseOrderId);
      setOrderId(String(s.PurchaseOrderId));
      await loadLines(s.PurchaseOrderId, s);
    }).catch(() => show('Failed to load the Stock In', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ticked = rows.filter((r) => r.ticked).length;
  const allTicked = rows.length > 0 && ticked === rows.length;
  const tickAll = () => setRows((rs) => rs.map((r) => ({ ...r, ticked: !allTicked })));
  // Only the boxes filled in the bar are applied.
  const applyFill = () => {
    if (fill.mfg === BAD_MONTH || fill.exp === BAD_MONTH) return show('Use MM/YY for the dates', 'error');
    const patch = Object.fromEntries(Object.entries(fill).filter(([, v]) => v !== ''));
    setRows((rs) => rs.map((r) => (r.ticked ? { ...r, ...patch } : r)));
    show(`Applied to ${ticked} row(s)`, 'success');
    setFill(emptyFill);
  };

  // Scan Stock Bill: each bill line fills the row of the same item on the
  // order — Batch No, Mf.Date, Exp.Date, R.Order, R.Free, S.Disc % (only what
  // the bill has). R.Order can also come from Received (split like typing it)
  // or Amount (/ the order's rate); S.Disc % from Sel.Amount or Unit Price.
  // Matched by Item Name: the same name, else a very alike one; when several
  // rows are alike, the one whose order figures (Pack, MRP, P.Rate, Batch...)
  // agree with the line. A row takes one bill line; lines not matched are listed.
  const [scanOpen, setScanOpen] = useState(false);
  const fillFromBill = (billLines) => {
    setScanOpen(false);
    const next = rows.map((r) => ({ ...r }));
    const used = new Set();
    const notOnOrder = [];
    let filled = 0;
    const digits = (s) => String(s || '').replace(/\D/g, '');
    const code = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const b of billLines) {
      const free = next.map((r, i) => ({ Name: r.ItemName, i, r })).filter((x) => !used.has(x.i));
      const m = matchName(b.name, buildIndex(free));
      const alike = m.exact ? free.filter((x) => compact(x.Name) === compact(b.name))
        : m.likely ? [m.likely] : m.similar.filter((s) => s.chars >= 0.7).map((s) => s.item);
      const same = (a, v) => a !== '' && a != null && v != null && Number(a) === Number(v);
      const agree = (x) => [
        digits(b.hsnCode) && digits(x.r.HSNCode) === digits(b.hsnCode),
        code(b.category) && code(x.r.Category) === code(b.category),
        code(b.pack) && code(x.r.Pack) === code(b.pack),
        same(b.mrp, x.r.MRP), same(b.pRate, x.r.PRate), same(b.disc, x.r.DiscPercent),
        same(b.ordered, x.r.Ordered), same(b.freeOrdered, x.r.FreeOrdered),
      ].filter(Boolean).length;
      const hit = [...alike].sort((x, y) => agree(y) - agree(x))[0];
      // Only an alike (not same) name with nothing else agreeing is too weak a match.
      if (!hit || (!m.exact && !m.likely && !agree(hit))) { notOnOrder.push(b.name); continue; }
      used.add(hit.i);
      const r = next[hit.i];
      if (b.category) r.batchNo = b.category;
      if (b.mfg) r.mfg = b.mfg;
      if (b.exp) r.exp = b.exp;
      const given = (v) => v !== '' && v != null && Number(v) >= 0;
      if (given(b.received) && b.qty === '' && b.free === '') Object.assign(r, splitReceived(r, b.received));
      if (given(b.qty)) r.qty = String(Number(b.qty));
      else if (given(b.amount) && Number(r.Rate) > 0 && b.received === '') {
        const q = Number(b.amount) / Number(r.Rate);
        if (Math.abs(q - Math.round(q)) < 0.02) r.qty = String(Math.round(q)); // only a whole number of packs
      }
      if (given(b.free)) r.free = String(Number(b.free));
      // S.Disc %: as printed, else from the selling price (per pack, or per piece x pieces in the pack).
      const sel = given(b.sel) ? Number(b.sel) : given(b.unitPrice) ? Number(b.unitPrice) * unitsPerPack(r.Pack, r.Unit) : null;
      if (given(b.sDisc) && Number(b.sDisc) <= 100) r.disc = String(Number(b.sDisc));
      else if (sel != null && Number(r.MRP) > 0 && sel <= Number(r.MRP)) r.disc = String(round2((1 - sel / Number(r.MRP)) * 100));
      filled += 1;
    }
    setRows(next);
    const left = notOnOrder.length ? ` · ${notOnOrder.length} not on this order: ${notOnOrder.slice(0, 3).join(', ')}${notOnOrder.length > 3 ? '...' : ''}` : '';
    show(`Filled ${filled} row${filled === 1 ? '' : 's'} from the bill${left} — check them before saving`, filled ? 'success' : 'error');
  };

  // Phones: fit the page to the screen so only the item cards scroll.
  const { pageRef, areaRef, footerRef, fit } = usePhoneFit([rows.length, ticked > 0, editing, orderId]);

  const problems = rows.map(rowProblem);
  const hasProblem = problems.some(Boolean);
  const receiving = rows.filter((r) => Number(r.qty || 0) > 0 || Number(r.free || 0) > 0);

  const reset = () => { setEditing(null); setVendorId(''); setOrders([]); setOrderId(''); setRows([]); setInDate(today()); setFill(emptyFill); };

  const save = async (e) => {
    e.preventDefault();
    if (!vendorId) return show('Vendor Name is required', 'error');
    if (!orderId) return show('Purchase No is required', 'error');
    if (!inDate) return show('Date is required', 'error');
    if (!receiving.length) return show('Enter a Received quantity on at least one line', 'error');
    if (hasProblem) return show('Fix the boxes marked in red first', 'error');
    setSaving(true);
    try {
      const body = {
        vendorId: Number(vendorId), purchaseOrderId: Number(orderId), inDate,
        lines: rows.map((r) => ({ poLineId: r.PoLineId, batchNo: r.batchNo, mfgMonth: r.mfg, expMonth: r.exp, quantity: r.qty, freeQty: r.free, discPercent: r.disc })),
      };
      if (editing) {
        await stockInApi.update(editing.id, body);
        navigate('/pharmacy/stock-in-list', { state: { flash: `${editing.no} updated` } });
      } else {
        const r = await stockInApi.create(body);
        show(`Saved ${r.StockInNo} — stock and selling prices updated`, 'success');
        reset();
      }
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const locked = editing?.locked;
  const cell = 'border border-ink-200 px-1 py-0.5 break-words';
  // Headings: one line, aligned like their column's values. Headings with an
  // arrow keep room on the left for it, so the label still lines up with the
  // numbers on the right.
  const hd = 'relative border border-ink-200 px-1 py-2 align-middle text-10 whitespace-nowrap xl:text-11';
  const hdArrow = 'relative border border-ink-200 py-2 pl-[20px] pr-1 align-middle text-10 whitespace-nowrap xl:text-11';
  // Each column's alignment, used by its heading and its cells alike: text to
  // the left, short codes and dates centred, numbers to the right.
  const AL = { item: 'text-left', batch: 'text-left', chk: 'text-center', pack: 'text-center', unit: 'text-center', month: 'text-center' };
  const al = (key) => AL[key] || 'text-right';
  const box = 'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-12 focus:border-brand-400 focus:bg-white focus:outline-none';
  const bad = 'border-red-400 bg-red-50 text-red-700';
  const ro = 'px-1 text-right text-ink-600';
  // The order line's figures for what's being received now: R.Order units at
  // the order's rate (free units aren't charged).
  const orderCalc = (r) => purchaseLine({ pRate: r.PRate, discPercent: r.DiscPercent, quantity: r.qty, cgstPercent: r.CGSTPercent, sgstPercent: r.SGSTPercent });
  const orderTotal = round2(rows.reduce((t, r) => t + orderCalc(r).total, 0));
  // Opened columns are tinted by group (sky = Amount's P.Rate / Disc%, amber =
  // GST Amt's GST% / CGST% / SGST%), and each arrow is a small pill in its
  // group's colour, so it's clear which arrow opens which columns.
  const GROUP = {
    rate: { head: 'bg-sky-100 text-sky-800 border-t-2 border-t-sky-400', cell: 'bg-sky-50/70 text-sky-900', pill: 'bg-sky-100 text-sky-700 ring-sky-300 hover:bg-sky-200' },
    sel: { head: 'bg-emerald-100 text-emerald-800 border-t-2 border-t-emerald-400', cell: 'bg-emerald-50/70 text-emerald-900', pill: 'bg-emerald-100 text-emerald-700 ring-emerald-300 hover:bg-emerald-200' },
    gst: { head: 'bg-amber-100 text-amber-800 border-t-2 border-t-amber-400', cell: 'bg-amber-50/70 text-amber-900', pill: 'bg-amber-100 text-amber-700 ring-amber-300 hover:bg-amber-200' },
  };
  const arrow = (group, open, onClick, title) => (
    <button type="button" className={`absolute left-0.5 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full ring-1 transition-colors ${GROUP[group].pill}`} title={title} onClick={onClick}>
      {open ? <ChevronLeft size={11} strokeWidth={2.5} /> : <ChevronRight size={11} strokeWidth={2.5} />}
    </button>
  );

  return (
    <div ref={pageRef} className={fit.page} style={fit.pageStyle}>
      <div className={`card max-md:!px-3 ${fit.card}`}>
        <form onSubmit={save} className={fit.form}>
          <CardHeader
            icon={PackagePlus}
            title={editing ? `Edit Stock In · ${editing.no}` : 'Stock In'}
            subtitle={<span className="hidden md:inline">Goods received against a purchase order — adds stock and sets the selling price</span>}
            actions={(
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  title={rows.length ? "Read the supplier's bill to fill Batch, dates and quantities" : 'Pick the vendor and order first'}
                  disabled={!!locked}
                  onClick={() => (rows.length ? setScanOpen(true) : show('Pick the vendor and the order first, then scan its bill', 'error'))}
                >
                  <ScanLine size={16} /> Scan Stock Bill
                </button>
                <button type="button" className="btn-secondary hidden md:inline-flex" onClick={() => navigate('/pharmacy/stock-in-list')}><List size={16} /> View List</button>
              </div>
            )}
          />

          {locked && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
              <Lock size={14} /> {locked}
            </div>
          )}

          <div className="grid grid-cols-[1fr_7rem] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <div className="min-w-0 sm:w-72">
              <label className="label">Vendor Name *</label>
              <SearchPick className="input" placeholder="Search vendor..." options={vendorOptions} value={vendorId} onChange={pickVendor} disabled={!!editing} />
            </div>
            <div className="col-span-2 row-start-2 min-w-0 sm:w-80">
              <label className="label">Purchase No *</label>
              <select className="input" value={orderId} disabled={!vendorId || !!editing} onChange={(e) => pickOrder(e.target.value)}>
                <option value="">{vendorId ? (orders.length ? 'Pick an order' : 'No orders left to receive for this vendor') : 'Pick a vendor first'}</option>
                {orders.map((o) => <option key={o.PurchaseOrderId} value={o.PurchaseOrderId}>{`${o.OrderNo} · ${dateLabel(o.OrderDate)} · ₹${money(o.TotalAmount)}`}</option>)}
              </select>
            </div>
            <div className="min-w-0 sm:w-auto">
              <label className="label">Date *</label>
              <input type="date" className="input max-md:!px-1.5" value={inDate} onChange={(e) => setInDate(e.target.value)} />
            </div>
          </div>

          {ticked > 0 && (
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-brand-100 bg-brand-50/50 p-2">
              <span className="self-center text-sm font-medium text-brand-700">Fill the ticked rows</span>
              <div className="w-28"><label className="label">Batch No</label><input className="input" value={fill.batchNo} onChange={(e) => setFill((f) => ({ ...f, batchNo: e.target.value }))} /></div>
              <div className="w-24"><label className="label">Mf.Date</label><MonthBox className={`input ${fill.mfg === BAD_MONTH ? 'border-red-400 bg-red-50' : ''}`} value={fill.mfg} onChange={(v) => setFill((f) => ({ ...f, mfg: v }))} /></div>
              <div className="w-24"><label className="label">Exp.Date</label><MonthBox className={`input ${fill.exp === BAD_MONTH ? 'border-red-400 bg-red-50' : ''}`} value={fill.exp} onChange={(v) => setFill((f) => ({ ...f, exp: v }))} /></div>
              <div className="w-20"><label className="label">Discount %</label><input type="number" min="0" max="100" step="0.01" className="input no-spin" value={fill.disc} onChange={(e) => setFill((f) => ({ ...f, disc: e.target.value }))} /></div>
              <button type="button" className="btn-primary py-1" onClick={applyFill}>Apply to {ticked} row(s)</button>
            </div>
          )}

          {/* Phones: one card per item — MRP · P.Rate · Order · Free · Batch, then
              Mf.Date · Exp.Date · S.Disc% · Sel.Amount; "More details" opens the rest. */}
          <div className={`mt-3 flex flex-col gap-2.5 md:hidden ${fit.section}`}>
            {rows.length === 0 && (
              <p className="rounded-xl border border-dashed border-ink-200 px-3 py-5 text-center text-12 text-ink-400">{orderId ? 'Loading the order…' : 'Pick a vendor and a purchase order to list its items.'}</p>
            )}
            {rows.length > 0 && (
              <div className="flex shrink-0 items-center justify-between px-0.5">
                <span className="text-12 font-semibold text-ink-600">{rows.length} item(s) · {receiving.length} receiving</span>
              </div>
            )}
            {/* The only part that scrolls on a phone. */}
            <div ref={areaRef} className={`space-y-2.5 ${fit.area}`}>
            {rows.map((r, i) => {
              const p = problems[i] || {};
              const sel = selAmount({ mrp: r.MRP, discPercent: r.disc });
              const n = unitsPerPack(r.Pack, r.Unit);
              const skipped = Number(r.qty || 0) === 0 && Number(r.free || 0) === 0;
              const msg = Object.values(p)[0];
              const oc = orderCalc(r);
              const open = openRows.has(r.PoLineId);
              const mbox = 'h-[30px] w-full min-w-0 rounded-lg border border-ink-200 bg-white px-1 text-center text-12 tabular-nums shadow-sm placeholder:text-10 placeholder:text-ink-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';
              // Every field: a heading, a box (typed or shown) and a note line, each the
              // same height, so the boxes line up across the row.
              const field = (label, boxEl, note = '') => (
                <label className="block min-w-0">
                  <span className="block h-4 truncate text-center text-10 font-semibold leading-4 text-ink-500">{label}</span>
                  {boxEl}
                  <span className="block h-3.5 truncate text-center text-9 leading-[14px] text-ink-400">{note}</span>
                </label>
              );
              const shown = (value, cls = '') => <div className={`flex h-[30px] items-center justify-center truncate rounded-lg bg-ink-50 px-1 text-12 tabular-nums text-ink-700 ${cls}`}>{value}</div>;
              const d = (label, value, cls = '') => (
                <div className="min-w-0">
                  <p className="truncate text-9.5 font-semibold text-ink-400">{label}</p>
                  <p className={`truncate text-12 tabular-nums text-ink-700 ${cls}`}>{value}</p>
                </div>
              );
              return (
                <div key={r.PoLineId} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${msg ? 'border-red-300' : skipped ? 'border-ink-200 opacity-75' : 'border-ink-200'}`}>
                  <div className="flex items-start gap-2 border-b border-ink-100 bg-brand-50/60 px-2.5 py-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-10 font-bold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-13 font-semibold leading-snug text-ink-800">{r.ItemName}</p>
                      <p className="text-10.5 text-ink-500">
                        {[r.Pack, r.Unit && `Unit ${r.Unit}`].filter(Boolean).join(' · ')}{r.Pack || r.Unit ? ' · ' : ''}Ordered {r.Ordered}{Number(r.FreeOrdered) ? ` + ${r.FreeOrdered} free` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-10 font-semibold ${skipped ? 'bg-ink-100 text-ink-500' : 'bg-emerald-100 text-emerald-700'}`}>
                      {skipped ? 'Skipped' : `Receiving ${receivedOf(r)}`}
                    </span>
                  </div>
                  <div className="space-y-1.5 p-2">
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr 0.65fr 0.65fr 1.6fr' }}>
                      {field('MRP', shown(money(r.MRP)))}
                      {field('P.Rate', shown(money(r.PRate)), Number(r.DiscPercent) ? `MRP less ${Number(r.DiscPercent)}%` : '')}
                      {field('Order', <input type="number" inputMode="decimal" min="0" step="any" className={`${mbox} no-spin font-semibold ${p.qty ? bad : ''}`} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />, `due ${r.Due}`)}
                      {field('Free', <input type="number" inputMode="decimal" min="0" step="any" className={`${mbox} no-spin ${p.free ? bad : ''}`} value={r.free} onChange={(e) => setRow(i, { free: e.target.value })} />, `due ${r.FreeDue}`)}
                      {field('Batch', <input className={`${mbox} ${p.batchNo ? bad : ''}`} placeholder="Batch" value={r.batchNo} onChange={(e) => setRow(i, { batchNo: e.target.value })} />)}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {field('Mf.Date', <MonthBox className={`${mbox} ${p.mfg ? bad : ''}`} value={r.mfg} onChange={(v) => setRow(i, { mfg: v })} />)}
                      {field('Exp.Date', <MonthBox className={`${mbox} ${p.exp ? bad : ''}`} value={r.exp} onChange={(v) => setRow(i, { exp: v })} />)}
                      {field('S.Disc %', <input type="number" inputMode="decimal" min="0" max="100" step="0.01" className={`${mbox} no-spin ${p.disc ? bad : ''}`} value={r.disc} onChange={(e) => setRow(i, { disc: e.target.value })} />)}
                      {field('Sel.Amount', shown(money(sel), '!bg-brand-50 font-bold text-brand-800'), `${money(round2(sel / n))} / unit`)}
                    </div>
                    {msg && <p className="rounded-md bg-red-50 px-2 py-1 text-11 text-red-600">{msg}</p>}
                    <button type="button" className="flex w-full items-center justify-between rounded-lg bg-ink-50 px-2.5 py-1.5 text-11.5 font-medium text-ink-600" onClick={() => toggleRow(r.PoLineId)}>
                      <span className="flex items-center gap-1">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {open ? 'Hide details' : 'More details'}</span>
                      <span className="tabular-nums">Total <b className="text-ink-800">₹{money(oc.total)}</b></span>
                    </button>
                    {open && (
                      <div className="grid grid-cols-4 gap-x-2 gap-y-1.5 rounded-lg border border-ink-100 px-2.5 py-2">
                        {d('Amount', money(oc.amount))}
                        {d('GST %', `${oc.gstPercent} (${Number(r.CGSTPercent || 0)}+${Number(r.SGSTPercent || 0)})`)}
                        {d('GST Amt', money(oc.gstAmount))}
                        {d('Total', money(oc.total), 'font-bold text-brand-800')}
                        {d('Disc %', Number(r.DiscPercent || 0))}
                        {d('Received earlier', `${r.Received}${Number(r.FreeReceived) ? ` + ${r.FreeReceived} free` : ''}`)}
                        {d('Unit Price', `${money(round2(sel / n))} ÷${n}`, 'text-emerald-700')}
                        <label className="flex items-end gap-1.5 pb-0.5 text-11 text-ink-600" title="Tick items, then fill Batch / dates / discount for all of them at once">
                          <input type="checkbox" checked={r.ticked} onChange={() => setRow(i, { ticked: !r.ticked })} /> Bulk fill
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
            {rows.length > 0 && (
              <div className="flex shrink-0 items-center justify-between rounded-xl bg-brand-600 px-3 py-1 text-white shadow-sm">
                <span className="text-13 font-semibold">Sum of Total</span>
                <span className="text-15 font-bold tabular-nums">₹{money(orderTotal)}</span>
              </div>
            )}
          </div>

          <div className="mt-2 hidden overflow-x-auto md:block">
            {/* Fixed layout: each column has a share of the width, so either view fits the screen. */}
            {/* Too many columns to squeeze below ~1280px: from there down it scrolls sideways. */}
            <table className="w-full table-fixed border-collapse text-left text-12" style={{ minWidth: 1170 }} {...gridKeys}>
              <thead>
                <tr className="bg-brand-50 font-bold leading-tight text-brand-700">
                  <th className={`${hd} ${al('chk')}`} style={w('chk')}><input type="checkbox" checked={allTicked} onChange={tickAll} disabled={!rows.length} title="Tick all" /></th>
                  <th className={`${hd} ${al('item')}`} style={w('item')}>Item Name</th>
                  <th className={`${hd} ${al('pack')}`} style={w('pack')}>Pack</th>
                  <th className={`${hd} ${al('unit')}`} style={w('unit')} title="Type / Unit from Item Master">Unit</th>
                  <th className={`${hd} ${al('mrp')}`} style={w('mrp')}>MRP</th>
                  {showRate ? (
                    <>
                      <th className={`${hd} ${GROUP.rate.head} ${al('pRate')}`} style={w('pRate')} title="The order's purchase rate">P.Rate</th>
                      <th className={`${hdArrow} ${GROUP.rate.head} ${al('discP')}`} style={w('discP')} title="The order's discount on P.Rate">
                        <span>Disc%</span>{arrow('rate', true, () => setShowRate(false), 'Show Amount again')}
                      </th>
                    </>
                  ) : (
                    <th className={`${hdArrow} ${al('amount')}`} style={w('amount')} title="R.Order × the order's rate (P.Rate less Disc%)">
                      <span>Amount</span>{arrow('rate', false, () => setShowRate(true), 'Show P.Rate and Disc%')}
                    </th>
                  )}
                  {showGst ? (
                    <>
                      <th className={`${hd} ${GROUP.gst.head} ${al('gst')}`} style={w('gst')}>GST%</th>
                      <th className={`${hd} ${GROUP.gst.head} ${al('cgst')}`} style={w('cgst')}>CGST%</th>
                      <th className={`${hdArrow} ${GROUP.gst.head} ${al('sgst')}`} style={w('sgst')}>
                        <span>SGST%</span>{arrow('gst', true, () => setShowGst(false), 'Show GST Amt again')}
                      </th>
                    </>
                  ) : (
                    <th className={`${hdArrow} ${al('gstAmt')}`} style={w('gstAmt')}>
                      <span>GST Amt</span>{arrow('gst', false, () => setShowGst(true), 'Show GST%, CGST% and SGST%')}
                    </th>
                  )}
                  <th className={`${hd} ${al('total')}`} style={w('total')} title="Amount + GST for what's received now">Total</th>
                  <th className={`${hd} ${al('ord')}`} style={w('ord')} title="Paid units on the order">Ordered</th>
                  <th className={`${hd} ${al('free')}`} style={w('free')} title="Free units on the order">Free</th>
                  <th className={`${hd} ${al('rec')}`} style={w('rec')} title="Total arriving now — splits into R.Order and R.Free">Received</th>
                  <th className={`${hd} ${al('rOrder')}`} style={w('rOrder')} title="Paid units received now (charged)">R.Order</th>
                  <th className={`${hd} ${al('rFree')}`} style={w('rFree')} title="Free units received now — added to stock, not charged">R.Free</th>
                  <th className={`${hd} ${al('batch')}`} style={w('batch')}>Batch No</th>
                  <th className={`${hd} ${al('month')}`} style={w('month')} title="Month the batch was made, as MM/YY">Mf.Date</th>
                  <th className={`${hd} ${al('month')}`} style={w('month')} title="Expiry month, as MM/YY">Exp.Date</th>
                  <th className={`${hd} ${al('disc')}`} style={w('disc')} title="Selling discount on MRP (Sel.Amount = MRP less this)">S.Disc%</th>
                  <th className={`${hdArrow} ${al('sel')}`} style={w('sel')} title="Selling price for one pack">
                    <span>Sel.Amount</span>{arrow('sel', showUnit, () => setShowUnit((v) => !v), showUnit ? 'Hide the unit price' : 'Show the unit price')}
                  </th>
                  {showUnit && <th className={`${hd} ${GROUP.sel.head} ${al('unitPrice')}`} style={w('unitPrice')} title="Sel.Amount for one piece (Sel.Amount ÷ units in the pack)">Unit Price</th>}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td className={`${cell} px-3 py-4 text-center text-ink-400`} colSpan={18 + extraCols + (showUnit ? 1 : 0)}>{orderId ? 'Loading the order…' : 'Pick a vendor and a purchase order to list its items.'}</td></tr>
                )}
                {rows.map((r, i) => {
                  const p = problems[i] || {};
                  const sel = selAmount({ mrp: r.MRP, discPercent: r.disc });
                  const n = unitsPerPack(r.Pack, r.Unit);
                  const skipped = Number(r.qty || 0) === 0 && Number(r.free || 0) === 0;
                  const msg = Object.values(p)[0];
                  const oc = orderCalc(r);
                  return (
                    <tr key={r.PoLineId} className={skipped ? 'text-ink-400' : ''} title={msg || (skipped ? 'Nothing received — this row is skipped' : '')}>
                      <td className={`${cell} text-center`}><input type="checkbox" checked={r.ticked} onChange={() => setRow(i, { ticked: !r.ticked })} /></td>
                      <td className={`${cell} px-1.5 font-medium ${skipped ? '' : 'text-ink-800'}`}>
                        {r.ItemName}
                        {msg && <p className="text-11 font-normal text-red-600">{msg}</p>}
                      </td>
                      <td className={`${cell} px-1 text-center`}>{r.Pack}</td>
                      <td className={`${cell} px-1 text-center`}>{r.Unit}</td>
                      <td className={`${cell} ${ro}`}>{money(r.MRP)}</td>
                      {showRate ? (
                        <>
                          <td className={`${cell} ${ro} ${GROUP.rate.cell}`}>{money(r.PRate)}</td>
                          <td className={`${cell} ${ro} ${GROUP.rate.cell}`}>{Number(r.DiscPercent || 0)}</td>
                        </>
                      ) : (
                        <td className={`${cell} ${ro}`}>{money(oc.amount)}</td>
                      )}
                      {showGst ? (
                        <>
                          <td className={`${cell} ${ro} ${GROUP.gst.cell}`}>{oc.gstPercent}</td>
                          <td className={`${cell} ${ro} ${GROUP.gst.cell}`}>{Number(r.CGSTPercent || 0)}</td>
                          <td className={`${cell} ${ro} ${GROUP.gst.cell}`}>{Number(r.SGSTPercent || 0)}</td>
                        </>
                      ) : (
                        <td className={`${cell} ${ro}`}>{money(oc.gstAmount)}</td>
                      )}
                      <td className={`${cell} ${ro} font-semibold text-ink-800`}>{money(oc.total)}</td>
                      <td className={`${cell} ${ro}`}>{r.Ordered}</td>
                      <td className={`${cell} ${ro}`}>{r.FreeOrdered}</td>
                      <td className={`${cell} !px-0`} title={`Total arriving now — splits into R.Order (up to ${r.Due} due) and R.Free (up to ${r.FreeDue} free due)`}>
                        <input type="number" min="0" step="any" data-r={i} data-c={0} className={`${box} no-spin text-right font-semibold ${p.qty || p.free ? bad : ''}`} value={receivedOf(r)} onChange={(e) => setRow(i, splitReceived(r, e.target.value))} />
                      </td>
                      <td className={`${cell} !px-0`} title={`Ordered ${r.Ordered} · received earlier ${r.Received} · still due ${r.Due}`}>
                        <input type="number" min="0" step="any" data-r={i} data-c={1} className={`${box} no-spin text-right ${p.qty ? bad : ''}`} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
                        {r.Received > 0 && <p className="px-1 text-right text-11 text-ink-400">earlier: {r.Received}</p>}
                      </td>
                      <td className={`${cell} !px-0`} title={`Free ordered ${r.FreeOrdered} · received earlier ${r.FreeReceived} · still due ${r.FreeDue}`}>
                        <input type="number" min="0" step="any" data-r={i} data-c={2} className={`${box} no-spin text-right ${p.free ? bad : ''}`} value={r.free} onChange={(e) => setRow(i, { free: e.target.value })} />
                        {r.FreeReceived > 0 && <p className="px-1 text-right text-11 text-ink-400">earlier: {r.FreeReceived}</p>}
                      </td>
                      <td className={`${cell} !px-0`}><input data-r={i} data-c={3} className={`${box} text-left ${p.batchNo ? bad : ''}`} value={r.batchNo} onChange={(e) => setRow(i, { batchNo: e.target.value })} /></td>
                      <td className={`${cell} !px-0`}><MonthBox data-r={i} data-c={4} className={`${box} text-center ${p.mfg ? bad : ''}`} value={r.mfg} onChange={(v) => setRow(i, { mfg: v })} /></td>
                      <td className={`${cell} !px-0`}><MonthBox data-r={i} data-c={5} className={`${box} text-center ${p.exp ? bad : ''}`} value={r.exp} onChange={(v) => setRow(i, { exp: v })} /></td>
                      <td className={`${cell} !px-0`}><input type="number" min="0" max="100" step="0.01" data-r={i} data-c={6} className={`${box} no-spin text-right ${p.disc ? bad : ''}`} value={r.disc} onChange={(e) => setRow(i, { disc: e.target.value })} /></td>
                      <td className={`${cell} px-1 text-right font-semibold text-ink-800`}>{money(sel)}</td>
                      {showUnit && (
                        <td className={`${cell} px-1 text-right ${GROUP.sel.cell}`} title={`${money(sel)} ÷ ${n} units`}>
                          <span className="font-semibold">{money(round2(sel / n))}</span>
                          <p className="text-11 text-emerald-700/70">÷ {n}</p>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="bg-ink-50 font-semibold">
                    <td className={`${cell} px-2 text-right`} colSpan={7 + extraCols}>Sum of Total</td>
                    <td className={`${cell} px-1 text-right text-ink-900`}>{money(orderTotal)}</td>
                    <td className={cell} colSpan={10 + (showUnit ? 1 : 0)} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p className="hidden text-xs text-ink-500 md:block">
              Received = R.Order + R.Free and starts at what's still due; typing it splits into R.Order first, then R.Free. Both go into stock, only R.Order is charged. Rows with nothing received are skipped. Sel.Amount = MRP less S.Disc% (selling discount); Sel.Amount › shows the Unit Price, Sel.Amount ÷ the units in the pack.
            </p>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <button type="button" className="btn-secondary" onClick={() => (editing ? navigate('/pharmacy/stock-in-list') : reset())}><X size={16} /> Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving || !!locked}><Save size={16} /> {saving ? 'Saving...' : editing ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </form>
      </div>
      <PhoneFooter footerRef={footerRef}>
        <button type="button" className="btn-secondary whitespace-nowrap px-2" disabled={!rows.length} onClick={toggleAll}>
          {allOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {allOpen ? 'Hide details' : 'All details'}
        </button>
        <button type="button" className="btn-secondary whitespace-nowrap px-2" onClick={() => navigate('/pharmacy/stock-in-list')}>
          <List size={16} /> View List
        </button>
      </PhoneFooter>
      <ScanBillModal open={scanOpen} onClose={() => setScanOpen(false)} forStock onStockLines={fillFromBill} />
      <Toast toast={toast} />
    </div>
  );
}
