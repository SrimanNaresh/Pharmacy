import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Plus, Trash2, Save, X, ScanLine, ChevronLeft, ChevronRight } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { useToast } from '../../hooks/useToast.js';
import { itemMasterApi, purchaseOrderApi, stockInApi, vendorApi } from '../../api/client.js';
import { emptyForm } from './ItemForm.jsx';
import ScanBillModal from './ScanBillModal.jsx';
import { compact, likeness } from '../../utils/billScan.js';
import { pRateOf, purchaseLine, round2, roundOffOf, selAmount } from '../../utils/purchaseCalc.js';

// Pharmacy > Stock In > Three in One (IPS): Item, Purchase and Stock in one
// entry. Scan the supplier's bill (or type the lines), check the table — its
// columns grouped as on the Item Master, Purchase / Order and Stock In
// screens — and one Save:
//   1. adds the lines' new items to Item Master (an item with the same
//      Item Name, HSN and Category is used as it is),
//   2. saves the Purchase Order (P.Rate = MRP less Disc %),
//   3. saves the Stock In for all of it (Batch No, Mf/Exp month, S.Disc %),
//      which adds the stock and sets each item's selling price.
// Each step goes through its own screen's server checks; the rows are
// checked the same way first. If the Stock In can't be saved after the
// order was, the order is kept and the Stock In can be saved again here.

const MAX_GST = 28;
const pad = (n) => String(n).padStart(2, '0');
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const money = (n) => (Number(n) || 0).toFixed(2);
const numStr = (v) => (v == null || v === '' ? '' : String(Number(v)));
// 'MM/YY' as typed <-> 'YYYY-MM' as saved ('bad' when not a real month).
const toMonth = (t) => {
  if (!t) return '';
  const m = /^(\d{2})\/(\d{2})$/.exec(t);
  return m && Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `20${m[2]}-${m[1]}` : 'bad';
};
const toText = (ym) => (ym ? `${ym.slice(5, 7)}/${ym.slice(2, 4)}` : '');
const monthTyped = (v) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };
const digits = (s) => String(s || '').replace(/\D/g, '');
const code = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

let nextKey = 1;
const emptyRow = () => ({
  key: nextKey++, itemId: null,
  name: '', generic: '', manufacturer: '', hsn: '', category: '', pack: '', unit: '', rack: '',
  mrp: '', disc: '', pRate: '', qty: '', free: '', gst: '',
  batch: '', mfg: '', exp: '', sDisc: '',
});

// The vendor's details from Vendor Master, as on the order (saved on it).
function vendorDetails(v) {
  if (!v) return '';
  const statePin = [v.State, v.Pincode].filter(Boolean).join(' – ');
  const phones = [v.ContactNo && `Mobile: ${v.ContactNo}`, v.AlternateNo && `Phone: ${v.AlternateNo}`].filter(Boolean).join(', ');
  const dl = [v.DLNo, v.DLNo2].filter(Boolean).join(', ');
  return [v.Address, statePin, phones, v.Email && `Email: ${v.Email}`, v.GSTNo && `GSTIN: ${v.GSTNo}`, dl && `DL No: ${dl}`]
    .filter(Boolean).join('\n');
}

// P.Rate = MRP less Disc %: typing MRP or Disc % works out the P.Rate, typing
// the P.Rate works out the Disc % (as on the order).
function priced(r, key, value) {
  const next = { ...r, [key]: value };
  const mrp = Number(next.mrp);
  if (!(mrp > 0)) return { [key]: value };
  if (key === 'pRate') {
    if (value === '') return { pRate: value };
    const d = round2((1 - Number(value) / mrp) * 100);
    return { pRate: value, disc: d > 0 && d <= 100 ? String(d) : '' };
  }
  if (next.disc === '' && key === 'mrp') return { mrp: value };
  return { [key]: value, pRate: String(pRateOf(next.mrp, next.disc)) };
}

// The Item Master item this row is: the same Item Name, with no other HSN or
// Category (a blank one on either side doesn't count). null = a new item.
function itemOf(r, byName) {
  const same = byName.get(compact(r.name)) || [];
  const differs = (a, b) => a !== '' && b !== '' && a !== b;
  return same.find((it) => !differs(digits(it.HSNCode), digits(r.hsn)) && !differs(code(it.Category), code(r.category))) || null;
}
// What makes two rows the same entry (the second is a repeat).
const entryKey = (r) => (compact(r.name) ? `${compact(r.name)}|${digits(r.hsn)}|${code(r.batch || r.category)}` : '');

// A row's problem (the servers check the same), or null.
function rowProblem(r, now) {
  if (!compact(r.name)) return 'Item Name is required';
  if (r.name.trim().length > 200) return 'Item Name must be at most 200 characters';
  if (!(Number(r.qty) > 0)) return 'Qty must be more than 0';
  if (!(Number(r.free || 0) >= 0)) return 'Free must be 0 or more';
  if (!(Number(r.mrp) > 0)) return 'MRP must be more than 0';
  if (!(Number(r.pRate) > 0)) return 'P.Rate must be more than 0';
  if (Number(r.pRate) > Number(r.mrp)) return `P.Rate can't be above MRP ${money(r.mrp)}`;
  const d = Number(r.disc || 0);
  if (!(d >= 0 && d <= 100)) return 'Disc % must be 0–100';
  const g = Number(r.gst || 0);
  if (!(g >= 0 && g <= MAX_GST)) return `GST % must be 0–${MAX_GST}`;
  if (!r.batch.trim()) return 'Batch No is required';
  if (r.batch.trim().length > 50) return 'Batch No must be at most 50 characters';
  const exp = toMonth(r.exp);
  const mfg = toMonth(r.mfg);
  if (!exp) return 'Exp.Date is required (MM/YY)';
  if (exp === 'bad') return 'Exp.Date: use MM/YY';
  if (mfg === 'bad') return 'Mf.Date: use MM/YY';
  if (exp < now) return "Exp.Date can't be a past month";
  if (mfg && mfg > now) return "Mf.Date can't be a future month";
  if (mfg && exp <= mfg) return 'Exp.Date must be after Mf.Date';
  const s = Number(r.sDisc || 0);
  if (!(s >= 0 && s <= 100)) return 'S.Disc % must be 0–100';
  return null;
}

const calcOf = (r) => {
  const half = Number(r.gst || 0) / 2;
  return purchaseLine({ pRate: r.pRate, discPercent: r.disc, quantity: r.qty, cgstPercent: half, sgstPercent: half });
};

export default function StockIps() {
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [vendors, setVendors] = useState([]);
  const [items, setItems] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(today());
  const [roundOn, setRoundOn] = useState(true);
  const [rows, setRows] = useState(() => [emptyRow()]);
  const [lastRates, setLastRates] = useState({});
  const [scanOpen, setScanOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // The order once saved, while its Stock In still isn't: { id, no }.
  const [savedPo, setSavedPo] = useState(null);
  // Vendor details (from Vendor Master, editable — saved on the order), shown with ›;
  // a new vendor being added: { name, address, mobile, gstNo?, email? } or null.
  const [details, setDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [newVendor, setNewVendor] = useState(null);

  const loadItems = () => itemMasterApi.list().then(setItems).catch(() => show('Failed to load items', 'error'));
  useEffect(() => {
    vendorApi.list().then(setVendors).catch(() => show('Failed to load vendors', 'error'));
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!vendorId) { setLastRates({}); return; }
    purchaseOrderApi.lastRates(vendorId).then(setLastRates).catch(() => setLastRates({}));
  }, [vendorId]);

  const vendorOptions = useMemo(
    () => vendors.filter((v) => v.Status !== 'Inactive' || String(v.VendorId) === vendorId).map((v) => ({ value: String(v.VendorId), label: v.VendorName })),
    [vendors, vendorId],
  );
  const byName = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const k = compact(it.Name);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(it);
    }
    return m;
  }, [items]);
  const itemNames = useMemo(() => [...new Set(items.filter((i) => i.Status !== 'Inactive').map((i) => i.Name))].sort(), [items]);

  const now = thisMonth();
  const used = rows.filter((r) => compact(r.name) || r.qty || r.mrp);
  const view = rows.map((r, i) => {
    const item = r.itemId ? items.find((it) => it.ItemId === r.itemId) || null : itemOf(r, byName);
    const k = entryKey(r);
    const first = k ? rows.findIndex((o) => entryKey(o) === k) : i;
    const isUsed = used.includes(r);
    const problem = !isUsed ? null : first !== i ? `Same Item Name, HSN and Batch as row ${first + 1}` : rowProblem(r, now);
    return { r, item, problem, isUsed, calc: calcOf(r) };
  });
  const sum = round2(view.filter((v) => v.isUsed).reduce((s, v) => s + v.calc.total, 0));
  const roundOff = roundOn ? roundOffOf(sum) : 0;
  const newCount = view.filter((v) => v.isUsed && !v.item).length;

  const pickVendor = (id) => {
    setVendorId(id);
    setDetails(vendorDetails(vendors.find((v) => String(v.VendorId) === id)));
  };
  const saveNewVendor = async () => {
    const { name, address, mobile, gstNo, email } = newVendor;
    if (!name.trim() || !address.trim() || !mobile.trim()) return show('Vendor name, Address and Mobile are all required', 'error');
    try {
      const v = await vendorApi.create({ vendorName: name, address, contactNo: mobile, ...(gstNo ? { gstNo } : {}), ...(email ? { email } : {}) });
      setVendors((all) => [v, ...all]);
      setVendorId(String(v.VendorId));
      setDetails(vendorDetails(v));
      setNewVendor(null);
      show(`Added vendor ${v.VendorName}`, 'success');
    } catch (err) {
      show(err.response?.data?.error || 'Could not add the vendor', 'error');
    }
  };
  // The bill's supplier (read from its top): the bill date, and the vendor —
  // the Vendor Master one with that name, else a new vendor to check and add.
  const fillSupplier = (s) => {
    if (!s) return '';
    const notes = [];
    if (s.billDate) { setDate(s.billDate); notes.push('bill date'); }
    if (!s.vendorName || vendorId) return notes.join(', ');
    const best = vendors
      .filter((v) => v.Status !== 'Inactive')
      .map((v) => ({ v, score: likeness(v.VendorName, s.vendorName) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 0.85) {
      pickVendor(String(best.v.VendorId));
      notes.push(`vendor ${best.v.VendorName}`);
    } else {
      setNewVendor({ name: s.vendorName, address: s.address || '', mobile: s.mobile || '', gstNo: s.gstNo, email: s.email });
      setDetails([s.address, s.mobile && `Mobile: ${s.mobile}`, s.email && `Email: ${s.email}`, s.gstNo && `GSTIN: ${s.gstNo}`].filter(Boolean).join('\n'));
      setShowDetails(true);
      notes.push('new vendor — check it and press Add vendor');
    }
    return notes.join(', ');
  };

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Typing a name that's on Item Master fills the row's empty Item columns (and MRP / GST) from it.
  const setName = (r, name) => {
    const patch = { name: name.toUpperCase(), itemId: null };
    const one = byName.get(compact(name)) || [];
    if (one.length === 1) {
      const it = one[0];
      const fill = { generic: it.GenericName, manufacturer: it.ManufacturerName, hsn: it.HSNCode, category: it.Category, pack: it.Pack, unit: it.UnitName, rack: it.Rack };
      for (const [f, v] of Object.entries(fill)) if (!r[f] && v) patch[f] = String(v);
      if (!r.mrp && Number(it.MRP) > 0) Object.assign(patch, priced({ ...r, ...patch }, 'mrp', numStr(it.MRP)));
      if (!r.gst && (it.CGSTPercent != null || it.SGSTPercent != null)) patch.gst = String(round2(Number(it.CGSTPercent || 0) + Number(it.SGSTPercent || 0)));
    }
    setRow(r.key, patch);
  };
  const addRowAfter = (key) => setRows((rs) => { const i = rs.findIndex((r) => r.key === key); return [...rs.slice(0, i + 1), emptyRow(), ...rs.slice(i + 1)]; });
  const removeRow = (key) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [emptyRow()]));
  const reset = () => { setRows([emptyRow()]); setSavedPo(null); setDate(today()); setVendorId(''); setDetails(''); setShowDetails(false); setNewVendor(null); };

  // Scanned lines fill the table (after the rows already typed in); repeats are left out.
  const fromBill = (lines, { supplier } = {}) => {
    setScanOpen(false);
    const have = new Set(rows.map(entryKey).filter(Boolean));
    const add = [];
    let repeats = 0;
    for (const b of lines) {
      const r = {
        ...emptyRow(), name: b.name, generic: b.generic, manufacturer: b.manufacturer, hsn: b.hsnCode, category: b.category,
        pack: b.pack, unit: b.unit, rack: b.rack, mrp: numStr(b.mrp), disc: numStr(b.disc), pRate: numStr(b.pRate),
        qty: numStr(b.qty), free: numStr(b.free), gst: numStr(b.gst),
        batch: b.batch || b.category, mfg: toText(b.mfg), exp: toText(b.exp), sDisc: numStr(b.sDisc),
      };
      // P.Rate = MRP less Disc % (or the Disc % from the bill's rate); S.Disc % from a selling price.
      if (r.disc !== '') Object.assign(r, priced(r, 'disc', r.disc));
      else if (Number(r.pRate) > 0) Object.assign(r, priced(r, 'pRate', r.pRate));
      if (r.sDisc === '' && Number(b.sel) > 0 && Number(r.mrp) >= Number(b.sel)) r.sDisc = String(round2((1 - Number(b.sel) / Number(r.mrp)) * 100));
      const k = entryKey(r);
      if (k && have.has(k)) { repeats += 1; continue; }
      have.add(k);
      add.push(r);
    }
    setRows((rs) => [...rs.filter((r) => compact(r.name) || r.qty || r.mrp), ...add, ...(add.length ? [] : [emptyRow()])]);
    const filledIn = fillSupplier(supplier);
    show(`${add.length} line${add.length === 1 ? '' : 's'} from the bill${filledIn ? ` (filled in: ${filledIn})` : ''}${repeats ? ` · ${repeats} repeated line${repeats === 1 ? '' : 's'} left out` : ''} — check the red rows, then Save`, 'success');
  };

  const save = async () => {
    if (!vendorId) return show('Vendor Name is required', 'error');
    if (!date) return show('Date is required', 'error');
    const lines = view.filter((v) => v.isUsed);
    if (!lines.length) return show('Add at least one line (or Scan Bill)', 'error');
    const bad = lines.find((v) => v.problem);
    if (bad) return show(`Row ${view.indexOf(bad) + 1}: ${bad.problem}`, 'error');
    setSaving(true);
    let po = savedPo;
    try {
      // 1. New items into Item Master (their pick-list values first).
      const ids = new Map(lines.map((v) => [v.r.key, v.item?.ItemId ?? null]));
      if (!po) {
        const listed = {};
        const listName = async (field, value) => {
          const n = String(value || '').trim().toUpperCase();
          if (!n) return '';
          const k = `${field}:${n}`;
          if (!(k in listed)) {
            try { listed[k] = (await itemMasterApi.addListValue(field, n)).name; } catch (err) {
              if (field === 'category') throw new Error(`Couldn't add "${n}" to the Category list: ${err.response?.data?.error || err.message}`);
              listed[k] = ''; // Manufacturer / Generic / Unit: the item is saved without it.
            }
          }
          return listed[k];
        };
        let added = 0;
        for (const v of lines) {
          if (ids.get(v.r.key)) continue;
          const r = v.r;
          const half = String(Number(r.gst || 0) / 2);
          const it = await itemMasterApi.create({
            ...emptyForm, name: r.name.trim(), hsnCode: r.hsn.trim(), pack: r.pack.trim(), rack: r.rack.trim(), mrp: r.mrp,
            cgstPercent: half, sgstPercent: half,
            manufacturer: await listName('manufacturer', r.manufacturer), generic: await listName('generic', r.generic),
            unit: await listName('unit', r.unit), category: await listName('category', r.category),
          }).catch((err) => { throw new Error(`${r.name}: ${err.response?.data?.error || 'Item not saved'}`); });
          ids.set(r.key, it.ItemId);
          setRow(r.key, { itemId: it.ItemId });
          added += 1;
        }
        if (added) await loadItems();

        // 2. The Purchase Order.
        const half = (r) => String(Number(r.gst || 0) / 2);
        const created = await purchaseOrderApi.create({
          vendorId: Number(vendorId), orderDate: date, roundOff: roundOn,
          vendorDetails: details,
          lines: lines.map(({ r }) => ({ itemId: ids.get(r.key), mrp: r.mrp, pRate: r.pRate, freeQty: r.free, discPercent: r.disc, quantity: r.qty, cgstPercent: half(r), sgstPercent: half(r) })),
        }).catch((err) => { throw new Error(`Order not saved: ${err.response?.data?.error || err.message}`); });
        po = { id: created.PurchaseOrderId, no: created.OrderNo, added };
        setSavedPo(po);
      }

      // 3. The Stock In for everything on the order (its lines are in the rows' order).
      const poLines = await stockInApi.orderLines(po.id);
      const si = await stockInApi.create({
        vendorId: Number(vendorId), purchaseOrderId: po.id, inDate: date,
        lines: lines.map(({ r }, i) => ({
          poLineId: poLines[i]?.PoLineId, batchNo: r.batch.trim(), mfgMonth: toMonth(r.mfg), expMonth: toMonth(r.exp),
          quantity: r.qty, freeQty: r.free || 0, discPercent: r.sDisc || 0,
        })),
      }).catch((err) => { throw new Error(`Order ${po.no} is saved, but not the Stock In: ${err.response?.data?.error || err.message} — fix it and press Save again`); });
      show(`Saved ${po.no} and ${si.StockInNo}${po.added ? ` · ${po.added} new item${po.added === 1 ? '' : 's'} in Item Master` : ''} — stock and selling prices updated`, 'success');
      reset();
    } catch (err) {
      show(err.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Table look (as the order grid).
  const cell = 'border-b border-r border-ink-200 px-0.5 py-0.5 align-middle';
  const hd = 'border-b border-r border-ink-200 px-1 py-1.5 text-center align-middle text-10 xl:text-11 whitespace-nowrap';
  const box = 'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-12 focus:border-brand-400 focus:bg-white focus:outline-none disabled:text-ink-500';
  const numBox = `${box} no-spin text-right`;
  const ro = 'px-1.5 text-right text-12 tabular-nums text-ink-600';
  const GROUPS = [
    ['Item Master', 8, 'bg-sky-50 text-sky-800'],
    ['Purchase / Order', 10, 'bg-brand-50 text-brand-800'],
    ['Stock In', 5, 'bg-emerald-50 text-emerald-800'],
  ];
  // Frozen columns: # (36px) and Item Name (230px) stay put while the rest scrolls sideways.
  const freeze0 = 'sticky left-0 w-[36px] min-w-[36px] max-w-[36px]';
  const freeze1 = 'sticky left-[36px] w-[230px] min-w-[230px] max-w-[230px] shadow-[2px_0_0_0_rgb(226_232_240)]';
  const lockedOrder = Boolean(savedPo); // after the order is saved, only the Stock In columns can change
  // Arrow keys (gridKeys): each box is data-r (row) / data-c (its column, left to right).
  const COL = Object.fromEntries(['name', 'generic', 'manufacturer', 'hsn', 'category', 'pack', 'unit', 'rack', 'mrp', 'disc', 'pRate', 'qty', 'free', 'gst', 'batch', 'mfg', 'exp', 'sDisc', 'add', 'remove'].map((k, c) => [k, c]));
  const rowNo = new Map(rows.map((r, i) => [r.key, i]));
  // A box reached with the arrows that's hidden under the frozen # / Item Name
  // columns is scrolled out from under them.
  const keepInView = (e) => {
    gridKeys.onFocus(e);
    const el = e.target;
    const scroller = el.closest('.overflow-auto');
    if (!scroller || el.closest('td')?.classList.contains('sticky')) return;
    const edge = scroller.getBoundingClientRect().left + 36 + 230;
    const left = el.getBoundingClientRect().left;
    if (left < edge) scroller.scrollLeft -= edge - left + 8;
  };
  const text = (r, f, w, extra = {}) => (
    <td className={cell} style={{ minWidth: w }}>
      <input data-r={rowNo.get(r.key)} data-c={COL[f]} className={box} value={r[f]} disabled={lockedOrder && !extra.stock} onChange={(e) => setRow(r.key, { [f]: extra.upper === false ? e.target.value : e.target.value.toUpperCase() })} />
    </td>
  );
  const num = (r, f, w, onChange, extra = {}) => (
    <td className={cell} style={{ minWidth: w }}>
      <input data-r={rowNo.get(r.key)} data-c={COL[f]} type="number" min="0" step="any" className={`${numBox} ${extra.className || ''}`} value={r[f]} disabled={lockedOrder && !extra.stock}
        onChange={(e) => setRow(r.key, onChange ? onChange(e.target.value) : { [f]: e.target.value })} />
    </td>
  );
  const month = (r, f) => (
    <td className={cell} style={{ minWidth: 62 }}>
      <input data-r={rowNo.get(r.key)} data-c={COL[f]} inputMode="numeric" placeholder="MM/YY" maxLength={5} className={`${box} text-center`} value={r[f]} onChange={(e) => setRow(r.key, { [f]: monthTyped(e.target.value) })} />
    </td>
  );

  return (
    <div className="card max-md:!px-3">
      <CardHeader
        icon={Layers}
        title="Three in One (IPS)"
        subtitle={<span className="hidden md:inline">Item, Purchase and Stock in one entry — scan the bill, check the lines, save once</span>}
        actions={(
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={lockedOrder} onClick={() => setScanOpen(true)} title="Read the supplier's bill into the table">
              <ScanLine size={16} /> Scan Bill
            </button>
            <button type="button" className="btn-secondary hidden md:inline-flex" onClick={() => navigate('/pharmacy/stock-in-list')}>Stock In List</button>
          </div>
        )}
      />

      {savedPo && (
        <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">
          Order <b>{savedPo.no}</b> is saved; its Stock In isn&apos;t yet. Fix the Stock In columns and press Save again (the order and items are kept).
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-80">
          <label className="label">Vendor Name *</label>
          <div className="flex gap-1">
            <div className="min-w-0 flex-1">
              <SearchPick
                className="input" placeholder="Search vendor..." options={vendorOptions} value={vendorId} disabled={lockedOrder}
                onChange={(v) => pickVendor(v)}
                footer={{ label: '+ Add vendor', onClick: (typed) => setNewVendor({ name: typed, address: '', mobile: '' }) }}
              />
            </div>
            <button type="button" className="btn-secondary px-2" title={showDetails ? 'Hide vendor details' : 'Show vendor details (from Vendor Master)'} onClick={() => setShowDetails((s) => !s)}>
              {showDetails ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        </div>
        <div className="w-40">
          <label className="label">Date *</label>
          <input type="date" className="input" value={date} disabled={lockedOrder} onChange={(e) => setDate(e.target.value)} />
        </div>
        <p className="pb-2 text-xs text-ink-500">
          {used.length} line{used.length === 1 ? '' : 's'}{newCount ? ` · ${newCount} new item${newCount === 1 ? '' : 's'} for Item Master` : ''}
        </p>
      </div>

      {newVendor && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-brand-100 bg-brand-50/50 p-2">
          <div className="w-48"><label className="label">Vendor name *</label><input autoFocus className="input" value={newVendor.name} onChange={(e) => setNewVendor((v) => ({ ...v, name: e.target.value }))} /></div>
          <div className="min-w-[14rem] flex-1"><label className="label">Address *</label><input className="input" value={newVendor.address} onChange={(e) => setNewVendor((v) => ({ ...v, address: e.target.value }))} /></div>
          <div className="w-40"><label className="label">Mobile *</label><input type="tel" className="input" value={newVendor.mobile} onChange={(e) => setNewVendor((v) => ({ ...v, mobile: e.target.value }))} /></div>
          <button type="button" className="btn-primary" onClick={saveNewVendor}><Save size={15} /> Add vendor</button>
          <button type="button" className="btn-secondary" title="Cancel" onClick={() => setNewVendor(null)}><X size={15} /></button>
        </div>
      )}

      {showDetails && (
        <div className="mt-2 sm:w-[28rem]">
          <label className="label">Vendor Details</label>
          <textarea className="input text-xs" rows={4} value={details} disabled={lockedOrder} onChange={(e) => setDetails(e.target.value)} placeholder="Pick a vendor to fill this in from Vendor Master" />
        </div>
      )}

      <datalist id="ips-items">{itemNames.map((n) => <option key={n} value={n} />)}</datalist>
      {/* The table scrolls both ways in its own box; the headings stay on top
          and # and Item Name stay on the left (frozen). */}
      <div className="mt-3 max-h-[65vh] overflow-auto rounded-lg border border-ink-200">
        <table className="w-full border-separate border-spacing-0 text-left text-12" {...gridKeys} onFocus={keepInView}>
          <thead className="sticky top-0 z-20">
            <tr className="text-11 font-bold">
              <th className={`${hd} ${freeze0} z-30 bg-ink-50`} rowSpan={2}>#</th>
              <th className={`${hd} ${freeze1} z-30 bg-sky-50 text-sky-800`} rowSpan={2}>Item Name</th>
              {GROUPS.map(([g, n, tone], gi) => <th key={g} colSpan={gi === 0 ? n - 1 : n} className={`${hd} ${tone}`}>{g}</th>)}
              <th className={`${hd} bg-ink-50`} rowSpan={2} />
            </tr>
            <tr className="text-11 font-bold leading-tight">
              {['Generic', 'Manufacturer', 'HSN', 'Category', 'Pack', 'Unit', 'Rack'].map((h) => <th key={h} className={`${hd} bg-sky-50 text-sky-800`}>{h}</th>)}
              {['MRP', 'Old Price', 'Disc%', 'P.Rate', 'Qty', 'Free', 'Amount', 'GST%', 'GST Amt', 'Total'].map((h) => <th key={h} className={`${hd} bg-brand-50 text-brand-700`}>{h}</th>)}
              {['Batch No', 'Mf.Date', 'Exp.Date', 'S.Disc%', 'Sel.Amount'].map((h) => <th key={h} className={`${hd} bg-emerald-50 text-emerald-800`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.map(({ r, item, problem, isUsed, calc }, i) => (
              <tr key={r.key} className={problem ? 'bg-red-50' : 'bg-white'} title={problem || ''}>
                <td className={`${cell} ${freeze0} z-10 text-center text-ink-400 ${problem ? 'bg-red-50' : 'bg-white'}`}>{i + 1}</td>
                <td className={`${cell} ${freeze1} z-10 ${problem ? 'bg-red-50' : 'bg-white'}`}>
                  <input data-r={i} data-c={COL.name} list="ips-items" className={`${box} uppercase`} placeholder="Item name..." value={r.name} disabled={lockedOrder} onChange={(e) => setName(r, e.target.value)} />
                  {isUsed && compact(r.name) && (
                    <p className={`px-1 text-10 ${item ? 'text-ink-400' : 'font-semibold text-brand-600'}`}>
                      {item ? `In Item Master · ${item.ItemCode || `ITM${String(item.ItemId).padStart(6, '0')}`}` : 'New — added to Item Master on save'}
                    </p>
                  )}
                  {problem && <p className="px-1 text-10 text-red-600">{problem}</p>}
                </td>
                {text(r, 'generic', 100)}
                {text(r, 'manufacturer', 110)}
                {text(r, 'hsn', 85)}
                {text(r, 'category', 90)}
                {text(r, 'pack', 65)}
                {text(r, 'unit', 55)}
                {text(r, 'rack', 55)}
                {num(r, 'mrp', 70, (v) => priced(r, 'mrp', v))}
                <td className={`${cell} ${ro}`}>{item ? money(lastRates[item.ItemId] ?? 0) : ''}</td>
                {num(r, 'disc', 55, (v) => priced(r, 'disc', v))}
                {num(r, 'pRate', 70, (v) => priced(r, 'pRate', v), { className: Number(r.pRate) > Number(r.mrp) ? 'border-red-400 bg-red-50 text-red-700' : '' })}
                {num(r, 'qty', 50)}
                {num(r, 'free', 50)}
                <td className={`${cell} ${ro}`}>{isUsed ? money(calc.amount) : ''}</td>
                {num(r, 'gst', 50)}
                <td className={`${cell} ${ro}`}>{isUsed ? money(calc.gstAmount) : ''}</td>
                <td className={`${cell} ${ro} font-semibold text-ink-800`}>{isUsed ? money(calc.total) : ''}</td>
                {text(r, 'batch', 90, { stock: true })}
                {month(r, 'mfg')}
                {month(r, 'exp')}
                {num(r, 'sDisc', 55, null, { stock: true })}
                <td className={`${cell} ${ro}`}>{Number(r.mrp) > 0 ? money(selAmount({ mrp: r.mrp, discPercent: r.sDisc })) : ''}</td>
                <td className={`${cell} whitespace-nowrap text-center`}>
                  <button data-r={i} data-c={COL.add} type="button" className="rounded p-1 text-brand-600 hover:bg-brand-50 disabled:opacity-30" title="Add a row below" disabled={lockedOrder} onClick={() => addRowAfter(r.key)}><Plus size={14} /></button>
                  <button data-r={i} data-c={COL.remove} type="button" className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-30" title="Remove this row" disabled={lockedOrder} onClick={() => removeRow(r.key)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-sm text-ink-600">
          <span>Sum of Total <b className="tabular-nums text-ink-800">₹{money(sum)}</b></span>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={roundOn} disabled={lockedOrder} onChange={(e) => setRoundOn(e.target.checked)} /> Round Off <span className="tabular-nums">{money(roundOff)}</span></label>
          <span>Net Amount <b className="tabular-nums text-brand-800">₹{money(sum + roundOff)}</b></span>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={saving} onClick={reset}><X size={16} /> {savedPo ? 'Start Over' : 'Clear'}</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={save}><Save size={16} /> {saving ? 'Saving...' : savedPo ? 'Save Stock In' : 'Save All'}</button>
        </div>
      </div>

      <ScanBillModal open={scanOpen} onClose={() => setScanOpen(false)} forIps onIpsLines={fromBill} />
      <Toast toast={toast} />
    </div>
  );
}
