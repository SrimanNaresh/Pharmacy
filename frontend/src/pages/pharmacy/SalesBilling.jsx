import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Receipt, Trash2, Save, X, List, Printer, Pencil, Plus, Check } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import { CardField, CardValue, ItemCard, cardBox, cardBad } from '../../components/MobileCard.jsx';
import { usePhoneFit, PhoneFooter, PhoneTabs } from '../../components/PhoneLayout.jsx';
import SalesBillReceipt from './SalesBillReceipt.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { useToast } from '../../hooks/useToast.js';
import { pharmacyItemApi, salesBillingApi, clinicApi } from '../../api/client.js';
import { unitsPerPack, saleLineAmount, saleBill, roundOffOf } from '../../utils/purchaseCalc.js';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => (Number(n) || 0).toFixed(2);
const round2 = (n) => Math.round(n * 100) / 100;
// Expiry as MM/YY, like Stock In, so the batch label fits its column.
const expLabel = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : 'none');
const qtyLabel = (n) => String(Math.round(Number(n) * 100) / 100);
const batchLabel = (b) => `${b.Batch || 'No batch'} · Exp ${expLabel(b.ExpiryDate)} · ${qtyLabel(b.AvailableQty)}`;

// saleUnit: 'pack' (the whole pack) or 'unit' (one piece). packPrice is the
// pack's selling price; a unit's is packPrice / the units in the pack (the
// item's Type / Unit count, e.g. 15 a strip).
let nextKey = 1;
const emptyLine = () => ({ key: nextKey++, itemId: '', batches: [], batch: null, saleUnit: 'pack', packPrice: '', qty: '', price: '', disc: '', loading: false });

// Pharmacy > Sales > Master: a counter sale. Each line is sold from one batch
// (only batches with stock left, earliest expiry first), by the Pack or by the
// Unit (a single piece of it); the server re-checks every quantity, price and
// total. Stock is counted in packs, so 5 units of a 10's pack take 0.5.
export default function SalesBilling() {
  const { toast, show } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState([]);
  const [transDate, setTransDate] = useState(today());
  const [customerName, setCustomerName] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [billDisc, setBillDisc] = useState(''); // the bill's Discount %
  const [roundOn, setRoundOn] = useState(true); // Round Off the Total to the nearest rupee
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [clinic, setClinic] = useState(null);
  // The bill just saved, offered for printing above the form.
  const [printBill, setPrintBill] = useState(null);
  // Save & Print: print once the saved bill's receipt is in the page; after an
  // edit, go back to the list when the print dialog closes.
  const [printNow, setPrintNow] = useState(null); // null | { then?: () => void }
  useEffect(() => {
    if (!printNow || !printBill) return undefined;
    const t = setTimeout(() => {
      if (printNow.then) window.addEventListener('afterprint', printNow.then, { once: true });
      window.print();
      setPrintNow(null);
    }, 50);
    return () => clearTimeout(t);
  }, [printNow, printBill]);

  useEffect(() => { pharmacyItemApi.list().then(setCatalog).catch(() => show('Failed to load items', 'error')); }, [show]);
  useEffect(() => { clinicApi.get().then(setClinic).catch(() => setClinic(null)); }, []);

  const itemById = useMemo(() => new Map(catalog.map((i) => [String(i.ItemId), i])), [catalog]);
  const itemOptions = useMemo(() => catalog.map((i) => ({ value: String(i.ItemId), label: i.Name })), [catalog]);

  const setLine = (key, patch) => setLines((ls) => {
    const next = ls.map((l) => (l.key === key ? { ...l, ...patch } : l));
    // Always keep one empty row at the end to type the next item into.
    return next[next.length - 1].itemId ? [...next, emptyLine()] : next;
  });
  // Where the cursor goes after the next render: { key, c } = that row's box
  // in column c (0 Item Name, 5 Quantity).
  const [focusAt, setFocusAt] = useState(null);
  useEffect(() => {
    if (!focusAt) return;
    const r = lines.findIndex((l) => l.key === focusAt.key);
    const el = document.querySelector(`[data-r="${r}"][data-c="${focusAt.c}"]:not(:disabled)`);
    if (!el) return; // not enabled yet: try again on the next render
    el.focus();
    try { el.select(); } catch { /* not selectable */ }
    setFocusAt(null);
  }, [focusAt, lines]);
  // Enter on a row: on to the next empty row's Item Name (the last row is always empty).
  const nextItem = (key) => {
    const i = lines.findIndex((l) => l.key === key);
    const empty = lines.slice(i + 1).find((l) => !l.itemId);
    if (empty) setFocusAt({ key: empty.key, c: 0 });
  };
  const enterTo = (go) => (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  const removeLine = (key) => setLines((ls) => {
    const next = ls.filter((l) => l.key !== key);
    return next.length && !next[next.length - 1].itemId ? next : [...next, emptyLine()];
  });

  const defaultPrice = (item) => item?.SellPrice ?? item?.MRP ?? '';

  const sizeOf = (l) => { const it = itemById.get(l.itemId); return unitsPerPack(it?.Pack, it?.UnitName); };
  // A pack price shown for the line's Sell by: as is for a pack, divided for a unit.
  const perSellBy = (l, packValue) => (packValue == null || packValue === '' ? null : round2(Number(packValue) / (l.saleUnit === 'unit' ? sizeOf(l) : 1)));
  // The batch's MRP and purchase price (P.Rate less Disc%) from its Stock In,
  // or the item's when the batch came from an older screen.
  const mrpOf = (l) => perSellBy(l, batchOfLine(l)?.MRP ?? itemById.get(l.itemId)?.MRP);
  const purchaseOf = (l) => perSellBy(l, batchOfLine(l)?.PurchaseRate ?? itemById.get(l.itemId)?.PurchaseRate);
  // The line's price for its pack price and unit choice.
  const priceFor = (l, packPrice, saleUnit) => {
    const pp = Number(packPrice);
    if (packPrice === '' || Number.isNaN(pp)) return '';
    return String(saleUnit === 'unit' ? round2(pp / sizeOf(l)) : pp);
  };

  // Each item's batch list is fetched once per bill (picking it again, or on
  // another row, is instant); cleared after a save, as stock has changed.
  const batchCache = useRef(new Map());
  const loadBatches = (itemId) => {
    const k = `${itemId}|${editingId || ''}`;
    if (!batchCache.current.has(k)) {
      batchCache.current.set(k, salesBillingApi.batches(itemId, editingId || undefined).catch((err) => {
        batchCache.current.delete(k);
        throw err;
      }));
    }
    return batchCache.current.get(k);
  };

  // Picking an item fills the earliest-expiring batch and its price, and puts
  // the cursor on Batch. Enter then moves Batch -> Sell by -> Quantity ->
  // Disc% -> the next row's Item Name.
  const pickItem = async (key, itemId) => {
    const item = itemById.get(itemId);
    const pp = String(defaultPrice(item));
    setLine(key, { itemId, batches: [], batch: null, saleUnit: 'pack', packPrice: pp, price: pp, qty: '1', loading: true });
    setFocusAt({ key, c: 1 }); // Batch, once its list has loaded
    try {
      const batches = await loadBatches(itemId);
      // The earliest-expiring batch is chosen to start with, at its Stock In selling price.
      const first = batches[0];
      if (!batches.length) setFocusAt({ key, c: 2 }); // no batch to pick: on to Sell by
      setLine(key, { batches, batch: first?.Batch ?? null, loading: false, ...(first?.SelAmount != null ? { packPrice: String(first.SelAmount), price: String(first.SelAmount) } : {}) });
    } catch {
      show('Failed to load batches for this item', 'error');
      setLine(key, { loading: false });
    }
  };

  // Stock of each line's batch (in packs), and how many packs all lines take from it.
  const batchOfLine = (l) => l.batches.find((b) => b.Batch === l.batch);
  const packsOf = (l) => (Number(l.qty) || 0) / (l.saleUnit === 'unit' ? sizeOf(l) : 1);
  const used = new Map();
  for (const l of lines) {
    if (l.itemId && l.batch != null) {
      const k = `${l.itemId}|${l.batch}`;
      used.set(k, (used.get(k) || 0) + packsOf(l));
    }
  }
  // A batch's stock in the line's own unit.
  const stockIn = (l, b) => (l.saleUnit === 'unit' ? Math.floor(b.AvailableQty * sizeOf(l) + 1e-6) : qtyLabel(b.AvailableQty));
  const amountOf = (l) => saleLineAmount({ quantity: l.qty, rate: l.price, discPercent: l.disc });
  // What the row's quantity cost to buy: Quantity × Purchase Price (per pack or unit).
  const costOf = (l) => round2((Number(l.qty) || 0) * (purchaseOf(l) || 0));
  const problemOf = (l) => {
    if (!l.itemId || l.loading) return null;
    const b = batchOfLine(l);
    if (!b) return { qty: 'No stock' };
    if (used.get(`${l.itemId}|${l.batch}`) > b.AvailableQty + 0.00005) return { qty: `Only ${stockIn(l, b)} ${l.saleUnit === 'unit' ? 'unit(s)' : 'pack(s)'} in stock` };
    const mrp = mrpOf(l) || 0;
    if (mrp > 0 && Number(l.price) > mrp) return { price: `Above MRP ${money(mrp)}` };
    if (l.disc !== '' && !(Number(l.disc) >= 0 && Number(l.disc) <= 100)) return { disc: '0 to 100' };
    // No selling below cost: the row's Amount must cover its purchase price.
    if (Number(l.qty) > 0 && amountOf(l) < costOf(l)) return { amount: `Below cost ${money(costOf(l))}` };
    return null;
  };
  const changeUnit = (l, saleUnit) => setLine(l.key, { saleUnit, price: priceFor(l, l.packPrice, saleUnit) });
  const filled = lines.filter((l) => l.itemId);
  const billDiscBad = billDisc !== '' && !(Number(billDisc) >= 0 && Number(billDisc) <= 100);
  const { subTotal, discountAmount, total } = saleBill(filled.map(amountOf), billDiscBad ? 0 : billDisc);
  // The bill too: after its discount, the Total must cover the rows' purchase cost.
  const totalCost = round2(filled.reduce((s, l) => s + costOf(l), 0));
  const belowCost = filled.length > 0 && total < totalCost;
  const roundOff = roundOn ? roundOffOf(total) : 0;
  const netAmount = round2(total + roundOff);
  const hasProblem = billDiscBad || belowCost
    || filled.some((l) => l.loading || problemOf(l) || !(Number(l.qty) > 0) || !(Number(l.price) > 0));

  // Phones: two tabs — New Item (a form for one line) and Bill Items (the lines
  // added, with Edit / Delete). The form works on line `curKey`: the empty last
  // line for a new item (held once an item is picked, as picking adds the next
  // empty line), or a listed line while it's being edited.
  const [saleTab, setSaleTab] = useState('new');
  const [curKey, setCurKey] = useState(null);
  const [curEditing, setCurEditing] = useState(false);
  const formRef = useRef(null);
  const cur = lines.find((l) => l.key === curKey) || lines[lines.length - 1];
  // The item still being entered (not yet "Add to bill") isn't shown in the list.
  const listed = filled.filter((l) => curEditing || l.key !== cur.key);
  const addCur = () => {
    if (!cur.itemId) return show('Pick an item first', 'error');
    if (cur.loading) return show('Loading the batches…', 'error');
    const problem = problemOf(cur);
    if (problem) return show(Object.values(problem)[0], 'error');
    if (!(Number(cur.qty) > 0)) return show('Enter a Quantity', 'error');
    if (!(Number(cur.price) > 0)) return show('Enter a Sale Price', 'error');
    show(curEditing ? 'Item updated' : `Item added — ${listed.length + 1} in the bill`, 'success');
    if (curEditing) setSaleTab('list');
    setCurEditing(false);
    setCurKey(null); // back to the empty last line
    if (!curEditing) setTimeout(() => formRef.current?.querySelector('input')?.focus(), 50);
  };
  const editLine = (l) => { setCurKey(l.key); setCurEditing(true); setSaleTab('new'); };
  const clearCur = () => {
    if (curEditing) { setCurEditing(false); setCurKey(null); return; }
    if (cur.itemId) removeLine(cur.key);
    setCurKey(null);
  };
  const deleteLine = (l) => {
    if (!confirm(`Remove ${itemById.get(l.itemId)?.Name || 'this item'} from the bill?`)) return;
    removeLine(l.key);
    if (l.key === cur.key) { setCurEditing(false); setCurKey(null); }
  };
  const { pageRef, areaRef, footerRef, fit } = usePhoneFit([saleTab, editingId, curEditing, !!printBill, belowCost]);

  const resetForm = () => {
    setCurKey(null);
    setCurEditing(false);
    setSaleTab('new');
    setEditingId(null);
    setLines([emptyLine()]);
    setCustomerName('');
    setMobileNo('');
    setBillDisc('');
    setRoundOn(true);
    setTransDate(today());
  };

  // A sale opened from the list: its lines get their batch lists with this
  // sale's own quantities counted as still available.
  const startEdit = async (id) => {
    try {
      const sale = await salesBillingApi.get(id);
      const built = await Promise.all(sale.lines.map(async (l) => {
        let batches = [];
        try { batches = await salesBillingApi.batches(l.ItemId, id); } catch { /* keeps the saved batch only */ }
        const batch = l.Batch || '';
        if (!batches.some((b) => b.Batch === batch)) batches = [...batches, { Batch: batch, ExpiryDate: l.ExpiryDate, AvailableQty: 0 }];
        const saleUnit = l.SaleUnit === 'unit' ? 'unit' : 'pack';
        const size = Number(l.PackSize) || 1;
        const packPrice = String(batches.find((b) => b.Batch === batch)?.SelAmount ?? round2(Number(l.Rate) * (saleUnit === 'unit' ? size : 1)));
        return { ...emptyLine(), itemId: String(l.ItemId), batches, batch, saleUnit, packPrice, qty: String(Number(l.UnitQty)), price: String(Number(l.Rate)), disc: Number(l.DiscPercent) ? String(Number(l.DiscPercent)) : '' };
      }));
      setEditingId(id);
      setTransDate(String(sale.TransDate).slice(0, 10));
      setCustomerName(sale.CustomerName || '');
      setMobileNo(sale.MobileNo || '');
      setBillDisc(Number(sale.DiscPercent) ? String(Number(sale.DiscPercent)) : '');
      setRoundOn(Number(sale.RoundOff) !== 0);
      setLines([...built, emptyLine()]);
      setCurKey(null);
      setCurEditing(false);
      setSaleTab('list');
    } catch {
      show('Failed to load sale for editing', 'error');
    }
  };

  useEffect(() => {
    const id = location.state?.editSale?.SalesBillingId;
    if (id) {
      startEdit(id);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (e, print = false) => {
    e.preventDefault();
    if (!transDate) return show('Date is required', 'error');
    if (!customerName.trim()) return show('Customer Name is required', 'error');
    if (mobileNo && !/^\+?[0-9][0-9\s-]*$/.test(mobileNo.trim())) return show('Mobile No must contain numbers only', 'error');
    if (!filled.length) return show('Add at least one item', 'error');
    if (hasProblem) return show('Fix the rows marked in red first', 'error');
    setSaving(true);
    try {
      const payload = {
        transDate, customerName, mobileNo, discPercent: Number(billDisc) || 0, roundOff: roundOn,
        items: filled.map((l) => ({ itemId: Number(l.itemId), batch: l.batch, saleUnit: l.saleUnit, quantity: Number(l.qty), rate: Number(l.price), discPercent: Number(l.disc) || 0 })),
      };
      const billOf = (saved) => ({
        code: saved.Code, transDate, customerName,
        lines: filled.map((l) => ({
          itemName: `${itemById.get(l.itemId)?.Name || ''}${l.saleUnit === 'unit' ? ' (unit)' : ''}`, batch: l.batch,
          qty: Number(l.qty), rate: Number(l.price), disc: Number(l.disc) || 0, amount: amountOf(l),
        })),
        subTotal, discPercent: Number(billDisc) || 0, discountAmount, roundOff,
        total: Number(saved.TotalAmount),
      });
      const toList = () => navigate('/pharmacy/sales-billing-list', { state: { flash: 'Sale updated' } });
      if (editingId) {
        const saved = await salesBillingApi.update(editingId, payload);
        batchCache.current.clear();
        if (print) {
          setPrintBill(billOf(saved));
          setPrintNow({ then: toList });
        } else toList();
      } else {
        const saved = await salesBillingApi.create(payload);
        batchCache.current.clear();
        show(`Saved ${saved.Code}`, 'success');
        setPrintBill(billOf(saved));
        if (print) setPrintNow({});
        resetForm();
      }
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Compact grid: one-line headings, short rows, light lines, and boxes that
  // only show their border on hover / focus.
  const cell = 'border-b border-r border-ink-100 px-1.5 py-0 align-middle';
  const th = 'border-b border-r border-brand-100 px-1.5 py-1 text-[12px] font-semibold whitespace-nowrap';
  const num = 'text-right tabular-nums';
  const box = 'h-6 w-full rounded border border-transparent bg-transparent px-1 py-0 text-[13px] leading-6 hover:border-ink-200 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:hover:border-transparent';

  return (
    <div ref={pageRef} className={fit.page} style={fit.pageStyle}>
      <div className={`card no-print max-md:!px-3 ${fit.card}`}>
        <form onSubmit={save} className={fit.form}>
          <CardHeader
            icon={Receipt}
            title={editingId ? 'Edit Sale' : 'Sales'}
            subtitle={<span className="hidden md:inline">{editingId ? 'Update this sale' : 'Counter sale from a batch'}</span>}
            actions={
              <button type="button" className="btn-secondary hidden md:inline-flex" onClick={() => navigate('/pharmacy/sales-billing-list')}>
                <List size={16} /> View List
              </button>
            }
          />

          {printBill && (
            <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm">
              <span>Saved <b>{printBill.code}</b> · {printBill.customerName} · ₹{money(printBill.total)}</span>
              <button type="button" className="btn-secondary py-1" onClick={() => window.print()}><Printer size={14} /> Print</button>
              <button type="button" className="ml-auto text-ink-400 hover:text-ink-600" title="Close" onClick={() => setPrintBill(null)}><X size={16} /></button>
            </div>
          )}

          <div className="grid grid-cols-[7rem_1fr] gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
            <div className="min-w-0">
              <label className="label">Date *</label>
              <input type="date" className="input max-md:!px-1.5" value={transDate} onChange={(e) => setTransDate(e.target.value)} />
            </div>
            <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto lg:col-span-2">
              <label className="label max-md:hidden">Customer Name *</label>
              <input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name *" aria-label="Customer Name" />
            </div>
            <div className="min-w-0">
              <label className="label">Mobile No</label>
              <input type="tel" inputMode="numeric" className="input" value={mobileNo} onChange={(e) => setMobileNo(e.target.value)} placeholder="e.g. 98765 43210" />
            </div>
          </div>

          {/* Phones: New Item / Bill Items tabs, then the bill totals. The New Item form
              shows Batch · Sell by · MRP · Purchase Price, then Sale Price · Quantity ·
              Disc% · Amount. */}
          <div className={`mt-3 flex flex-col gap-2.5 md:hidden ${fit.section}`}>
            <PhoneTabs tab={saleTab} onTab={setSaleTab} editing={curEditing} count={listed.length} listLabel="Bill Items" />
            {/* The only part that scrolls on a phone. */}
            <div ref={areaRef} className={`space-y-2.5 ${fit.area}`}>
              {saleTab === 'new' && (() => {
                const l = cur;
                const item = itemById.get(l.itemId);
                const b = batchOfLine(l);
                const problem = problemOf(l);
                const msg = problem && Object.values(problem)[0];
                const tags = l.itemId ? [item?.Rack && `Rack ${item.Rack}`, item?.BoxNo && `Box ${item.BoxNo}`, b && `Stock ${stockIn(l, b)} ${l.saleUnit === 'unit' ? 'unit(s)' : 'pack(s)'}`].filter(Boolean) : [];
                return (
                  <div ref={formRef}>
                    <ItemCard
                      no={curEditing ? <Pencil size={10} /> : <Plus size={11} />} bad={!!msg}
                      title={(
                        <div className="flex items-center gap-1.5">
                          <div className="min-w-0 flex-1">
                            <SearchPick className="input" placeholder="Search item..." options={itemOptions} value={l.itemId} onChange={(v) => { setCurKey(l.key); pickItem(l.key, v); }} />
                          </div>
                          {l.itemId && <button type="button" className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" title={curEditing ? 'Cancel edit' : 'Clear'} onClick={clearCur}><X size={16} /></button>}
                        </div>
                      )}
                      sub={tags.length ? <span className="mt-1 flex flex-wrap gap-1">{tags.map((t) => <span key={t} className="rounded bg-white px-1.5 py-px text-[10px] font-semibold text-brand-700 ring-1 ring-brand-100">{t}</span>)}</span> : null}
                    >
                      {l.itemId ? (
                        <>
                          <div className="grid gap-1.5" style={{ gridTemplateColumns: '1.75fr 1.05fr 0.95fr 0.95fr' }}>
                            <CardField label="Batch" note={b ? `Exp ${expLabel(b.ExpiryDate)}` : ''}>
                              <select
                                className={`${cardBox} !text-left`} disabled={l.loading || !l.batches.length} value={l.batch ?? ''}
                                onChange={(e) => {
                                  const bt = l.batches.find((x) => x.Batch === e.target.value);
                                  setLine(l.key, { batch: e.target.value, ...(bt?.SelAmount != null ? { packPrice: String(bt.SelAmount), price: priceFor(l, bt.SelAmount, l.saleUnit) } : {}) });
                                }}
                              >
                                {l.loading && <option value="">Loading…</option>}
                                {!l.loading && !l.batches.length && <option value="">No stock</option>}
                                {l.batches.map((bt) => <option key={bt.Batch} value={bt.Batch}>{bt.Batch || 'No batch'} ({qtyLabel(bt.AvailableQty)})</option>)}
                              </select>
                            </CardField>
                            <CardField label="Sell by">
                              <select className={`${cardBox} !text-left`} value={l.saleUnit} onChange={(e) => changeUnit(l, e.target.value)}>
                                <option value="pack">Pack{sizeOf(l) > 1 ? ` (${sizeOf(l)})` : ''}</option>
                                <option value="unit" disabled={sizeOf(l) <= 1}>Unit</option>
                              </select>
                            </CardField>
                            <CardField label="MRP"><CardValue>{mrpOf(l) != null ? money(mrpOf(l)) : '-'}</CardValue></CardField>
                            <CardField label="Pur. Price"><CardValue>{purchaseOf(l) != null ? money(purchaseOf(l)) : '-'}</CardValue></CardField>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            <CardField label="Sale Price">
                              <input type="number" inputMode="decimal" step="0.01" min="0" className={`${cardBox} no-spin font-semibold ${problem?.price ? cardBad : ''}`} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                            </CardField>
                            <CardField label="Quantity">
                              <input type="number" inputMode="decimal" step="1" min="0" placeholder="0" className={`${cardBox} no-spin font-semibold ${problem?.qty ? cardBad : ''}`} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                            </CardField>
                            <CardField label="Disc %">
                              <input type="number" inputMode="decimal" step="0.01" min="0" max="100" placeholder="0" className={`${cardBox} no-spin ${problem?.disc ? cardBad : ''}`} value={l.disc} onChange={(e) => setLine(l.key, { disc: e.target.value })} />
                            </CardField>
                            <CardField label="Amount">
                              <CardValue className={problem?.amount ? '!bg-red-50 font-bold text-red-700' : '!bg-brand-50 font-bold text-brand-800'}>{money(amountOf(l))}</CardValue>
                            </CardField>
                          </div>
                          {msg && <p className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600">{msg}</p>}
                          <div className="flex gap-2">
                            {curEditing && <button type="button" className="btn-secondary flex-1" onClick={clearCur}><X size={16} /> Cancel</button>}
                            <button type="button" className="btn-primary flex-[2]" onClick={addCur}>
                              {curEditing ? <><Check size={16} /> Done</> : <><Plus size={16} /> Add to bill</>}
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="px-1 py-0.5 text-[11.5px] text-ink-400">Search and pick an item, enter the Quantity, then tap <span className="font-semibold text-brand-700">Add to bill</span>.</p>
                      )}
                    </ItemCard>
                  </div>
                );
              })()}

              {saleTab === 'list' && (
                <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
                  {listed.length === 0 && (
                    <p className="px-3 py-5 text-center text-[12px] text-ink-400">
                      No items yet — add them on the <button type="button" className="font-semibold text-brand-700" onClick={() => setSaleTab('new')}>New Item</button> tab.
                    </p>
                  )}
                  {listed.map((l, i) => {
                    const problem = problemOf(l);
                    const msg = problem && Object.values(problem)[0];
                    return (
                      <div key={l.key} className={`flex items-start gap-2 border-t border-ink-100 px-3 py-2 first:border-t-0 ${curEditing && l.key === cur.key ? 'bg-amber-50' : msg ? 'bg-red-50' : ''}`}>
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-600">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-[13px] font-medium leading-snug text-ink-800">{itemById.get(l.itemId)?.Name || 'Item'}</p>
                          <p className="text-[11px] leading-snug text-ink-500">
                            {l.batch ? `Batch ${l.batch} · ` : ''}Qty {Number(l.qty) || 0} {l.saleUnit === 'unit' ? 'unit' : 'pack'} × ₹{money(l.price)}{Number(l.disc) ? ` · Disc ${Number(l.disc)}%` : ''}
                          </p>
                          {msg && <p className="text-[11px] text-red-600">{msg}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          <span className="text-[13px] font-bold tabular-nums text-brand-800">₹{money(amountOf(l))}</span>
                          <div className="mt-0.5 flex gap-1">
                            <button type="button" className="rounded-lg border border-brand-100 p-1 text-brand-600 hover:bg-brand-50" title="Edit" onClick={() => editLine(l)}><Pencil size={14} /></button>
                            <button type="button" className="rounded-lg border border-red-100 p-1 text-red-500 hover:bg-red-50" title="Delete" onClick={() => deleteLine(l)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-white text-[13px] shadow-sm">
              <div className="flex items-center justify-between gap-2 px-3 py-1">
                <span className="text-ink-600">Sub Total <b className="tabular-nums text-ink-900">{money(subTotal)}</b></span>
                <label className="inline-flex items-center gap-1.5 text-ink-600">
                  Bill Disc %
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0" max="100" placeholder="0"
                    className={`h-6 w-12 rounded-md border bg-white px-1 text-right text-[12px] tabular-nums no-spin focus:outline-none focus:ring-2 ${billDiscBad || (belowCost && discountAmount > 0) ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-100' : 'border-ink-200 focus:border-brand-400 focus:ring-brand-100'}`}
                    value={billDisc} onChange={(e) => setBillDisc(e.target.value)}
                  />
                  {discountAmount > 0 && <span className="tabular-nums text-red-600">−{money(discountAmount)}</span>}
                </label>
              </div>
              {belowCost && !filled.some((l) => problemOf(l)?.amount) && (
                <p className="bg-red-50 px-3 py-1 text-[11px] text-red-600">Below the purchase cost {money(totalCost)} — lower the Bill Discount</p>
              )}
              <div className="flex items-center justify-between gap-2 bg-brand-600 px-3 py-1 text-white">
                <label className="inline-flex items-center gap-1.5 text-[12px] text-white/90" title={`Total ${money(total)} rounded to the nearest rupee`}>
                  <input type="checkbox" checked={roundOn} onChange={(e) => setRoundOn(e.target.checked)} /> Round Off
                  <span className="tabular-nums">{roundOff > 0 ? '+' : roundOff < 0 ? '−' : ''}{money(Math.abs(roundOff))}</span>
                </label>
                <span className="text-[13px]"><span className="font-semibold">Net</span> <b className={`text-[15px] tabular-nums ${belowCost ? 'text-red-200' : ''}`}>₹{money(netAmount)}</b></span>
              </div>
            </div>
          </div>

          <div className="mt-3 hidden overflow-x-auto rounded-lg border border-ink-200 shadow-sm md:block">
            {/* Fixed column shares (adding up to 100%) so every heading stays on one line. */}
            <table className="w-full min-w-[1100px] table-fixed border-collapse text-left text-[13px]" {...gridKeys}>
              <thead>
                <tr className="bg-gradient-to-b from-brand-50 to-brand-100/60 text-brand-800">
                  <th className={`${th} w-[3%] text-center`}>#</th>
                  <th className={`${th} w-[15.5%]`}>Item Name</th>
                  <th className={`${th} w-[13.5%]`}>Batch</th>
                  <th className={`${th} w-[9%]`} title="Sell the whole pack (units in it), or single units">Sell by</th>
                  <th className={`${th} w-[4.5%] text-center`}>Rack</th>
                  <th className={`${th} w-[4.5%] text-center`}>Box</th>
                  <th className={`${th} w-[5.5%] text-right`}>Stock</th>
                  <th className={`${th} w-[6%] text-right`} title="The batch's MRP, for one pack or one unit as picked in Sell by">MRP</th>
                  <th className={`${th} w-[9%] text-right`} title="The batch's purchase price (P.Rate less Disc%), for one pack or one unit">Purchase Price</th>
                  <th className={`${th} w-[7.5%] text-right`} title="Selling price, for one pack or one unit">Sale Price</th>
                  <th className={`${th} w-[6%] text-right`}>Quantity</th>
                  <th className={`${th} w-[5.5%] text-right`} title="Discount on this row: Amount = Quantity × Sale Price less Disc%">Disc%</th>
                  <th className={`${th} w-[7%] text-right`} title="Quantity × Sale Price less Disc%">Amount</th>
                  <th className={`${th} w-[4%] border-r-0`} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, r) => {
                  const item = itemById.get(l.itemId);
                  const b = batchOfLine(l);
                  const problem = problemOf(l);
                  return (
                    <tr key={l.key} className="transition-colors even:bg-slate-50/60 hover:bg-brand-50/40">
                      <td className={`${cell} text-center text-[12px] text-ink-400`}>{r + 1}</td>
                      <td className={cell}>
                        <SearchPick
                          className={box} data-r={r} data-c={0} placeholder="Search item..."
                          options={itemOptions} value={l.itemId} onChange={(v) => pickItem(l.key, v)}
                        />
                      </td>
                      <td className={cell}>
                        <select
                          className={box} data-r={r} data-c={1} data-own-updown
                          onKeyDown={enterTo(() => setFocusAt({ key: l.key, c: 2 }))}
                          disabled={!l.itemId || l.loading || !l.batches.length}
                          value={l.batch ?? ''}
                          onChange={(e) => {
                            const bt = l.batches.find((x) => x.Batch === e.target.value);
                            setLine(l.key, { batch: e.target.value, ...(bt?.SelAmount != null ? { packPrice: String(bt.SelAmount), price: priceFor(l, bt.SelAmount, l.saleUnit) } : {}) });
                          }}
                        >
                          {!l.itemId && <option value="">Pick an item first</option>}
                          {l.itemId && l.loading && <option value="">Loading…</option>}
                          {l.itemId && !l.loading && !l.batches.length && <option value="">No stock</option>}
                          {l.batches.map((bt) => <option key={bt.Batch} value={bt.Batch}>{batchLabel(bt)}</option>)}
                        </select>
                      </td>
                      <td className={cell}>
                        <select
                          className={box} data-r={r} data-c={2} data-own-updown disabled={!l.itemId}
                          onKeyDown={enterTo(() => setFocusAt({ key: l.key, c: 4 }))}
                          value={l.saleUnit} onChange={(e) => changeUnit(l, e.target.value)}
                          title={l.itemId && sizeOf(l) <= 1 ? 'Set the units in a pack (Type / Unit, e.g. 15) on the item to sell single units' : ''}
                        >
                          <option value="pack">Pack{l.itemId && sizeOf(l) > 1 ? ` (${sizeOf(l)})` : item?.Pack ? ` (${item.Pack})` : ''}</option>
                          <option value="unit" disabled={!!l.itemId && sizeOf(l) <= 1}>Unit</option>
                        </select>
                      </td>
                      <td className={`${cell} text-center`}>{item?.Rack && <span className="rounded bg-brand-50 px-1.5 py-px text-[11px] font-semibold text-brand-700 ring-1 ring-brand-100">{item.Rack}</span>}</td>
                      <td className={`${cell} text-center`}>{item?.BoxNo && <span className="rounded bg-brand-50 px-1.5 py-px text-[11px] font-semibold text-brand-700 ring-1 ring-brand-100">{item.BoxNo}</span>}</td>
                      <td className={`${cell} ${num} text-ink-600`}>{b ? stockIn(l, b) : ''}</td>
                      <td className={`${cell} ${num} text-ink-500`}>{l.itemId && mrpOf(l) != null ? money(mrpOf(l)) : ''}</td>
                      <td className={`${cell} ${num} text-ink-500`}>{l.itemId && purchaseOf(l) != null ? money(purchaseOf(l)) : ''}</td>
                      <td className={cell}>
                        <input
                          type="number" step="0.01" min="0" data-r={r} data-c={3}
                          className={`${box} no-spin text-right font-medium tabular-nums ${problem?.price ? 'border-red-400 bg-red-50 text-red-700' : ''}`}
                          value={l.price} disabled={!l.itemId}
                          onChange={(e) => setLine(l.key, { price: e.target.value })}
                          onKeyDown={enterTo(() => setFocusAt({ key: l.key, c: 4 }))}
                        />
                        {problem?.price && <p className="px-1 text-[11px] text-red-600">{problem.price}</p>}
                      </td>
                      <td className={cell}>
                        <input
                          type="number" step="1" min="0" data-r={r} data-c={4}
                          className={`${box} no-spin text-right tabular-nums ${problem?.qty ? 'border-red-400 bg-red-50 text-red-700' : ''}`}
                          value={l.qty} disabled={!l.itemId}
                          onChange={(e) => setLine(l.key, { qty: e.target.value })}
                          onKeyDown={enterTo(() => setFocusAt({ key: l.key, c: 5 }))}
                        />
                        {problem?.qty && <p className="px-1 text-[11px] text-red-600">{problem.qty}</p>}
                      </td>
                      <td className={cell}>
                        <input
                          type="number" step="0.01" min="0" max="100" data-r={r} data-c={5} placeholder={l.itemId ? '0' : ''}
                          className={`${box} no-spin text-right tabular-nums ${problem?.disc ? 'border-red-400 bg-red-50 text-red-700' : ''}`}
                          value={l.disc} disabled={!l.itemId}
                          onChange={(e) => setLine(l.key, { disc: e.target.value })}
                          onKeyDown={enterTo(() => nextItem(l.key))}
                        />
                        {problem?.disc && <p className="px-1 text-[11px] text-red-600">{problem.disc}</p>}
                      </td>
                      <td className={`${cell} ${num} font-semibold ${problem?.amount ? 'bg-red-50 text-red-700' : 'text-ink-900'}`} title={problem?.amount ? `Amount is below the purchase cost (${money(costOf(l))})` : undefined}>
                        {l.itemId ? money(amountOf(l)) : ''}
                        {problem?.amount && <p className="text-[11px] font-normal leading-tight text-red-600">{problem.amount}</p>}
                      </td>
                      <td className={`${cell} border-r-0 !px-0.5`}>
                        <div className="flex justify-center">
                          {l.itemId && <button type="button" data-r={r} data-c={6} className="rounded p-0.5 text-red-500 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300" title="Delete row" onClick={() => removeLine(l.key)}><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-ink-700">
                  <td className="px-2 pt-1 text-right text-[12px] text-ink-500" colSpan={12}>Sub Total</td>
                  <td className={`px-2 pt-1 ${num}`}>{money(subTotal)}</td>
                  <td />
                </tr>
                <tr className="text-ink-700">
                  <td className="px-2 py-0.5 text-right text-[12px] text-ink-500" colSpan={12}>
                    <span className="inline-flex items-center gap-1.5">
                      Bill Discount %
                      <input
                        type="number" step="0.01" min="0" max="100" placeholder="0"
                        className={`h-6 w-20 rounded border bg-white px-1.5 py-0 text-right text-[13px] tabular-nums no-spin focus:outline-none focus:ring-2 ${billDiscBad || (belowCost && discountAmount > 0) ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-100' : 'border-ink-200 focus:border-brand-400 focus:ring-brand-100'}`}
                        value={billDisc} onChange={(e) => setBillDisc(e.target.value)}
                        title="Discount on the whole bill, taken off the Sub Total"
                      />
                    </span>
                  </td>
                  <td className={`px-2 py-0.5 ${num} ${discountAmount ? 'text-red-600' : 'text-ink-400'}`}>{discountAmount ? `− ${money(discountAmount)}` : money(0)}</td>
                  <td />
                </tr>
                <tr className="border-t border-brand-100 bg-brand-50/70 font-semibold text-ink-800">
                  <td className="px-2 py-1 text-right text-[12px] uppercase tracking-wide text-ink-500" colSpan={12}>
                    {belowCost && !filled.some((l) => problemOf(l)?.amount) && <span className="mr-3 normal-case tracking-normal text-red-600">Total is below the purchase cost {money(totalCost)} — lower the Bill Discount</span>}
                    Total
                  </td>
                  <td className={`px-2 py-1 ${num} text-[14px] font-bold ${belowCost ? 'text-red-600' : 'text-brand-800'}`}>{money(total)}</td>
                  <td />
                </tr>
                <tr className="text-ink-700">
                  <td className="px-2 py-0.5 text-right text-[12px] text-ink-500" colSpan={12}>
                    <label className="inline-flex cursor-pointer items-center gap-1.5" title="Round the Total to the nearest rupee">
                      <input type="checkbox" checked={roundOn} onChange={(e) => setRoundOn(e.target.checked)} /> Round Off
                    </label>
                  </td>
                  <td className={`px-2 py-0.5 ${num} ${roundOff < 0 ? 'text-red-600' : roundOff > 0 ? 'text-ink-700' : 'text-ink-400'}`}>{roundOff > 0 ? '+ ' : roundOff < 0 ? '− ' : ''}{money(Math.abs(roundOff))}</td>
                  <td />
                </tr>
                <tr className="border-t border-brand-100 bg-brand-50/70 font-semibold text-ink-800">
                  <td className="px-2 py-1 text-right text-[12px] uppercase tracking-wide text-ink-500" colSpan={12}>Net Amount</td>
                  <td className={`px-2 py-1 ${num} text-[15px] font-bold text-brand-800`}>{money(netAmount)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-2 grid shrink-0 grid-cols-3 gap-2 sm:mt-3 sm:flex sm:items-center sm:justify-end">
            <p className="mr-auto hidden text-[12px] text-ink-400 md:block">
              <kbd className="rounded border border-ink-200 bg-ink-50 px-1">Enter</kbd> moves Item → Batch → Sell by → Quantity → Disc% → next item. ↑ ↓ change the Batch / Sell by; ← → reach Sale Price.
            </p>
            <button type="button" className="btn-secondary max-sm:gap-1 max-sm:px-1" onClick={() => (editingId ? navigate('/pharmacy/sales-billing-list') : resetForm())}>
              <X size={16} /> Cancel
            </button>
            <button type="button" className="btn-secondary max-sm:gap-1 max-sm:px-1" disabled={saving || hasProblem} title="Save the bill and print it" onClick={(e) => save(e, true)}>
              <Printer size={16} className="max-sm:hidden" /> <span className="sm:hidden">Save+Print</span><span className="hidden sm:inline">{editingId ? 'Update & Print' : 'Save & Print'}</span>
            </button>
            <button type="submit" className="btn-primary max-sm:gap-1 max-sm:px-1" disabled={saving || hasProblem}>
              <Save size={16} /> {saving ? 'Saving...' : editingId ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>

      <PhoneFooter footerRef={footerRef}>
        <button type="button" className="btn-secondary whitespace-nowrap px-2" onClick={() => navigate('/pharmacy/sales-billing-list')}>
          <List size={16} /> View List
        </button>
      </PhoneFooter>

      <SalesBillReceipt clinic={clinic} bill={printBill} />

      <Toast toast={toast} />
    </div>
  );
}
