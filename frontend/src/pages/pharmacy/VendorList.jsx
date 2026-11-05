import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Store, Search, Plus, Pencil } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { vendorApi } from '../../api/client.js';

export default function VendorList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast, show } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Message Vendor Master hands back after an edit or delete.
  useEffect(() => {
    if (location.state?.flash) {
      show(location.state.flash, 'success');
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate, show]);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    try {
      setRows(await vendorApi.list(q));
    } catch {
      show('Failed to load vendors', 'error');
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const editRow = (row) => navigate('/pharmacy/vendor-master', { state: { editVendor: row } });

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={Store}
          title="Vendor List"
          subtitle="Search and edit vendors"
          actions={
            <>
              <div className="relative w-full sm:w-72">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Search vendors..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={() => navigate('/pharmacy/vendor-master')}>
                <Plus size={16} /> New vendor
              </button>
            </>
          }
        />

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState message="No vendors found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className="rounded-l-lg px-3 py-2">Vendor name</th>
                  <th className="px-3 py-2">Contact person</th>
                  <th className="px-3 py-2">Mobile No</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">GSTIN</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="rounded-r-lg px-3 py-2 text-right">Edit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.VendorId} className="table-row">
                    <td className="px-3 py-1.5 font-medium text-slate-700">{r.VendorName}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.ContactPerson || '-'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.ContactNo || '-'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.State || '-'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.GSTNo || '-'}</td>
                    <td className="px-3 py-1.5">
                      <span className={r.Status === 'Inactive' ? 'text-slate-400' : 'text-emerald-600'}>{r.Status || 'Active'}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button type="button" className="btn-ghost px-2 py-1" title="Edit vendor" onClick={() => editRow(r)}><Pencil size={15} /></button>
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
