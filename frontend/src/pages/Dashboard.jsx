import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, IndianRupee, CalendarDays, PackagePlus, Wallet, Boxes, AlertTriangle, CalendarClock, Receipt, RefreshCw,
} from 'lucide-react';
import { CardHeader, Spinner, EmptyState } from '../components/ui.jsx';
import { dashboardApi } from '../api/client.js';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');
const monthYear = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`;
};
const dayLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

function Stat({ icon: Icon, tint, label, value, note, to }) {
  const body = (
    <div className="card flex items-center gap-3 !p-3 transition-shadow hover:shadow-md">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tint}`}>
        <Icon size={19} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
        <p className="truncate text-lg font-bold tabular-nums text-ink-800">{value}</p>
        {note && <p className="truncate text-[11px] text-ink-400">{note}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

// Last 7 days' sales as simple bars (today last).
function WeekChart({ week }) {
  const max = Math.max(...week.map((d) => d.amount), 1);
  return (
    <div className="flex h-40 items-end gap-2 pt-2">
      {week.map((d) => (
        <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${dateLabel(d.day)}: ${money(d.amount)} · ${d.bills} bill(s)`}>
          <span className="text-[10px] tabular-nums text-ink-400">{d.amount ? Math.round(d.amount).toLocaleString('en-IN') : ''}</span>
          <div className="flex w-full flex-1 items-end">
            <div className="w-full rounded-t-md bg-brand-500/80" style={{ height: `${Math.max((d.amount / max) * 100, d.amount ? 4 : 1)}%` }} />
          </div>
          <span className="text-[11px] font-medium text-ink-500">{dayLabel(d.day)}</span>
        </div>
      ))}
    </div>
  );
}

const th = 'px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500';
const td = 'px-2 py-1 text-[13px]';

// Dashboard: the day at a glance — sales, purchases, vendor dues, stock value,
// the last 7 days' sales, items running low, batches expiring soon and the
// latest bills.
export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    dashboardApi.get()
      .then((d) => { setData(d); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'Failed to load the dashboard'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (!data) return loading ? <Spinner /> : <div className="card text-sm text-red-600">{error}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard size={18} className="text-brand-600" />
          <h1 className="text-base font-bold text-ink-800">Dashboard</h1>
          <span className="text-xs text-ink-400">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat icon={IndianRupee} tint="bg-emerald-100 text-emerald-700" label="Today's Sales" value={money(data.todaySales)} note={`${data.todayBills} bill(s), less returns`} to="/pharmacy/sales-billing-list" />
        <Stat icon={CalendarDays} tint="bg-sky-100 text-sky-700" label="This Month's Sales" value={money(data.monthSales)} note={`${data.monthBills} bill(s), less returns`} to="/pharmacy/sales-billing-list" />
        <Stat icon={PackagePlus} tint="bg-violet-100 text-violet-700" label="This Month's Purchases" value={money(data.monthPurchases)} note={`${data.monthStockIns} Stock In(s), incl. GST`} to="/pharmacy/stock-in-list" />
        <Stat icon={Wallet} tint="bg-amber-100 text-amber-700" label="Payable to Vendors" value={money(data.payable)} note={`${data.unpaidInvoices} unpaid invoice(s)`} to="/pharmacy/vendor-payment" />
        <Stat icon={Boxes} tint="bg-rose-100 text-rose-700" label="Stock Value" value={money(data.stockValue)} note={`${data.itemCount} active item(s), at sell price`} to="/pharmacy/stock-report" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
        <div className="card !p-3 lg:col-span-3">
          <CardHeader icon={IndianRupee} title="Sales – last 7 days" subtitle={`Total ${money(data.week.reduce((t, d) => t + d.amount, 0))}`} />
          <WeekChart week={data.week} />
        </div>

        <div className="card !p-3 lg:col-span-2">
          <CardHeader icon={Receipt} title="Latest Bills" actions={<Link to="/pharmacy/sales-billing" className="text-xs font-medium text-brand-600 hover:underline">+ New sale</Link>} />
          {data.recentSales.length === 0 ? <EmptyState message="No sales yet." /> : (
            <table className="w-full">
              <thead><tr className="table-head"><th className={`${th} text-left`}>Bill No</th><th className={`${th} text-left`}>Customer</th><th className={`${th} text-center`}>Date</th><th className={`${th} text-right`}>Amount</th></tr></thead>
              <tbody>
                {data.recentSales.map((s) => (
                  <tr key={s.SalesBillingId} className="table-row cursor-pointer" onClick={() => navigate('/pharmacy/sales-billing-list')}>
                    <td className={`${td} font-medium text-brand-700`}>{s.BillNo}</td>
                    <td className={`${td} truncate`}>{s.CustomerName || '-'}</td>
                    <td className={`${td} text-center`}>{dateLabel(s.TransDate)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(s.TotalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card !p-3">
          <CardHeader icon={AlertTriangle} title="Low Stock" subtitle={`${data.lowStockCount} item(s) at or below ${data.lowStockLimit} pack(s)`}
            actions={<Link to="/pharmacy/stock-report" className="text-xs font-medium text-brand-600 hover:underline">Stock Report</Link>} />
          {data.lowStock.length === 0 ? <EmptyState message="No items running low." /> : (
            <table className="w-full">
              <thead><tr className="table-head"><th className={`${th} text-center`}>Code</th><th className={`${th} text-left`}>Item Name</th><th className={`${th} text-left`}>Category</th><th className={`${th} text-right`}>Stock</th></tr></thead>
              <tbody>
                {data.lowStock.map((i) => (
                  <tr key={i.ItemId} className="table-row">
                    <td className={`${td} text-center text-ink-500`}>{i.ItemCode}</td>
                    <td className={td}>{i.Name}</td>
                    <td className={`${td} text-ink-500`}>{i.Category || '-'}</td>
                    <td className={`${td} text-right font-semibold tabular-nums ${i.Stock <= 0 ? 'text-red-600' : 'text-amber-600'}`}>{qty(i.Stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card !p-3">
          <CardHeader icon={CalendarClock} title="Expiring Soon" subtitle={`${data.expiringCount} batch(es) with stock expiring within ${data.expiryDays} days`}
            actions={<Link to="/pharmacy/stock-adjustment" className="text-xs font-medium text-brand-600 hover:underline">Adjustment</Link>} />
          {data.expiring.length === 0 ? <EmptyState message="No batches expiring soon." /> : (
            <table className="w-full">
              <thead><tr className="table-head"><th className={`${th} text-left`}>Item Name</th><th className={`${th} text-center`}>Batch</th><th className={`${th} text-center`}>Exp</th><th className={`${th} text-right`}>Stock</th></tr></thead>
              <tbody>
                {data.expiring.map((b) => {
                  const expired = new Date(b.ExpiryDate) < new Date();
                  return (
                    <tr key={`${b.ItemId}|${b.Batch}`} className="table-row">
                      <td className={td}>{b.Name}</td>
                      <td className={`${td} text-center`}>{b.Batch || '-'}</td>
                      <td className={`${td} text-center font-semibold ${expired ? 'text-red-600' : 'text-amber-600'}`}>{monthYear(b.ExpiryDate)}{expired ? ' · expired' : ''}</td>
                      <td className={`${td} text-right tabular-nums`}>{qty(b.Qty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
