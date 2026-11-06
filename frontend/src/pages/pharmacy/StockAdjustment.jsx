import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SlidersHorizontal, Save, X, List, Trash2, Pencil, Plus, Check } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { useToast } from '../../hooks/useToast.js';
import { pharmacyItemApi, stockAdjustmentApi } from '../../api/client.js';
import { round2 } from '../../utils/purchaseCalc.js';
import { CardField, CardValue, cardBox, cardBad } from '../../components/MobileCard.jsx';
import { usePhoneFit, PhoneFooter, PhoneTabs } from '../../components/PhoneLayout.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => (Number(n) || 0).toFixed(2);
const numStr = (v) => (v == null || v === '' || Number(v) === 0 ? '' : String(Number(v)));
let nextKey = 1;
const blankRow = () => ({ key: nextKey++, itemId: '', batch: '', batches: [], purchaseRate: null, itemMrp: null, mrp: '', inQty: '', inPrice: '', outQty: '', outPrice: '' });

// Pharmacy > Stock In > Adjustment: corrects stock batch by batch. Adjust In
// adds to the batch (a new batch number starts a new batch); Adjust Out takes
// from it, at most its Cur Stock. Each side has its own price per pack,
// suggested from the batch's Stock In rate (else the item's purchase price);
// MRP per pack comes from the batch (else the item) and can be changed.
export default function StockAdjustment() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [catalog, setCatalog] = useState([]);
  const [adjDate, setAdjDate] = useState(today());
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState([blankRow()]);
  const [editing, setEditing] = useState(null); // { id, no }
  const [saving, setSaving] = useState(false);

  useEffect(() => { pharmacyItemApi.list().then(setCatalog).catch(() => show('Failed to load items', 'error')); }, [show]);
  const itemOptions = useMemo(() => catalog.map((i) => ({ value: String(i.ItemId), label: i.Name })), [catalog]);

  const setRow = (key, patch) => setRows((rs) => {
    const next = rs.map((r) => (r.key === key ? { ...r, ...patch } : r));
    // Always keep one empty row at the end to type into.
    return next[next.length - 1].itemId ? [...next, blankRow()] : next;
  });
  const removeRow = (key) => setRows((rs) => {
    const next = rs.filter((r) => r.key !== key);
    return next.length && !next[next.length - 1].itemId ? next : [...next, blankRow()];
  });

  const curOf = (r) => r.batches.find((b) => b.Batch === r.batch)?.CurStock ?? 0;
  const priceOf = (r, batch) => r.batches.find((b) => b.Batch === batch)?.PurchaseRate ?? r.purchaseRate ?? '';
  const mrpOf = (r, batch) => r.batches.find((b) => b.Batch === batch)?.MRP ?? r.itemMrp ?? '';

  const pickItem = async (key, itemId) => {
    setRow(key, { itemId, batch: '', batches: [], purchaseRate: null, itemMrp: null, mrp: '', inPrice: '', outPrice: '' });
    if (!itemId) return;
    try {
      const { purchaseRate, mrp, batches } = await stockAdjustmentApi.batches(itemId, editing?.id);
      // Start on the first batch that has stock (earliest expiry), if any.
      const first = batches.find((b) => b.CurStock > 0) || batches[0];
      const batch = first?.Batch ?? '';
      const price = numStr(first?.PurchaseRate ?? purchaseRate);
      setRow(key, { batches, purchaseRate, itemMrp: mrp, batch, mrp: numStr(first?.MRP ?? mrp), inPrice: price, outPrice: price });
    } catch { show('Failed to load batches', 'error'); }
  };
  const pickBatch = (r, batch) => {
    const price = numStr(priceOf(r, batch));
    const mrp = numStr(mrpOf(r, batch));
    setRow(r.key, { batch, mrp: mrp || r.mrp, inPrice: price || r.inPrice, outPrice: price || r.outPrice });
  };

  useEffect(() => {
    const id = location.state?.editAdjustmentId;
    if (!id) return;
    navigate(location.pathname, { replace: true, state: null });
    stockAdjustmentApi.get(id).then(async (a) => {
      setEditing({ id: a.AdjustmentId, no: a.AdjNo });
      setAdjDate(String(a.AdjDate).slice(0, 10));
      setRemarks(a.Remarks || '');
      const loaded = await Promise.all(a.lines.map(async (l) => {
        const { purchaseRate, mrp, batches } = await stockAdjustmentApi.batches(l.ItemId, a.AdjustmentId);
        return {
          key: nextKey++, itemId: String(l.ItemId), batch: l.BatchNo, batches, purchaseRate, itemMrp: mrp, mrp: numStr(l.MRP),
          inQty: numStr(l.InQty), inPrice: numStr(l.InPrice), outQty: numStr(l.OutQty), outPrice: numStr(l.OutPrice),
        };
      }));
      setRows([...loaded, blankRow()]);
      setCurKey(null); setCurEditing(false); setAdjTab('list');
    }).catch(() => show('Failed to load the adjustment', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const filled = rows.filter((r) => r.itemId);
  // Adjust Out per batch across rows, to check against its Cur Stock.
  const outBy = new Map();
  for (const r of filled) {
    const k = `${r.itemId}|${r.batch}`;
    outBy.set(k, (outBy.get(k) || 0) + (Number(r.outQty) || 0));
  }
  const problemOf = (r) => {
    if (!r.itemId) return null;
    const i = Number(r.inQty || 0);
    const o = Number(r.outQty || 0);
    if (![i, o, r.inPrice, r.outPrice, r.mrp].every((v) => Number(v || 0) >= 0)) return "Can't be negative";
    if (i > 0 && o > 0) return 'Adjust In or Adjust Out, not both';
    if (i > 0 && r.mrp !== '' && Number(r.inPrice || 0) > Number(r.mrp)) return `Price can't be above MRP ${money(r.mrp)}`;
    if (o > 0 && outBy.get(`${r.itemId}|${r.batch}`) > curOf(r)) return `Only ${round2(curOf(r))} in stock`;
    return null;
  };
  const problems = rows.map(problemOf);
  const inTotal = round2(filled.reduce((t, r) => t + round2((Number(r.inQty) || 0) * (Number(r.inPrice) || 0)), 0));
  const outTotal = round2(filled.reduce((t, r) => t + round2((Number(r.outQty) || 0) * (Number(r.outPrice) || 0)), 0));

  // Phones: two tabs — New Item (a form for one row) and Adjust Items (the rows
  // added, with Edit / Delete). The form works on row `curKey`: the empty last
  // row for a new item, or a listed row while it's being edited.
  const [adjTab, setAdjTab] = useState('new');
  const [curKey, setCurKey] = useState(null);
  const [curEditing, setCurEditing] = useState(false);
  const formRef = useRef(null);
  const cur = rows.find((r) => r.key === curKey) || rows[rows.length - 1];
  const curIndex = rows.indexOf(cur);
  // The item still being entered (not yet "Add to list") isn't shown in the list.
  const listed = filled.filter((r) => curEditing || r.key !== cur.key);
  const addCur = () => {
    if (!cur.itemId) return show('Pick an item first', 'error');
    if (problems[curIndex]) return show(problems[curIndex], 'error');
    if (!(Number(cur.inQty) > 0 || Number(cur.outQty) > 0)) return show('Enter Adjust In or Adjust Out', 'error');
    show(curEditing ? 'Item updated' : `Item added — ${listed.length + 1} in the list`, 'success');
    if (curEditing) setAdjTab('list');
    setCurEditing(false);
    setCurKey(null); // back to the empty last row
    if (!curEditing) setTimeout(() => formRef.current?.querySelector('input')?.focus(), 50);
  };
  const editRow = (r) => { setCurKey(r.key); setCurEditing(true); setAdjTab('new'); };
  const clearCur = () => {
    if (curEditing) { setCurEditing(false); setCurKey(null); return; }
    if (cur.itemId) removeRow(cur.key);
    setCurKey(null);
  };
  const deleteRow = (r) => {
    if (!confirm(`Remove ${itemOptions.find((o) => o.value === r.itemId)?.label || 'this item'} from the adjustment?`)) return;
    removeRow(r.key);
    if (r.key === cur.key) { setCurEditing(false); setCurKey(null); }
  };
  const { pageRef, areaRef, footerRef, fit } = usePhoneFit([adjTab, editing, curEditing]);

  const reset = () => { setEditing(null); setAdjDate(today()); setRemarks(''); setRows([blankRow()]); setCurKey(null); setCurEditing(false); setAdjTab('new'); };

  const save = async (e) => {
    e.preventDefault();
    if (!adjDate) return show('Date is required', 'error');
    if (!filled.length) return show('Add at least one item', 'error');
    if (problems.some(Boolean)) return show('Fix the rows marked in red first', 'error');
    const empty = rows.findIndex((r) => r.itemId && !(Number(r.inQty) > 0 || Number(r.outQty) > 0));
    if (empty >= 0) return show(`Row ${empty + 1}: enter Adjust In or Adjust Out`, 'error');
    setSaving(true);
    try {
      const body = {
        adjDate, remarks,
        lines: filled.map((r) => ({ itemId: Number(r.itemId), batch: r.batch, mrp: r.mrp, inQty: r.inQty, inPrice: r.inPrice, outQty: r.outQty, outPrice: r.outPrice })),
      };
      if (editing) {
        await stockAdjustmentApi.update(editing.id, body);
        navigate('/pharmacy/stock-adjustment-list', { state: { flash: `${editing.no} updated` } });
      } else {
        const r = await stockAdjustmentApi.create(body);
        show(`Saved ${r.AdjNo} — stock adjusted`, 'success');
        reset();
      }
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cell = 'border border-ink-200 px-1 py-0.5';
  const box = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] focus:border-brand-400 focus:bg-white focus:outline-none';
  const num = `${box} no-spin text-right`;

  return (
    <div ref={pageRef} className={fit.page} style={fit.pageStyle}>
      <div className={`card max-md:!px-3 ${fit.card}`}>
        <form onSubmit={save} className={fit.form}>
          <CardHeader
            icon={SlidersHorizontal}
            title={editing ? `Edit Adjustment · ${editing.no}` : 'Stock Adjustment'}
            subtitle={<span className="hidden md:inline">Correct a batch's stock — Adjust In adds, Adjust Out takes away</span>}
            actions={<button type="button" className="btn-secondary hidden md:inline-flex" onClick={() => navigate('/pharmacy/stock-adjustment-list')}><List size={16} /> View List</button>}
          />

          <div className="grid grid-cols-[7rem_1fr] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <div className="min-w-0">
              <label className="label">Date *</label>
              <input type="date" className="input max-md:!px-1.5" value={adjDate} max={today()} onChange={(e) => setAdjDate(e.target.value)} />
            </div>
            <div className="min-w-0 sm:w-96">
              <label className="label">Remarks</label>
              <input className="input" maxLength={300} placeholder="e.g. Physical count, damaged strips" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>

          {/* Phones: New Item / Adjust Items tabs, then the totals. */}
          <div className={`mt-3 flex flex-col gap-2.5 md:hidden ${fit.section}`}>
            <PhoneTabs tab={adjTab} onTab={setAdjTab} editing={curEditing} count={listed.length} listLabel="Adjust Items" />
            {/* The only part that scrolls on a phone. */}
            <div ref={areaRef} className={`space-y-2.5 ${fit.area}`}>
              {adjTab === 'new' && (() => {
                const r = cur;
                const p = problems[curIndex];
                const isNew = r.itemId && r.batches.length > 0 && !r.batches.some((b) => b.Batch === r.batch);
                const listId = `adj-batches-m-${r.key}`;
                const inOn = Number(r.outQty) > 0;
                const outOn = Number(r.inQty) > 0;
                return (
                  <div ref={formRef} className={`overflow-hidden rounded-xl border bg-white shadow-sm ${curEditing ? 'border-amber-300' : 'border-brand-200'}`}>
                    <div className={`flex items-center gap-2 border-b px-2.5 py-2 ${curEditing ? 'border-amber-100 bg-amber-50' : 'border-ink-100 bg-brand-50/60'}`}>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white ${curEditing ? 'bg-amber-500' : 'bg-brand-600'}`}>
                        {curEditing ? `Edit #${listed.indexOf(r) + 1}` : 'New item'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <SearchPick className="input" placeholder="Search item..." options={itemOptions} value={r.itemId} onChange={(v) => { setCurKey(r.key); pickItem(r.key, v); }} />
                      </div>
                      {r.itemId && <button type="button" className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" title={curEditing ? 'Cancel edit' : 'Clear'} onClick={clearCur}><X size={16} /></button>}
                    </div>
                    {r.itemId ? (
                      <div className="space-y-1.5 p-2">
                        <div className="grid gap-1.5" style={{ gridTemplateColumns: '1.6fr 1fr 1fr' }}>
                          <CardField label="Batch" note={isNew && r.batch ? 'New batch' : ''}>
                            <input className={`${cardBox} !text-left`} list={listId} placeholder="Batch no" value={r.batch} onChange={(e) => pickBatch(r, e.target.value)} />
                            <datalist id={listId}>
                              {r.batches.filter((b) => b.Batch).map((b) => <option key={b.Batch} value={b.Batch}>{`Stock ${round2(b.CurStock)}`}</option>)}
                            </datalist>
                          </CardField>
                          <CardField label="Cur Stock"><CardValue className="font-semibold">{round2(curOf(r))}</CardValue></CardField>
                          <CardField label="MRP">
                            <input type="number" inputMode="decimal" min="0" step="any" className={`${cardBox} no-spin`} value={r.mrp} onChange={(e) => setRow(r.key, { mrp: e.target.value })} />
                          </CardField>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          <CardField label="Adjust In">
                            <input type="number" inputMode="decimal" min="0" step="any" disabled={inOn} className={`${cardBox} no-spin !border-emerald-200 font-semibold text-emerald-800`} value={r.inQty} onChange={(e) => setRow(r.key, { inQty: e.target.value })} />
                          </CardField>
                          <CardField label="In Price">
                            <input type="number" inputMode="decimal" min="0" step="any" disabled={inOn} className={`${cardBox} no-spin !border-emerald-200`} value={r.inPrice} onChange={(e) => setRow(r.key, { inPrice: e.target.value })} />
                          </CardField>
                          <CardField label="Adjust Out">
                            <input type="number" inputMode="decimal" min="0" step="any" disabled={outOn} className={`${cardBox} no-spin !border-red-200 font-semibold text-red-700 ${p && Number(r.outQty) > 0 ? cardBad : ''}`} value={r.outQty} onChange={(e) => setRow(r.key, { outQty: e.target.value })} />
                          </CardField>
                          <CardField label="Out Price">
                            <input type="number" inputMode="decimal" min="0" step="any" disabled={outOn} className={`${cardBox} no-spin !border-red-200`} value={r.outPrice} onChange={(e) => setRow(r.key, { outPrice: e.target.value })} />
                          </CardField>
                        </div>
                        {p && <p className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600">{p}</p>}
                        <div className="flex gap-2">
                          {curEditing && <button type="button" className="btn-secondary flex-1" onClick={clearCur}><X size={16} /> Cancel</button>}
                          <button type="button" className="btn-primary flex-[2]" onClick={addCur}>
                            {curEditing ? <><Check size={16} /> Done</> : <><Plus size={16} /> Add to list</>}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="px-3 py-2.5 text-[12px] text-ink-400">Search and pick an item, enter Adjust In or Adjust Out, then tap <span className="font-semibold text-brand-700">Add to list</span>.</p>
                    )}
                  </div>
                );
              })()}

              {adjTab === 'list' && (
                <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
                  {listed.length === 0 && (
                    <p className="px-3 py-5 text-center text-[12px] text-ink-400">
                      No items yet — add them on the <button type="button" className="font-semibold text-brand-700" onClick={() => setAdjTab('new')}>New Item</button> tab.
                    </p>
                  )}
                  {listed.map((r, i) => {
                    const p = problems[rows.indexOf(r)];
                    const inQ = Number(r.inQty) || 0;
                    const outQ = Number(r.outQty) || 0;
                    return (
                      <div key={r.key} className={`flex items-start gap-2 border-t border-ink-100 px-3 py-2 first:border-t-0 ${curEditing && r.key === cur.key ? 'bg-amber-50' : p ? 'bg-red-50' : ''}`}>
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-[10px] font-bold text-ink-600">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-[13px] font-medium leading-snug text-ink-800">{itemOptions.find((o) => o.value === r.itemId)?.label || 'Item'}</p>
                          <p className="text-[11px] leading-snug text-ink-500">Batch {r.batch || '-'} · Stock {round2(curOf(r))}</p>
                          {p && <p className="text-[11px] text-red-600">{p}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end">
                          {inQ > 0 && <span className="text-[13px] font-bold tabular-nums text-emerald-700">+{inQ} @ ₹{money(r.inPrice)}</span>}
                          {outQ > 0 && <span className="text-[13px] font-bold tabular-nums text-red-600">−{outQ} @ ₹{money(r.outPrice)}</span>}
                          {!inQ && !outQ && <span className="text-[12px] text-ink-400">No qty</span>}
                          <div className="mt-0.5 flex gap-1">
                            <button type="button" className="rounded-lg border border-brand-100 p-1 text-brand-600 hover:bg-brand-50" title="Edit" onClick={() => editRow(r)}><Pencil size={14} /></button>
                            <button type="button" className="rounded-lg border border-red-100 p-1 text-red-500 hover:bg-red-50" title="Delete" onClick={() => deleteRow(r)}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-xl border border-ink-200 text-[13px] shadow-sm">
              <div className="flex items-center justify-between bg-emerald-50 px-3 py-1.5"><span className="text-emerald-700">In</span><b className="tabular-nums text-emerald-800">₹{money(inTotal)}</b></div>
              <div className="flex items-center justify-between border-l border-ink-200 bg-red-50 px-3 py-1.5"><span className="text-red-700">Out</span><b className="tabular-nums text-red-700">₹{money(outTotal)}</b></div>
            </div>
          </div>

          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] border-collapse text-left text-[13px]" {...gridKeys}>
              <thead>
                <tr className="bg-brand-50 font-bold text-brand-700">
                  <th className={`${cell} w-8 px-1.5 text-center`}>#</th>
                  <th className={`${cell} min-w-[220px] px-1.5`}>Item Name</th>
                  <th className={`${cell} w-36 px-1.5`}>Batch</th>
                  <th className={`${cell} w-20 px-1.5 text-right`}>Cur Stock</th>
                  <th className={`${cell} w-24 px-1.5 text-right`}>MRP</th>
                  <th className={`${cell} w-24 bg-emerald-50 px-1.5 text-right text-emerald-700`}>Adjust In</th>
                  <th className={`${cell} w-24 bg-emerald-50 px-1.5 text-right text-emerald-700`}>Price</th>
                  <th className={`${cell} w-24 bg-red-50 px-1.5 text-right text-red-700`}>Adjust Out</th>
                  <th className={`${cell} w-24 bg-red-50 px-1.5 text-right text-red-700`}>Price</th>
                  <th className={`${cell} w-8`} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = problems[i];
                  const isNew = r.itemId && r.batches.length > 0 && !r.batches.some((b) => b.Batch === r.batch);
                  const listId = `adj-batches-${r.key}`;
                  return (
                    <tr key={r.key} title={p || ''}>
                      <td className={`${cell} px-1.5 text-center text-ink-400`}>{i + 1}</td>
                      <td className={cell}>
                        <SearchPick className={box} placeholder="Search item..." options={itemOptions} value={r.itemId} data-r={i} data-c={0} onChange={(v) => pickItem(r.key, v)} />
                        {p && <p className="px-1 text-[11px] text-red-600">{p}</p>}
                      </td>
                      <td className={cell}>
                        <input
                          className={box} list={listId} data-r={i} data-c={1} disabled={!r.itemId} placeholder={r.itemId ? 'Batch no' : ''}
                          value={r.batch} onChange={(e) => pickBatch(r, e.target.value)}
                        />
                        <datalist id={listId}>
                          {r.batches.filter((b) => b.Batch).map((b) => <option key={b.Batch} value={b.Batch}>{`Stock ${round2(b.CurStock)}`}</option>)}
                        </datalist>
                        {isNew && r.batch && <p className="px-1 text-[11px] text-emerald-700">New batch</p>}
                      </td>
                      <td className={`${cell} px-1.5 text-right font-medium text-ink-700`}>{r.itemId ? round2(curOf(r)) : ''}</td>
                      <td className={cell}>
                        <input type="number" min="0" step="any" className={num} data-r={i} data-c={2} disabled={!r.itemId} value={r.mrp} onChange={(e) => setRow(r.key, { mrp: e.target.value })} />
                      </td>
                      <td className={`${cell} bg-emerald-50/40`}>
                        <input type="number" min="0" step="any" className={num} data-r={i} data-c={3} disabled={!r.itemId || Number(r.outQty) > 0} value={r.inQty} onChange={(e) => setRow(r.key, { inQty: e.target.value })} />
                      </td>
                      <td className={`${cell} bg-emerald-50/40`}>
                        <input type="number" min="0" step="any" className={num} data-r={i} data-c={4} disabled={!r.itemId || Number(r.outQty) > 0} value={r.inPrice} onChange={(e) => setRow(r.key, { inPrice: e.target.value })} />
                      </td>
                      <td className={`${cell} bg-red-50/40`}>
                        <input
                          type="number" min="0" step="any" data-r={i} data-c={5} disabled={!r.itemId || Number(r.inQty) > 0}
                          className={`${num} ${p && Number(r.outQty) > 0 ? 'border-red-400 bg-red-50 text-red-700' : ''}`}
                          value={r.outQty} onChange={(e) => setRow(r.key, { outQty: e.target.value })}
                        />
                      </td>
                      <td className={`${cell} bg-red-50/40`}>
                        <input type="number" min="0" step="any" className={num} data-r={i} data-c={6} disabled={!r.itemId || Number(r.inQty) > 0} value={r.outPrice} onChange={(e) => setRow(r.key, { outPrice: e.target.value })} />
                      </td>
                      <td className={`${cell} text-center`}>
                        {r.itemId && <button type="button" className="rounded p-0.5 text-red-500 hover:bg-red-50" title="Delete row" onClick={() => removeRow(r.key)}><Trash2 size={13} /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ink-50 font-semibold">
                  <td className={`${cell} px-2 text-right`} colSpan={5}>Total value</td>
                  <td className={`${cell} px-1.5 text-right text-emerald-700`} colSpan={2}>In ₹{money(inTotal)}</td>
                  <td className={`${cell} px-1.5 text-right text-red-700`} colSpan={2}>Out ₹{money(outTotal)}</td>
                  <td className={cell} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 grid shrink-0 grid-cols-2 gap-2 sm:flex sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => (editing ? navigate('/pharmacy/stock-adjustment-list') : reset())}><X size={16} /> Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : editing ? 'Update' : 'Save'}</button>
          </div>
        </form>
      </div>
      <PhoneFooter footerRef={footerRef}>
        <button type="button" className="btn-secondary whitespace-nowrap px-2" onClick={() => navigate('/pharmacy/stock-adjustment-list')}>
          <List size={16} /> View List
        </button>
      </PhoneFooter>
      <Toast toast={toast} />
    </div>
  );
}
