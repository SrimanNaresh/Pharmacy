import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SlidersHorizontal, Save, X, List, Trash2 } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { useToast } from '../../hooks/useToast.js';
import { pharmacyItemApi, stockAdjustmentApi } from '../../api/client.js';
import { round2 } from '../../utils/purchaseCalc.js';

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

  const reset = () => { setEditing(null); setAdjDate(today()); setRemarks(''); setRows([blankRow()]); };

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
    <div>
      <div className="card">
        <form onSubmit={save}>
          <CardHeader
            icon={SlidersHorizontal}
            title={editing ? `Edit Adjustment · ${editing.no}` : 'Stock Adjustment'}
            subtitle="Correct a batch's stock — Adjust In adds, Adjust Out takes away"
            actions={<button type="button" className="btn-secondary" onClick={() => navigate('/pharmacy/stock-adjustment-list')}><List size={16} /> View List</button>}
          />

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Date *</label>
              <input type="date" className="input" value={adjDate} max={today()} onChange={(e) => setAdjDate(e.target.value)} />
            </div>
            <div className="w-full sm:w-96">
              <label className="label">Remarks</label>
              <input className="input" maxLength={300} placeholder="e.g. Physical count, damaged strips" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
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

          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => (editing ? navigate('/pharmacy/stock-adjustment-list') : reset())}><X size={16} /> Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : editing ? 'Update' : 'Save'}</button>
          </div>
        </form>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
