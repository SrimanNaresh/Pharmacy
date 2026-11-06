import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Search, ChevronRight, ChevronDown } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { pharmacyItemApi, pharmacyReportApi } from '../../api/client.js';

const qty = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const money = (n) => (n == null ? '-' : Number(n).toFixed(2));
const when = (iso) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const KINDS = {
  opening: ['Opening', 'bg-slate-100 text-slate-700'],
  purchase: ['Stock In', 'bg-emerald-100 text-emerald-700'],
  return: ['Return', 'bg-red-100 text-red-700'],
  issue: ['Sold', 'bg-red-100 text-red-700'],
  'sales-return': ['Sales Return', 'bg-emerald-100 text-emerald-700'],
  adjustment: ['Adjustment', 'bg-amber-100 text-amber-700'],
};

// One item's stock history, shown under its row.
function History({ itemId }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    pharmacyReportApi.history(itemId).then(setRows).catch(() => setRows([]));
  }, [itemId]);
  if (!rows) return <Spinner />;
  if (!rows.length) return <p className="px-3 py-2 text-sm text-ink-400">No stock changes yet.</p>;
  // Newest first, as it's read top-down.
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-ink-500">
          <th className="px-2 py-1">Date &amp; Time</th>
          <th className="px-2 py-1">Type</th>
          <th className="px-2 py-1">Details</th>
          <th className="px-2 py-1">Vendor</th>
          <th className="px-2 py-1 text-right">Change</th>
          <th className="px-2 py-1 text-right">Stock after</th>
          <th className="px-2 py-1">By</th>
        </tr>
      </thead>
      <tbody>
        {[...rows].reverse().map((e, i) => {
          const [label, tone] = KINDS[e.Kind] || [e.Kind, 'bg-slate-100 text-slate-700'];
          const change = Number(e.Qty);
          return (
            <tr key={i} className="border-t border-ink-100">
              <td className="whitespace-nowrap px-2 py-1">{when(e.At)}</td>
              <td className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 font-medium ${tone}`}>{label}</span></td>
              <td className="px-2 py-1 text-ink-600">{e.Details}</td>
              <td className="px-2 py-1 text-ink-500">{e.VendorName || '-'}</td>
              <td className={`px-2 py-1 text-right font-medium ${change < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{change > 0 ? '+' : ''}{qty(change)}</td>
              <td className="px-2 py-1 text-right">{qty(e.BalanceAfter)}</td>
              <td className="px-2 py-1 text-ink-500">{e.ByUser || '-'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Pharmacy > Report > Stock Report: per item, Opening + Stock In - Return -
// Sold + Adjustment = Current Stock. Clicking an item opens its history.
export default function StockReport() {
  const { toast, show } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showWhat, setShowWhat] = useState('history');
  const [categories, setCategories] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    pharmacyItemApi.list()
      .then((items) => setCategories([...new Set(items.map((i) => i.Category).filter(Boolean))].sort()))
      .catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await pharmacyReportApi.stock({ search, category, show: showWhat }));
    } catch {
      show('Failed to load the stock report', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, category, showWhat, show]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const totals = useMemo(() => rows.reduce((t, r) => {
    for (const k of ['Opening', 'StockIn', 'Returned', 'Sold', 'Adjustment', 'CurrentStock', 'StockValue']) t[k] += Number(r[k] || 0);
    return t;
  }, { Opening: 0, StockIn: 0, Returned: 0, Sold: 0, Adjustment: 0, CurrentStock: 0, StockValue: 0 }), [rows]);

  const th = 'px-2 py-2';
  const td = 'px-2 py-1.5';

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={BarChart3}
          title="Stock Report"
          subtitle="Item-wise stock and its history"
          actions={
            <>
              <div className="relative w-full sm:w-64">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Name, code or generic..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <select className="input w-full sm:w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="input w-full sm:w-auto" value={showWhat} onChange={(e) => setShowWhat(e.target.value)}>
                <option value="history">Stock history</option>
                <option value="instock">In stock only</option>
                <option value="outofstock">Out of stock</option>
                <option value="all">All items</option>
              </select>
              </div>
            </>
          }
        />

        <p className="mb-2 text-xs text-ink-500">
          Opening + Stock In − Return − Sold + Adjustment = Current Stock. Stock Value = Current Stock × Sell Price. Click an item to see its history.
        </p>

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState message="No items match." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className={`${th} rounded-l-lg`}>Item Code</th>
                  <th className={`${th} min-w-[170px]`}>Item Name</th>
                  <th className={th}>Category</th>
                  <th className={th}>Pack</th>
                  <th className={`${th} text-right`}>Opening</th>
                  <th className={`${th} text-right`}>Stock In</th>
                  <th className={`${th} text-right`}>Return</th>
                  <th className={`${th} text-right`}>Sold</th>
                  <th className={`${th} text-right`}>Adjustment</th>
                  <th className={`${th} bg-brand-100/60 text-right`}>Current Stock</th>
                  <th className={`${th} text-right`}>Sell Price</th>
                  <th className={`${th} rounded-r-lg text-right`}>Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const out = Number(r.CurrentStock) <= 0;
                  const open = openId === r.ItemId;
                  return (
                    <Fragment key={r.ItemId}>
                      <tr
                        className={`cursor-pointer border-b border-ink-100 hover:bg-ink-50 ${out ? 'text-ink-400' : ''}`}
                        onClick={() => setOpenId(open ? null : r.ItemId)}
                      >
                        <td className={`${td} whitespace-nowrap`}>
                          {open ? <ChevronDown size={14} className="mr-1 inline" /> : <ChevronRight size={14} className="mr-1 inline" />}
                          {r.ItemCode}
                        </td>
                        <td className={`${td} font-medium ${out ? '' : 'text-ink-800'}`}>{r.ItemName}</td>
                        <td className={td}>{r.Category || '-'}</td>
                        <td className={td}>{r.Pack || '-'}</td>
                        <td className={`${td} text-right`}>{qty(r.Opening)}</td>
                        <td className={`${td} text-right ${out ? '' : 'text-emerald-600'}`}>{qty(r.StockIn)}</td>
                        <td className={`${td} text-right ${out ? '' : 'text-red-600'}`}>{qty(r.Returned)}</td>
                        <td className={`${td} text-right ${out ? '' : 'text-red-600'}`}>{qty(r.Sold)}</td>
                        <td className={`${td} text-right`}>{qty(r.Adjustment)}</td>
                        <td className={`${td} bg-brand-50/70 text-right font-semibold`}>{qty(r.CurrentStock)}</td>
                        <td className={`${td} text-right`}>{money(r.SellPrice)}</td>
                        <td className={`${td} text-right`}>{money(r.StockValue)}</td>
                      </tr>
                      {open && (
                        <tr className="bg-ink-50/60">
                          <td colSpan={12} className="px-4 py-2"><History itemId={r.ItemId} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ink-800 font-semibold text-white">
                  <td className={td} colSpan={4}>Total ({rows.length} items)</td>
                  <td className={`${td} text-right`}>{qty(totals.Opening)}</td>
                  <td className={`${td} text-right`}>{qty(totals.StockIn)}</td>
                  <td className={`${td} text-right`}>{qty(totals.Returned)}</td>
                  <td className={`${td} text-right`}>{qty(totals.Sold)}</td>
                  <td className={`${td} text-right`}>{qty(totals.Adjustment)}</td>
                  <td className={`${td} text-right`}>{qty(totals.CurrentStock)}</td>
                  <td className={td} />
                  <td className={`${td} text-right`}>{money(totals.StockValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
