import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IndianRupee, CalendarDays, LayoutGrid, PackagePlus, Wallet, Boxes, AlertTriangle, CalendarClock, Receipt, RefreshCw,
  ShoppingCart, SlidersHorizontal, ChevronRight, PackageX, TrendingUp, Clock,
} from 'lucide-react';
import { Spinner } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { clinicApi, dashboardApi } from '../api/client.js';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Big amounts compact (₹1.2L, ₹3.4Cr) so a tile's value always fits; the full figure is in its tooltip.
const moneyShort = (n) => {
  const v = Number(n || 0);
  return Math.abs(v) < 100000 ? money(v) : `₹${new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v)}`;
};
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const monthYear = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`;
};
const daysUntil = (iso) => Math.ceil((new Date(iso) - new Date()) / 86400000);
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

// A KPI tile: a coloured icon chip and accent line carry identity; the label,
// value and note stay in text colours.
function Stat({ icon: Icon, accent, chip, label, value, full, note, to, className = '' }) {
  return (
    <Link to={to} className={`group relative block overflow-hidden rounded-2xl border border-ink-100 bg-white p-3 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-elevated sm:p-4 ${className}`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${accent}`} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-12 font-medium leading-tight text-ink-500">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${chip}`}><Icon size={16} /></span>
      </div>
      <p className="mt-1 truncate text-lg font-bold tabular-nums tracking-tight text-ink-900 sm:text-xl" title={full}>{value}</p>
      <p className="mt-0.5 flex items-center gap-1 text-11 leading-tight text-ink-400">
        <span className="min-w-0 flex-1">{note}</span>
        <ChevronRight size={13} className="shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" />
      </p>
    </Link>
  );
}

// Last 7 days' sales: one series, so no legend (the title names it). Columns are
// capped at 24px with a 4px rounded top on a hairline grid; today is the accent
// step, the other days a lighter step of the same hue. Only today and the best
// day carry a value; every column shows its figures on hover.
function WeekChart({ week }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...week.map((d) => d.amount), 0);
  const top = max > 0 ? niceCeil(max) : 1000;
  const best = week.reduce((b, d, i) => (d.amount > (week[b]?.amount ?? -1) ? i : b), 0);
  const last = week.length - 1;
  const ticks = [top, top / 2, 0];
  return (
    <div className="flex gap-2">
      <div className="flex h-44 flex-col justify-between pb-6 text-right text-10 tabular-nums text-ink-400">
        {ticks.map((t) => <span key={t} className="-translate-y-1.5">{compactAxis(t)}</span>)}
      </div>
      <div className="relative h-44 flex-1">
        <div className="absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between">
          {ticks.map((t) => <div key={t} className="h-px bg-ink-100" />)}
        </div>
        <div className="absolute inset-x-0 bottom-0 top-0 flex items-stretch">
          {week.map((d, i) => {
            const h = d.amount > 0 ? Math.max((d.amount / top) * 100, 2) : 0;
            const isToday = i === last;
            const showValue = d.amount > 0 && (isToday || i === best);
            return (
              <div
                key={d.day} className="relative flex flex-1 flex-col items-center"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}
              >
                <div className="relative flex w-full flex-1 items-end justify-center pb-0">
                  <div className={`absolute inset-x-1 bottom-0 top-0 rounded-lg transition-colors ${hover === i ? 'bg-brand-50' : ''}`} />
                  <div className="relative flex w-full max-w-[24px] flex-col items-center justify-end" style={{ height: `${h}%` }}>
                    {showValue && (
                      <span className="absolute -top-4 whitespace-nowrap text-10 font-semibold tabular-nums text-ink-600">{compactAxis(d.amount)}</span>
                    )}
                    <div className={`h-full w-full rounded-t ${isToday ? 'bg-brand-600' : 'bg-brand-300'}`} />
                  </div>
                </div>
                <span className={`flex h-6 items-end text-11 ${isToday ? 'font-semibold text-ink-800' : 'text-ink-500'}`}>{isToday ? 'Today' : dayLabel(d.day)}</span>
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-8 z-10 w-max rounded-lg bg-ink-900 px-2.5 py-1.5 text-11 text-white shadow-lg">
                    <p className="font-semibold">{dateLabel(d.day)}</p>
                    <p className="tabular-nums">{money(d.amount)}</p>
                    <p className="text-white/70">{d.bills} bill(s)</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
// Round an axis top up to a clean number (1 / 2 / 5 × 10^n).
function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((n) => n >= v);
}
const compactAxis = (v) => (v >= 1000 ? new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : String(Math.round(v)));

// One colour per dashboard tab (full class names, so Tailwind keeps them).
const TAB_TONES = {
  overview: { on: 'border-brand-200 bg-brand-50 text-brand-700', chip: 'bg-brand-50 text-brand-600', chipOn: 'bg-brand-600 text-white', badge: 'bg-brand-600' },
  sales: { on: 'border-emerald-200 bg-emerald-50 text-emerald-700', chip: 'bg-emerald-50 text-emerald-600', chipOn: 'bg-emerald-600 text-white', badge: 'bg-emerald-600' },
  bills: { on: 'border-sky-200 bg-sky-50 text-sky-700', chip: 'bg-sky-50 text-sky-600', chipOn: 'bg-sky-600 text-white', badge: 'bg-sky-600' },
  low: { on: 'border-amber-200 bg-amber-50 text-amber-800', chip: 'bg-amber-50 text-amber-600', chipOn: 'bg-amber-500 text-white', badge: 'bg-amber-500' },
  expiry: { on: 'border-red-200 bg-red-50 text-red-700', chip: 'bg-red-50 text-red-600', chipOn: 'bg-red-600 text-white', badge: 'bg-red-600' },
};

// Status chips carry an icon and a word, never colour alone.
function Status({ tone, icon: Icon, children }) {
  const tones = { red: 'bg-red-50 text-red-700 ring-red-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200', sky: 'bg-sky-50 text-sky-700 ring-sky-200' };
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-11 font-semibold ring-1 ${tones[tone]}`}><Icon size={12} />{children}</span>;
}

function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-50 text-ink-400"><Icon size={20} /></span>
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      <p className="mt-0.5 text-12 text-ink-400">{text}</p>
      {action}
    </div>
  );
}

// Dashboard: a welcome banner with quick actions, then tabs: the key figures
// (Overview), the last 7 days' sales, the latest bills, items running low and
// batches expiring soon.
export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [pharmacy, setPharmacy] = useState('');

  const load = () => {
    setLoading(true);
    dashboardApi.get()
      .then((d) => { setData(d); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load the dashboard'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => { clinicApi.get().then((c) => setPharmacy(c?.Name || '')).catch(() => setPharmacy('')); }, []);

  const weekStats = useMemo(() => {
    if (!data) return null;
    const total = data.week.reduce((t, d) => t + d.amount, 0);
    const bills = data.week.reduce((t, d) => t + d.bills, 0);
    const best = data.week.reduce((b, d) => (d.amount > b.amount ? d : b), data.week[0] || { amount: 0 });
    return { total, bills, avg: total / (data.week.length || 1), best };
  }, [data]);

  if (!data) return loading ? <Spinner /> : <div className="card text-sm text-red-600">{error}</div>;

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const actions = [
    { to: '/pharmacy/sales-billing', icon: Receipt, label: 'New Sale', short: 'New Sale' },
    { to: '/pharmacy/purchase-order', icon: ShoppingCart, label: 'Purchase Order', short: 'Purchase' },
    { to: '/pharmacy/stock-in', icon: PackagePlus, label: 'Stock In', short: 'Stock In' },
    { to: '/pharmacy/stock-adjustment', icon: SlidersHorizontal, label: 'Adjustment', short: 'Adjust' },
  ];
  const tabs = [
    ['overview', LayoutGrid, 'Overview', null],
    ['sales', TrendingUp, 'Sales', null],
    ['bills', Receipt, 'Bills', data.recentSales.length],
    ['low', PackageX, 'Low Stock', data.lowStockCount],
    ['expiry', CalendarClock, 'Expiring', data.expiringCount],
  ];

  return (
    <div className="space-y-3 pb-2">
      {/* Welcome banner */}
      <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-4 text-white shadow-elevated sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-12 font-medium text-white/75">{today}</p>
            <h1 className="mt-0.5 font-display text-xl font-bold leading-tight sm:text-2xl">{greeting()}, {user?.username || 'there'}</h1>
            <p className="mt-0.5 text-13 text-white/80">{pharmacy ? `Here's how ${pharmacy} is doing today.` : "Here's how the pharmacy is doing today."}</p>
          </div>
          <button type="button" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh" className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur transition-colors hover:bg-white/25">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        {/* One row everywhere: on a phone each button is the icon over a short
            label; from tablets up the full label sits beside the icon. */}
        <div className="relative mt-3 grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
          {actions.map(({ to, icon: Icon, label, short }) => (
            <Link key={to} to={to} className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl bg-white px-1 py-1.5 text-11 font-semibold text-brand-700 shadow-sm transition-transform hover:-translate-y-0.5 sm:inline-flex sm:flex-row sm:gap-1.5 sm:px-3 sm:py-2 sm:text-13">
              <Icon size={16} className="shrink-0" />
              <span className="truncate sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div className="flex overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card">
        {/* The tabs run down the right side: each its own tile in its own colour
            (an icon chip that fills in when open), counts as a badge on the
            top-right. Phones: icon over a short label in a narrow rail; wider
            screens: icon beside the label. */}
        <div className="order-2 flex w-[4.25rem] shrink-0 flex-col gap-1.5 border-l border-ink-100 bg-ink-50/70 p-1.5 md:w-44 md:gap-2 md:p-2.5">
          {tabs.map(([key, Icon, label, count]) => {
            const on = tab === key;
            const t = TAB_TONES[key];
            return (
              <button
                key={key} type="button" onClick={() => setTab(key)} aria-pressed={on}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-0 pb-1.5 pt-2 text-10.5 font-semibold transition-all md:flex-row md:justify-start md:gap-2 md:py-1.5 md:pl-1.5 md:pr-2 md:text-13 ${on ? `${t.on} shadow-sm` : 'border-ink-100 bg-white text-ink-500 hover:-translate-x-0.5 hover:border-ink-200 hover:text-ink-700 hover:shadow-sm'}`}
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${on ? t.chipOn : t.chip}`}><Icon size={15} /></span>
                <span className="max-w-full truncate">{label}</span>
                {count != null && (
                  <span className={`absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full px-1 text-center text-10 font-bold leading-5 text-white ring-2 ring-white md:static md:ml-auto md:px-1.5 md:text-11 md:ring-0 ${count > 0 ? t.badge : 'bg-ink-300'}`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="order-1 min-w-0 flex-1 p-3 sm:p-4">
          {tab === 'overview' && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-6 xl:grid-cols-5">
              <Stat icon={IndianRupee} accent="bg-emerald-500" chip="bg-emerald-50 text-emerald-600" className="lg:col-span-2 xl:col-span-1" label="Today's sales" value={moneyShort(data.todaySales)} full={money(data.todaySales)} note={`${data.todayBills} bill(s), less returns`} to="/pharmacy/sales-billing-list" />
              <Stat icon={CalendarDays} accent="bg-sky-500" chip="bg-sky-50 text-sky-600" className="lg:col-span-2 xl:col-span-1" label="This month's sales" value={moneyShort(data.monthSales)} full={money(data.monthSales)} note={`${data.monthBills} bill(s), less returns`} to="/pharmacy/sales-billing-list" />
              <Stat icon={PackagePlus} accent="bg-violet-500" chip="bg-violet-50 text-violet-600" className="lg:col-span-2 xl:col-span-1" label="This month's purchases" value={moneyShort(data.monthPurchases)} full={money(data.monthPurchases)} note={`${data.monthStockIns} Stock In(s), incl. GST`} to="/pharmacy/stock-in-list" />
              <Stat icon={Wallet} accent="bg-amber-500" chip="bg-amber-50 text-amber-600" className="lg:col-span-3 xl:col-span-1" label="Payable to vendors" value={moneyShort(data.payable)} full={money(data.payable)} note={`${data.unpaidInvoices} unpaid invoice(s)`} to="/pharmacy/vendor-payment" />
              <Stat icon={Boxes} accent="bg-brand-500" chip="bg-brand-50 text-brand-600" className="sm:col-span-2 lg:col-span-3 xl:col-span-1" label="Stock value" value={moneyShort(data.stockValue)} full={money(data.stockValue)} note={`${data.itemCount} active item(s), at sell price`} to="/pharmacy/stock-report" />
            </div>
          )}

          {tab === 'sales' && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Last 7 days', money(weekStats.total)],
                  ['Daily average', money(weekStats.avg)],
                  ['Bills', String(weekStats.bills)],
                  ['Best day', weekStats.best.amount > 0 ? `${dayLabel(weekStats.best.day)} · ${moneyShort(weekStats.best.amount)}` : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-ink-50 px-3 py-2">
                    <p className="text-11 text-ink-500">{k}</p>
                    <p className="truncate text-14 font-bold tabular-nums text-ink-800">{v}</p>
                  </div>
                ))}
              </div>
              <p className="mb-1 text-12 font-semibold text-ink-600">Daily sales, last 7 days <span className="font-normal text-ink-400">· tap a day for its figures</span></p>
              <WeekChart week={data.week} />
            </>
          )}

          {tab === 'bills' && (data.recentSales.length === 0 ? (
            <Empty icon={Receipt} title="No sales yet" text="Bills you save on Sales show up here." action={<Link to="/pharmacy/sales-billing" className="btn-primary mt-3 py-1.5 text-13"><Receipt size={14} /> New Sale</Link>} />
          ) : (
            <div className="divide-y divide-ink-100">
              {data.recentSales.map((s) => (
                <button key={s.SalesBillingId} type="button" onClick={() => navigate('/pharmacy/sales-billing-list')} className="flex w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-ink-50">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-13 font-bold text-brand-700">
                    {(s.CustomerName || '?').trim().slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-13 font-semibold text-ink-800">{s.CustomerName || 'Walk-in'}</span>
                    <span className="block text-11 text-ink-400">{s.BillNo} · {dateLabel(s.TransDate)}{s.MobileNo ? ` · ${s.MobileNo}` : ''}</span>
                  </span>
                  <span className="text-14 font-bold tabular-nums text-ink-900">{money(s.TotalAmount)}</span>
                </button>
              ))}
              <Link to="/pharmacy/sales-billing-list" className="flex items-center justify-center gap-1 pt-2.5 text-12 font-semibold text-brand-600 hover:underline">View all sales <ChevronRight size={13} /></Link>
            </div>
          ))}

          {tab === 'low' && (data.lowStock.length === 0 ? (
            <Empty icon={Boxes} title="Stock looks healthy" text={`No item is at or below ${data.lowStockLimit} pack(s).`} />
          ) : (
            <div className="divide-y divide-ink-100">
              <p className="pb-2 text-12 text-ink-500">{data.lowStockCount} item(s) at or below {data.lowStockLimit} pack(s){data.lowStockCount > data.lowStock.length ? ` · showing the lowest ${data.lowStock.length}` : ''}</p>
              {data.lowStock.map((i) => {
                const pct = Math.max(0, Math.min(100, (i.Stock / data.lowStockLimit) * 100));
                const out = i.Stock <= 0;
                return (
                  <div key={i.ItemId} className="flex items-center gap-3 px-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-13 font-semibold text-ink-800">{i.Name}</span>
                      <span className="block text-11 text-ink-400">{i.ItemCode}{i.Category ? ` · ${i.Category}` : ''}</span>
                      <span className={`mt-1 block h-1.5 w-full max-w-[220px] overflow-hidden rounded-full ${out ? 'bg-red-100' : 'bg-amber-100'}`}>
                        <span className={`block h-full rounded-full ${out ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-13 font-bold tabular-nums text-ink-800">{qty(i.Stock)} <span className="text-11 font-normal text-ink-400">pack(s)</span></span>
                      {out ? <Status tone="red" icon={PackageX}>Out of stock</Status> : <Status tone="amber" icon={AlertTriangle}>Low</Status>}
                    </span>
                  </div>
                );
              })}
              <Link to="/pharmacy/stock-report" className="flex items-center justify-center gap-1 pt-2.5 text-12 font-semibold text-brand-600 hover:underline">Open Stock Report <ChevronRight size={13} /></Link>
            </div>
          ))}

          {tab === 'expiry' && (data.expiring.length === 0 ? (
            <Empty icon={CalendarClock} title="Nothing expiring soon" text={`No batch with stock expires within ${data.expiryDays} days.`} />
          ) : (
            <div className="divide-y divide-ink-100">
              <p className="pb-2 text-12 text-ink-500">{data.expiringCount} batch(es) with stock expiring within {data.expiryDays} days</p>
              {data.expiring.map((b) => {
                const days = daysUntil(b.ExpiryDate);
                return (
                  <div key={`${b.ItemId}|${b.Batch}`} className="flex items-center gap-3 px-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-13 font-semibold text-ink-800">{b.Name}</span>
                      <span className="block text-11 text-ink-400">Batch {b.Batch || '-'} · Exp {monthYear(b.ExpiryDate)} · {qty(b.Qty)} pack(s)</span>
                    </span>
                    {days < 0 ? <Status tone="red" icon={AlertTriangle}>Expired</Status>
                      : days <= 30 ? <Status tone="amber" icon={Clock}>{days} day(s) left</Status>
                        : <Status tone="sky" icon={CalendarClock}>{days} days left</Status>}
                  </div>
                );
              })}
              <Link to="/pharmacy/stock-adjustment" className="flex items-center justify-center gap-1 pt-2.5 text-12 font-semibold text-brand-600 hover:underline">Adjust stock <ChevronRight size={13} /></Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
