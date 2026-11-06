import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RotateCcw, Search, Plus, Pencil, Trash2 } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { salesReturnApi } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');

// Pharmacy > Return > Sales Return List: every return from a customer,
// searchable by return no, sale no, customer, mobile or item name. Only an
// Admin sees Delete (the server checks too); it's a soft delete that takes
// the returned stock back out.
export default function SalesReturnList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast, show } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (location.state?.flash) {
      show(location.state.flash, 'success');
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate, show]);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    try { setRows(await salesReturnApi.list(q)); } catch { show('Failed to load Sales Returns', 'error'); } finally { setLoading(false); }
  }, [show]);
  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const remove = async (r) => {
    if (!confirm(`Delete Sales Return ${r.ReturnNo} (${r.CustomerName || 'no customer'}, ₹${money(r.TotalAmount)})?\n\nThe returned quantity comes off stock again.`)) return;
    try {
      await salesReturnApi.remove(r.SalesReturnId);
      show(`Sales Return ${r.ReturnNo} deleted`, 'success');
      load(search);
    } catch (err) {
      show(err.response?.data?.error || 'Delete failed', 'error');
    }
  };

  const grand = rows.reduce((t, r) => t + Number(r.TotalAmount || 0), 0);

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={RotateCcw}
          title="Sales Return List"
          subtitle={`${rows.length} return(s) · Total refund ₹${money(grand)}`}
          actions={
            <>
              <div className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Return no, sale no, customer, item..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={() => navigate('/pharmacy/sales-return')}><Plus size={16} /> New sales return</button>
            </>
          }
        />
        {loading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No Sales Returns found." /> : (
          <div className="overflow-x-auto rounded-lg">
            <table className="list-pinned pin-first w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className="rounded-l-lg px-3 py-2">Return No</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Mobile</th>
                  <th className="px-3 py-2">Sale No</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2 text-right">Total Qty</th>
                  <th className="px-3 py-2 text-right">Refund</th>
                  <th className="rounded-r-lg px-3 py-2 text-right">{isAdmin ? 'Edit / Delete' : 'Edit'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.SalesReturnId} className="table-row">
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-brand-700">{r.ReturnNo}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{dateLabel(r.ReturnDate)}</td>
                    <td className="px-3 py-1.5 text-slate-700">{r.CustomerName || '-'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.MobileNo || '-'}</td>
                    <td className="px-3 py-1.5 text-slate-600" title={`Sold ${dateLabel(r.SaleDate)}`}>{r.SaleNo}</td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-slate-500" title={r.ItemNames}>{r.ItemNames}</td>
                    <td className="px-3 py-1.5 text-right">{Number(r.TotalQty)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{money(r.TotalAmount)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" className="btn-ghost px-2 py-1" title="Edit Sales Return" onClick={() => navigate('/pharmacy/sales-return', { state: { editSalesReturnId: r.SalesReturnId } })}><Pencil size={15} /></button>
                        {isAdmin && (
                          <button type="button" className="btn-ghost px-2 py-1 text-red-500 hover:bg-red-50" title="Delete Sales Return (Admin only)" onClick={() => remove(r)}><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
