import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RotateCcw, Save, X, List } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import { CardField, CardValue, ItemCard, cardBox, cardBad } from '../../components/MobileCard.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { useToast } from '../../hooks/useToast.js';
import { salesReturnApi } from '../../api/client.js';
import { saleLineAmount, saleBill } from '../../utils/purchaseCalc.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => (Number(n) || 0).toFixed(2);
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');
const monthLabel = (iso) => (iso ? `${MONTHS[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}` : '-');
const numStr = (v) => (v == null || v === '' ? '' : String(Number(v)));
const custKey = (name, mobile) => `${name}\u0001${mobile || ''}`;

// Pharmacy > Return > Sales Return: goods a customer brings back from one
// sale. Find the sale by its Sales Date or by the customer, then enter the
// Return Qty per line (at most what it sold less earlier returns). The refund
// keeps the sale's line and bill discounts; saving puts the stock back.
export default function SalesReturnMaster() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [findBy, setFindBy] = useState('date'); // 'date' | 'customer'
  const [saleDate, setSaleDate] = useState(today());
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState(''); // custKey
  const [sales, setSales] = useState([]);
  const [saleId, setSaleId] = useState('');
  const [sale, setSale] = useState(null); // head of the picked sale
  const [returnDate, setReturnDate] = useState(today());
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // { id, no }
  const [saving, setSaving] = useState(false);

  useEffect(() => { salesReturnApi.customers().then(setCustomers).catch(() => show('Failed to load customers', 'error')); }, [show]);
  const customerOptions = useMemo(
    () => customers.map((c) => ({
      value: custKey(c.CustomerName, c.MobileNo),
      label: c.MobileNo ? `${c.CustomerName} · ${c.MobileNo}` : c.CustomerName,
      hint: `${c.Sales} sale(s)`,
    })),
    [customers],
  );

  const loadSales = async (params) => {
    setSales([]);
    try { setSales(await salesReturnApi.sales(params)); } catch { show('Failed to load sales', 'error'); }
  };
  const loadLines = async (sid, ret) => {
    setRows([]);
    setSale(null);
    if (!sid) return;
    try {
      const s = await salesReturnApi.saleLines(sid, ret?.SalesReturnId);
      const saved = new Map((ret?.lines || []).map((l) => [l.SalesLineId, l]));
      setSale(s);
      setRows(s.lines.map((l) => ({ ...l, qty: numStr(saved.get(l.SalesLineId)?.UnitQty) })));
    } catch { show('Failed to load the sale', 'error'); }
  };

  const clearSale = () => { setSaleId(''); setSale(null); setRows([]); };
  const pickFindBy = (mode) => {
    setFindBy(mode);
    clearSale();
    setSales([]);
    if (mode === 'date') loadSales({ date: saleDate });
    else if (customer) pickCustomer(customer);
  };
  const pickSaleDate = (d) => { setSaleDate(d); clearSale(); if (d) loadSales({ date: d }); else setSales([]); };
  function pickCustomer(key) {
    setCustomer(key);
    clearSale();
    if (!key) return setSales([]);
    const [name, mobile] = key.split('\u0001');
    return loadSales({ customer: name, mobile });
  }
  const pickSale = (sid) => { setSaleId(sid); loadLines(sid); };

  // The first load lists today's sales.
  useEffect(() => { if (!location.state?.editSalesReturnId) loadSales({ date: today() }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = location.state?.editSalesReturnId;
    if (!id) return;
    navigate(location.pathname, { replace: true, state: null });
    salesReturnApi.get(id).then(async (r) => {
      setEditing({ id: r.SalesReturnId, no: r.ReturnNo });
      setFindBy('date');
      const d = String(r.SaleDate).slice(0, 10);
      setSaleDate(d);
      setReturnDate(String(r.ReturnDate).slice(0, 10));
      await loadSales({ date: d });
      setSaleId(String(r.SalesBillingId));
      await loadLines(r.SalesBillingId, r);
    }).catch(() => show('Failed to load the Sales Return', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const setQty = (i, qty) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, qty } : r)));
  const problemOf = (r) => {
    const q = Number(r.qty || 0);
    if (q === 0) return null;
    if (!(q > 0)) return 'Must be more than 0';
    if (q > r.Left) return `Only ${r.Left} can be returned`;
    return null;
  };
  const problems = rows.map(problemOf);
  const amountOf = (r) => saleLineAmount({ quantity: r.qty, rate: r.Rate, discPercent: r.DiscPercent });
  const returning = rows.filter((r) => Number(r.qty || 0) > 0);
  const bill = saleBill(returning.map(amountOf), sale?.DiscPercent || 0);

  const reset = () => {
    setEditing(null); clearSale(); setReturnDate(today());
    if (findBy === 'date') loadSales({ date: saleDate });
    else if (customer) pickCustomer(customer);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!saleId) return show('Sale No is required', 'error');
    if (!returnDate) return show('Return Date is required', 'error');
    if (sale && returnDate < String(sale.TransDate).slice(0, 10)) return show("Return Date can't be before the Sale Date", 'error');
    if (!returning.length) return show('Enter a Return Qty on at least one line', 'error');
    if (problems.some(Boolean)) return show('Fix the boxes marked in red first', 'error');
    setSaving(true);
    try {
      const body = { salesBillingId: Number(saleId), returnDate, lines: rows.map((r) => ({ salesLineId: r.SalesLineId, quantity: r.qty })) };
      if (editing) {
        await salesReturnApi.update(editing.id, body);
        navigate('/pharmacy/sales-return-list', { state: { flash: `${editing.no} updated` } });
      } else {
        const r = await salesReturnApi.create(body);
        show(`Saved ${r.ReturnNo} · refund ₹${money(r.TotalAmount)} — stock added back`, 'success');
        reset();
      }
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cell = 'border border-ink-200 px-1 py-0.5';
  const ro = 'px-1.5 text-right text-ink-600';
  const box = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] focus:border-brand-400 focus:bg-white focus:outline-none';
  const tab = (on) => `rounded-md px-3 py-1.5 text-sm font-medium ${on ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`;

  return (
    <div>
      <div className="card max-md:!px-3">
        <form onSubmit={save}>
          <CardHeader
            icon={RotateCcw}
            title={editing ? `Edit Sales Return · ${editing.no}` : 'Sales Return'}
            subtitle="Goods a customer brings back from one sale — adds the stock back"
            actions={<button type="button" className="btn-secondary" onClick={() => navigate('/pharmacy/sales-return-list')}><List size={16} /> View List</button>}
          />

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Find sale by</label>
              <div className="inline-flex rounded-lg bg-ink-100 p-1">
                <button type="button" className={tab(findBy === 'date')} disabled={!!editing} onClick={() => pickFindBy('date')}>Sales Date</button>
                <button type="button" className={tab(findBy === 'customer')} disabled={!!editing} onClick={() => pickFindBy('customer')}>Customer</button>
              </div>
            </div>
            {findBy === 'date' ? (
              <div>
                <label className="label">Sales Date *</label>
                <input type="date" className="input" value={saleDate} max={today()} disabled={!!editing} onChange={(e) => pickSaleDate(e.target.value)} />
              </div>
            ) : (
              <div className="w-full sm:w-72">
                <label className="label">Customer *</label>
                <SearchPick className="input" placeholder="Search customer or mobile..." options={customerOptions} value={customer} onChange={pickCustomer} disabled={!!editing} />
              </div>
            )}
            <div className="w-full sm:w-96">
              <label className="label">Sale No *</label>
              <select className="input" value={saleId} disabled={!!editing} onChange={(e) => pickSale(e.target.value)}>
                <option value="">
                  {findBy === 'customer' && !customer ? 'Pick a customer first' : sales.length ? 'Pick a sale' : 'No sales found'}
                </option>
                {sales.map((s) => (
                  <option key={s.SalesBillingId} value={s.SalesBillingId}>
                    {`${s.SaleNo} · ${dateLabel(s.TransDate)} · ${s.CustomerName || '-'}${s.MobileNo ? ` · ${s.MobileNo}` : ''} · ₹${money(s.TotalAmount)}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Return Date *</label>
              <input type="date" className="input" value={returnDate} min={sale ? String(sale.TransDate).slice(0, 10) : undefined} onChange={(e) => setReturnDate(e.target.value)} />
            </div>
          </div>

          {sale && (
            <p className="mt-2 text-sm text-ink-500">
              Customer <span className="font-medium text-ink-700">{sale.CustomerName || '-'}</span>
              {sale.MobileNo && <> · {sale.MobileNo}</>} · Sale Date {dateLabel(sale.TransDate)}
              {Number(sale.DiscPercent) > 0 && <> · Bill Discount {Number(sale.DiscPercent)}%</>}
            </p>
          )}

          {/* Phones: one card per sale line — Batch · Exp.Date · Unit · Sale Price · Disc %,
              then Sold · Returned · Return Qty · Amount; the refund totals below. */}
          <div className="mt-3 space-y-2.5 md:hidden">
            {rows.length === 0 && (
              <p className="rounded-xl border border-dashed border-ink-200 px-3 py-5 text-center text-[12px] text-ink-400">{saleId ? 'Loading…' : 'Pick a sale to list its items.'}</p>
            )}
            {rows.map((r, i) => {
              const none = r.Left <= 0 && !Number(r.qty);
              const p = problems[i];
              const returningQty = Number(r.qty) > 0;
              return (
                <ItemCard
                  key={r.SalesLineId} no={i + 1} title={r.ItemName} sub={`Sold ${r.Sold} ${r.SaleUnit === 'unit' ? 'unit(s)' : 'pack(s)'} · ${r.Left} left to return`}
                  tag={none ? 'Nothing left' : returningQty ? `Returning ${Number(r.qty)}` : 'Not returned'}
                  tagClass={returningQty ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-100 text-ink-500'} bad={!!p} dim={none}
                >
                  <div className="grid gap-1.5" style={{ gridTemplateColumns: '1.5fr 0.95fr 0.8fr 1fr 0.75fr' }}>
                    <CardField label="Batch No"><CardValue>{r.Batch || '-'}</CardValue></CardField>
                    <CardField label="Exp.Date"><CardValue>{r.ExpiryDate ? `${String(r.ExpiryDate).slice(5, 7)}/${String(r.ExpiryDate).slice(2, 4)}` : '-'}</CardValue></CardField>
                    <CardField label="Unit"><CardValue>{r.SaleUnit === 'unit' ? 'Unit' : 'Pack'}</CardValue></CardField>
                    <CardField label="Sale Price"><CardValue>{money(r.Rate)}</CardValue></CardField>
                    <CardField label="Disc %"><CardValue>{r.DiscPercent ? Number(r.DiscPercent) : '0'}</CardValue></CardField>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    <CardField label="Sold"><CardValue>{r.Sold}</CardValue></CardField>
                    <CardField label="Returned" note="earlier"><CardValue>{r.Returned}</CardValue></CardField>
                    <CardField label="Return Qty" note={none ? '' : `max ${r.Left}`}>
                      <input
                        type="number" inputMode="decimal" min="0" max={r.Left} step="any" disabled={none}
                        className={`${cardBox} no-spin font-semibold ${p ? cardBad : ''}`} value={r.qty} placeholder={none ? '' : '0'}
                        onChange={(e) => setQty(i, e.target.value)}
                      />
                    </CardField>
                    <CardField label="Amount"><CardValue className="!bg-brand-50 font-bold text-brand-800">{returningQty ? money(amountOf(r)) : '0.00'}</CardValue></CardField>
                  </div>
                  {p && <p className="rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-600">{p}</p>}
                </ItemCard>
              );
            })}
            {rows.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-ink-200 bg-white text-sm shadow-sm">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-ink-600">Sub Total</span>
                  <span className="font-semibold tabular-nums text-ink-900">{money(bill.subTotal)}</span>
                </div>
                {Number(sale?.DiscPercent) > 0 && (
                  <div className="flex items-center justify-between border-t border-ink-100 px-3 py-2">
                    <span className="text-ink-600">Bill Discount {Number(sale.DiscPercent)}%</span>
                    <span className="tabular-nums text-red-600">-{money(bill.discountAmount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between bg-brand-600 px-3 py-2.5 text-white">
                  <span className="font-semibold">Refund Amount</span>
                  <span className="text-lg font-bold tabular-nums">₹{money(bill.total)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] border-collapse text-left text-[13px]" {...gridKeys}>
              <thead>
                <tr className="bg-brand-50 font-bold text-brand-700">
                  <th className={`${cell} min-w-[180px] px-1.5`}>Item Name</th>
                  <th className={`${cell} px-1.5`}>Batch No</th>
                  <th className={`${cell} px-1.5`}>Exp.Date</th>
                  <th className={`${cell} px-1.5`}>Unit</th>
                  <th className={`${cell} w-20 px-1.5 text-right`}>Sale Price</th>
                  <th className={`${cell} w-16 px-1.5 text-right`}>Disc %</th>
                  <th className={`${cell} w-16 px-1.5 text-right`}>Sold</th>
                  <th className={`${cell} w-20 px-1.5 text-right`}>Returned</th>
                  <th className={`${cell} w-24 px-1.5 text-right`}>Return Qty</th>
                  <th className={`${cell} w-24 px-1.5 text-right`}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td className={`${cell} px-3 py-4 text-center text-ink-400`} colSpan={10}>{saleId ? 'Loading…' : 'Pick a sale to list its items.'}</td></tr>
                )}
                {rows.map((r, i) => {
                  const none = r.Left <= 0 && !Number(r.qty);
                  const p = problems[i];
                  return (
                    <tr key={r.SalesLineId} className={none ? 'text-ink-400' : ''} title={none ? 'Nothing left to return on this line' : p || ''}>
                      <td className={`${cell} px-1.5 font-medium`}>{r.ItemName}{p && <p className="text-[11px] font-normal text-red-600">{p}</p>}</td>
                      <td className={`${cell} px-1.5`}>{r.Batch || '-'}</td>
                      <td className={`${cell} px-1.5`}>{monthLabel(r.ExpiryDate)}</td>
                      <td className={`${cell} px-1.5`}>{r.SaleUnit === 'unit' ? 'Unit' : 'Pack'}</td>
                      <td className={`${cell} ${ro}`}>{money(r.Rate)}</td>
                      <td className={`${cell} ${ro}`}>{r.DiscPercent ? Number(r.DiscPercent) : ''}</td>
                      <td className={`${cell} ${ro}`}>{r.Sold}</td>
                      <td className={`${cell} ${ro}`}>{r.Returned}</td>
                      <td className={cell}>
                        <input
                          type="number" min="0" max={r.Left} step="any" data-r={i} data-c={0} disabled={none}
                          className={`${box} no-spin text-right ${p ? 'border-red-400 bg-red-50 text-red-700' : ''}`}
                          value={r.qty} placeholder={none ? '' : `max ${r.Left}`} onChange={(e) => setQty(i, e.target.value)}
                        />
                      </td>
                      <td className={`${cell} ${ro} font-semibold text-ink-800`}>{Number(r.qty) > 0 ? money(amountOf(r)) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ink-50 font-semibold">
                  <td className={`${cell} px-2 text-right`} colSpan={9}>Sub Total</td>
                  <td className={`${cell} px-1.5 text-right`}>{money(bill.subTotal)}</td>
                </tr>
                {Number(sale?.DiscPercent) > 0 && (
                  <tr className="bg-ink-50">
                    <td className={`${cell} px-2 text-right`} colSpan={9}>Bill Discount {Number(sale.DiscPercent)}%</td>
                    <td className={`${cell} px-1.5 text-right`}>-{money(bill.discountAmount)}</td>
                  </tr>
                )}
                <tr className="bg-ink-50 font-bold text-ink-800">
                  <td className={`${cell} px-2 text-right`} colSpan={9}>Refund Amount</td>
                  <td className={`${cell} px-1.5 text-right`}>{money(bill.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => (editing ? navigate('/pharmacy/sales-return-list') : reset())}><X size={16} /> Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : editing ? 'Update' : 'Save'}</button>
          </div>
        </form>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
