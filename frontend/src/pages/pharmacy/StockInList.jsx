import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PackagePlus, Search, Plus, Pencil, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { stockInApi } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { round2 } from '../../utils/purchaseCalc.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');
const expLabel = (iso) => (iso ? `${MONTHS[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}` : '-');

// A line's amounts, each with its single-quantity amount. Qty counts the free
// units too; only the paid ones are bought:
//   Buy = Paid Qty x Cur.Rate; Sale = Qty x MRP;
//   Discount = Discount % of Sale; Net Sale = Qty x Sel.Amount.
function amounts(l) {
  const paid = Number(l.Quantity);
  const free = Number(l.FreeQty || 0);
  const qty = paid + free;
  const rate = Number(l.Rate);
  const saleUnit = Number(l.MRP);
  const discUnit = round2(saleUnit * (Number(l.DiscPercent) / 100));
  const sel = Number(l.SelAmount);
  return {
    qty,
    free,
    buy: [round2(paid * rate), rate],
    sale: [round2(qty * saleUnit), saleUnit],
    disc: [round2(qty * discUnit), discUnit],
    net: [round2(qty * sel), sel],
  };
}

const sum = (lines) => lines.reduce((t, l) => {
  const a = amounts(l);
  t.qty += a.qty; t.buy += a.buy[0]; t.sale += a.sale[0]; t.disc += a.disc[0]; t.net += a.net[0];
  return t;
}, { qty: 0, buy: 0, sale: 0, disc: 0, net: 0 });

// An amount with its single-quantity amount in small grey text under it.
const Amt = ({ pair }) => (
  <>
    <div>{money(pair[0])}</div>
    <div className="text-11 text-ink-400">₹{money(pair[1])} / 1</div>
  </>
);

const AMOUNT_HEADS = ['Buy Amount', 'Sale Amount', 'Discount Amount', 'Net Sale Amount'];

// Pharmacy > Stock In > List: every Stock In line, item wise (each item's
// batches) or date wise (each day's Stock Ins), with the totals of all lines
// the search matches. Only an Admin sees Edit and Delete, which open or remove
// a whole Stock In (the server checks the role; a Stock In whose batches a Sale
// or Return used opens read-only and can't be deleted).
export default function StockInList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast, show } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('item');
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    if (location.state?.flash) {
      show(location.state.flash, 'success');
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate, show]);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    try { setLines(await stockInApi.list(q)); } catch { show('Failed to load Stock Ins', 'error'); } finally { setLoading(false); }
  }, [show]);
  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const total = useMemo(() => sum(lines), [lines]);
  const byItem = useMemo(() => {
    const m = new Map();
    for (const l of lines) { if (!m.has(l.ItemId)) m.set(l.ItemId, { name: l.ItemName, lines: [] }); m.get(l.ItemId).lines.push(l); }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [lines]);
  const byDate = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      const d = String(l.InDate).slice(0, 10);
      if (!m.has(d)) m.set(d, new Map());
      const ins = m.get(d);
      if (!ins.has(l.StockInId)) ins.set(l.StockInId, []);
      ins.get(l.StockInId).push(l);
    }
    return [...m.entries()];
  }, [lines]);

  const remove = async (stockInId) => {
    const ls = lines.filter((l) => l.StockInId === stockInId);
    const first = ls[0];
    const items = [...new Set(ls.map((l) => l.ItemName))].join(', ');
    if (!confirm(`Delete Stock In ${first.StockInNo} (${first.VendorName})?\n\nAll ${ls.length} batch line(s) go, and their stock is taken off: ${items}.`)) return;
    try {
      await stockInApi.remove(stockInId);
      show(`${first.StockInNo} deleted`, 'success');
      load(search);
    } catch (err) {
      show(err.response?.data?.error || 'Delete failed', 'error');
    }
  };
  const editButton = (stockInId, no) => (
    <button type="button" className="btn-ghost px-2 py-1 text-brand-600 hover:bg-brand-50" title={`Edit ${no} (Admin only)`} onClick={() => navigate('/pharmacy/stock-in', { state: { editStockInId: stockInId } })}><Pencil size={15} /></button>
  );
  const binButton = (stockInId, no) => (
    <button type="button" className="btn-ghost px-2 py-1 text-red-500 hover:bg-red-50" title={`Delete ${no} (Admin only)`} onClick={() => remove(stockInId)}><Trash2 size={15} /></button>
  );

  const toggle = (key) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const cell = 'border-b border-r border-ink-200 px-2 py-1';
  const r = 'text-right';
  const totalsCells = (t) => (
    <>
      <td className={`${cell} ${r}`}>{t.qty}</td>
      <td className={`${cell} ${r}`}>{money(t.buy)}</td>
      <td className={`${cell} ${r}`}>{money(t.sale)}</td>
      <td className={`${cell} ${r}`}>{money(t.disc)}</td>
      <td className={`${cell} ${r}`}>{money(t.net)}</td>
    </>
  );
  const amountCells = (l) => {
    const a = amounts(l);
    return (
      <>
        <td className={`${cell} ${r}`}>
          {a.qty}
          {a.free > 0 && <div className="text-11 text-ink-400">incl. {a.free} free</div>}
        </td>
        {[a.buy, a.sale, a.disc, a.net].map((p, i) => <td key={i} className={`${cell} ${r}`}><Amt pair={p} /></td>)}
      </>
    );
  };

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={PackagePlus}
          title="Stock In List"
          subtitle={`${new Set(lines.map((l) => l.StockInId)).size} Stock In(s) · ${lines.length} batch line(s)`}
          actions={
            <>
              <div className="flex rounded-lg border border-ink-200 p-0.5 text-sm">
                {[['item', 'Item wise'], ['date', 'Date wise']].map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-md px-3 py-0.5 ${tab === k ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-50'}`}>{label}</button>
                ))}
              </div>
              <div className="relative w-full sm:w-64">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Item, batch, Stock In No, vendor..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={() => navigate('/pharmacy/stock-in')}><Plus size={16} /> New Stock In</button>
            </>
          }
        />

        {loading ? <Spinner /> : lines.length === 0 ? <EmptyState message="No Stock Ins found." /> : (
          <>
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[['Quantity', total.qty, false], ['Buy Amount', total.buy, true], ['Sale Amount', total.sale, true], ['Discount Amount', total.disc, true], ['Net Sale Amount', total.net, true]].map(([label, v, isMoney]) => (
                <div key={label} className="rounded-lg border border-ink-100 bg-ink-50/60 px-3 py-1.5">
                  <p className="text-11 text-ink-400">{label}</p>
                  <p className="text-sm font-semibold text-ink-800">{isMoney ? `₹${money(v)}` : v}</p>
                </div>
              ))}
            </div>

            {/* The first column (item / Stock In No) stays on the left while the others scroll sideways. */}
            <div className="overflow-x-auto rounded-lg">
              <table className="list-pinned w-full min-w-[960px] border-l border-t border-ink-200 text-left text-13">
                <thead>
                  {tab === 'item' ? (
                    <tr className="bg-brand-50 font-bold text-brand-700">
                      <th className={`${cell} pin w-[150px] min-w-[150px] sm:w-auto`}>Item / Batch No</th><th className={cell}>Exp</th><th className={cell}>Stock In No</th><th className={cell}>Vendor</th>
                      <th className={`${cell} ${r}`}>Quantity</th>{AMOUNT_HEADS.map((h) => <th key={h} className={`${cell} ${r}`}>{h}</th>)}
                      {isAdmin && <th className={`${cell} w-24 text-center`}>Edit / Delete</th>}
                    </tr>
                  ) : (
                    <tr className="bg-brand-50 font-bold text-brand-700">
                      <th className={`${cell} pin w-[150px] min-w-[150px] sm:w-auto`}>Stock In No · Vendor</th><th className={cell}>Item</th><th className={cell}>Batch No</th><th className={cell}>Exp</th>
                      <th className={`${cell} ${r}`}>Quantity</th>{AMOUNT_HEADS.map((h) => <th key={h} className={`${cell} ${r}`}>{h}</th>)}
                      {isAdmin && <th className={`${cell} w-24 text-center`}>Edit / Delete</th>}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {tab === 'item' && byItem.map(([itemId, g]) => {
                    const isOpen = open.has(`i${itemId}`);
                    const t = sum(g.lines);
                    return (
                      <Fragment key={itemId}>
                        <tr className="cursor-pointer bg-ink-50/70 font-semibold hover:bg-ink-100/70" onClick={() => toggle(`i${itemId}`)}>
                          <td className={`${cell} pin !bg-ink-50`}>
                            {isOpen ? <ChevronDown size={14} className="mr-1 inline" /> : <ChevronRight size={14} className="mr-1 inline" />}
                            {g.name} <span className="font-normal text-ink-400">· {g.lines.length} batch(es)</span>
                          </td>
                          <td className={cell} colSpan={3} />
                          {totalsCells(t)}
                          {isAdmin && <td className={cell} />}
                        </tr>
                        {isOpen && g.lines.map((l) => (
                          <tr key={l.LineId}>
                            <td className={`${cell} pin pl-7`}>{l.BatchNo}</td>
                            <td className={cell}>{expLabel(l.ExpDate)}</td>
                            <td className={`${cell} text-brand-700`} title={dateLabel(l.InDate)}>{l.StockInNo}</td>
                            <td className={cell}>{l.VendorName}</td>
                            {amountCells(l)}
                            {isAdmin && (
                              <td className={`${cell} text-center`}>
                                <div className="flex justify-center gap-1">{editButton(l.StockInId, l.StockInNo)}{binButton(l.StockInId, l.StockInNo)}</div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}

                  {tab === 'date' && byDate.map(([date, ins]) => {
                    const all = [...ins.values()].flat();
                    const t = sum(all);
                    return (
                      <Fragment key={date}>
                        <tr className="bg-ink-50/70 font-semibold">
                          <td className={`${cell} pin !bg-ink-50`}>{dateLabel(date)} <span className="font-normal text-ink-400">· {ins.size} Stock In(s) · {all.length} batch(es)</span></td>
                          <td className={cell} colSpan={3} />
                          {totalsCells(t)}
                          {isAdmin && <td className={cell} />}
                        </tr>
                        {[...ins.entries()].map(([sid, ls]) => ls.map((l, k) => (
                          <tr key={l.LineId} className={k === 0 ? '[&>td]:border-t-2 [&>td]:border-t-ink-300' : ''}>
                            {k === 0 && (
                              <td className={`${cell} pin align-middle`} rowSpan={ls.length}>
                                <div className="font-semibold text-brand-700">{l.StockInNo}</div>
                                <div className="text-11 text-ink-500">{l.VendorName} · {l.OrderNo}</div>
                              </td>
                            )}
                            <td className={cell}>{l.ItemName}</td>
                            <td className={cell}>{l.BatchNo}</td>
                            <td className={cell}>{expLabel(l.ExpDate)}</td>
                            {amountCells(l)}
                            {k === 0 && isAdmin && (
                              <td className={`${cell} text-center align-middle`} rowSpan={ls.length}>
                                <div className="flex justify-center gap-1">{editButton(sid, l.StockInNo)}{binButton(sid, l.StockInNo)}</div>
                              </td>
                            )}
                          </tr>
                        )))}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-ink-800 font-semibold text-white">
                    <td className={`${cell} pin !bg-ink-800`}>Total</td>
                    <td className={cell} colSpan={3} />
                    {totalsCells(total)}
                    {isAdmin && <td className={cell} />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
