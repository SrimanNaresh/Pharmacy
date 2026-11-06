import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Undo2, Search, Plus, Pencil, Trash2 } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { stockReturnApi } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');

// Pharmacy > Return > List: every return to a vendor, searchable by return
// no, Stock In no, vendor or item name. Only an Admin sees Delete (the server
// checks too); deleting puts the returned quantity back into stock.
export default function StockReturnList() {
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
    try { setRows(await stockReturnApi.list(q)); } catch { show('Failed to load returns', 'error'); } finally { setLoading(false); }
  }, [show]);
  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const remove = async (r) => {
    if (!confirm(`Delete return ${r.ReturnNo} (${r.VendorName}, ₹${money(r.TotalAmount)})?\n\nThe returned quantity goes back into stock.`)) return;
    try {
      await stockReturnApi.remove(r.StockReturnId);
      show(`Return ${r.ReturnNo} deleted`, 'success');
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
          icon={Undo2}
          title="Return List"
          subtitle={`${rows.length} return(s) · Total ₹${money(grand)}`}
          actions={
            <>
              <div className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Return no, Stock In no, vendor, item..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={() => navigate('/pharmacy/return')}><Plus size={16} /> New return</button>
            </>
          }
        />
        {loading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No returns found." /> : (
          <div className="overflow-x-auto rounded-lg">
            <table className="list-pinned pin-first w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className="rounded-l-lg px-3 py-2">Return No</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="px-3 py-2">Stock In No</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2 text-right">Items</th>
                  <th className="px-3 py-2 text-right">Total Qty</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="rounded-r-lg px-3 py-2 text-right">{isAdmin ? 'Edit / Delete' : 'Edit'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.StockReturnId} className="table-row">
                    <td className="px-3 py-1.5 font-medium text-brand-700">{r.ReturnNo}</td>
                    <td className="px-3 py-1.5 text-slate-500">{dateLabel(r.ReturnDate)}</td>
                    <td className="px-3 py-1.5 text-slate-700">{r.VendorName}</td>
                    <td className="px-3 py-1.5 text-slate-600">{r.StockInNo}</td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-slate-500" title={r.ItemNames}>{r.ItemNames}</td>
                    <td className="px-3 py-1.5 text-right">{r.Items}</td>
                    <td className="px-3 py-1.5 text-right">{Number(r.TotalQty)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{money(r.TotalAmount)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" className="btn-ghost px-2 py-1" title="Edit return" onClick={() => navigate('/pharmacy/return', { state: { editReturnId: r.StockReturnId } })}><Pencil size={15} /></button>
                        {isAdmin && (
                          <button type="button" className="btn-ghost px-2 py-1 text-red-500 hover:bg-red-50" title="Delete return (Admin only)" onClick={() => remove(r)}><Trash2 size={15} /></button>
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
