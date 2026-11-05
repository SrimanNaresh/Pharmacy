import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SlidersHorizontal, Search, Plus, Pencil, Trash2 } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { stockAdjustmentApi } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');

// Pharmacy > Stock In > Adjustment List: every stock adjustment, searchable
// by adjustment no, remarks or item name. Only an Admin sees Delete (the
// server checks too); it's a soft delete that undoes the stock change.
export default function StockAdjustmentList() {
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
    try { setRows(await stockAdjustmentApi.list(q)); } catch { show('Failed to load adjustments', 'error'); } finally { setLoading(false); }
  }, [show]);
  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const remove = async (r) => {
    if (!confirm(`Delete adjustment ${r.AdjNo}?\n\nIts stock change is undone.`)) return;
    try {
      await stockAdjustmentApi.remove(r.AdjustmentId);
      show(`Adjustment ${r.AdjNo} deleted`, 'success');
      load(search);
    } catch (err) {
      show(err.response?.data?.error || 'Delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={SlidersHorizontal}
          title="Adjustment List"
          subtitle={`${rows.length} adjustment(s)`}
          actions={
            <>
              <div className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Adjustment no, remarks, item..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={() => navigate('/pharmacy/stock-adjustment')}><Plus size={16} /> New adjustment</button>
            </>
          }
        />
        {loading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No adjustments found." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className="rounded-l-lg px-3 py-2">Adj No</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Remarks</th>
                  <th className="px-3 py-2 text-right">In Qty</th>
                  <th className="px-3 py-2 text-right">In Value</th>
                  <th className="px-3 py-2 text-right">Out Qty</th>
                  <th className="px-3 py-2 text-right">Out Value</th>
                  <th className="rounded-r-lg px-3 py-2 text-right">{isAdmin ? 'Edit / Delete' : 'Edit'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.AdjustmentId} className="table-row">
                    <td className="px-3 py-1.5 font-medium text-brand-700">{r.AdjNo}</td>
                    <td className="px-3 py-1.5 text-slate-500">{dateLabel(r.AdjDate)}</td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-slate-600" title={r.ItemNames}>{r.ItemNames}</td>
                    <td className="max-w-[12rem] truncate px-3 py-1.5 text-slate-500" title={r.Remarks || ''}>{r.Remarks || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-emerald-700">{Number(r.InQty) || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-emerald-700">{Number(r.InTotal) ? money(r.InTotal) : '-'}</td>
                    <td className="px-3 py-1.5 text-right text-red-600">{Number(r.OutQty) || '-'}</td>
                    <td className="px-3 py-1.5 text-right text-red-600">{Number(r.OutTotal) ? money(r.OutTotal) : '-'}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1">
                        <button type="button" className="btn-ghost px-2 py-1" title="Edit adjustment" onClick={() => navigate('/pharmacy/stock-adjustment', { state: { editAdjustmentId: r.AdjustmentId } })}><Pencil size={15} /></button>
                        {isAdmin && (
                          <button type="button" className="btn-ghost px-2 py-1 text-red-500 hover:bg-red-50" title="Delete adjustment (Admin only)" onClick={() => remove(r)}><Trash2 size={15} /></button>
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
