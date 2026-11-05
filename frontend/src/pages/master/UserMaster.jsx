import { useEffect, useState, useCallback } from 'react';
import { Save, Search, Pencil, Trash2, Users, ShieldCheck } from 'lucide-react';
import { Spinner, EmptyState, Modal, Toast, CardHeader } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { userApi } from '../../api/client.js';

const ROLES = ['Staff', 'Admin'];

export default function UserMaster() {
  const { toast, show } = useToast();
  const [form, setForm] = useState({ username: '', password: '', isActive: true, role: 'Staff' });
  const [saving, setSaving] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    try {
      setRows(await userApi.list(q));
    } catch {
      show('Failed to load users', 'error');
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, load]);

  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: k === 'isActive' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.username.trim()) return show('User Name is required', 'error');
    if (!form.password) return show('Password is required', 'error');
    setSaving(true);
    try {
      await userApi.create(form);
      show('User saved', 'success');
      setForm({ username: '', password: '', isActive: true, role: 'Staff' });
      load(search);
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editing.Username?.trim()) return show('User Name is required', 'error');
    try {
      await userApi.update(editing.UserId, {
        username: editing.Username,
        password: editing.NewPassword || '', // blank keeps existing
        isActive: !!editing.IsActive,
        role: editing.Role || 'Staff',
      });
      show('Updated', 'success');
      setEditing(null);
      load(search);
    } catch (err) {
      show(err.response?.data?.error || 'Update failed', 'error');
    }
  };

  const remove = async (row) => {
    if (!confirm(`Delete user "${row.Username}"?`)) return;
    try {
      await userApi.remove(row.UserId);
      show('Deleted', 'success');
      load(search);
    } catch (err) {
      show(err.response?.data?.error || 'Delete failed', 'error');
    }
  };

  return (
    <div className="space-y-5">
      {/* Create form */}
      <form onSubmit={submit} className="card">
        <CardHeader icon={ShieldCheck} title="User Master" subtitle="Create a login user" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <div>
            <label className="label">User Name *</label>
            <input className="input" value={form.username} onChange={update('username')} placeholder="User name" />
          </div>
          <div>
            <label className="label">Password *</label>
            <input type="password" className="input" value={form.password} onChange={update('password')} placeholder="Password" />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Active</label>
            <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 text-sm text-ink-600">
              <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300" checked={form.isActive} onChange={update('isActive')} />
              {form.isActive ? 'Active' : 'Inactive'}
            </label>
          </div>
          <div>
            <button type="submit" className="btn-primary w-full" disabled={saving}>
              <Save size={16} /> {saving ? 'Saving...' : 'Save User'}
            </button>
          </div>
        </div>
      </form>

      {/* List */}
      <div className="card">
        <CardHeader
          icon={Users}
          title="User List"
          subtitle="Search, edit and delete users"
          actions={
            <div className="relative w-full sm:w-72">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input className="input pl-9" placeholder="Search by username..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          }
        />

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState message="No users found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="table-head">
                  <th className="rounded-l-lg px-3 py-3">#</th>
                  <th className="px-3 py-3">User Name</th>
                  <th className="px-3 py-3">Password</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Active</th>
                  <th className="rounded-r-lg px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.UserId} className="table-row">
                    <td className="px-3 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-3 font-medium text-slate-700">{r.Username}</td>
                    <td className="px-3 py-3 text-slate-400">••••••••</td>
                    <td className="px-3 py-3 text-slate-600">
                      {r.Role || 'Staff'}
                    </td>
                    <td className="px-3 py-3">
                      {r.IsActive ? (
                        <span className="badge bg-emerald-100 text-emerald-700">Active</span>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-500">Inactive</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost px-2 py-1" onClick={() => setEditing({ ...r, NewPassword: '' })}><Pencil size={15} /></button>
                        <button className="btn-ghost px-2 py-1 text-red-500 hover:bg-red-50" onClick={() => remove(r)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit User">
        {editing && (
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="label">User Name *</label>
              <input className="input" value={editing.Username || ''} onChange={(e) => setEditing({ ...editing, Username: e.target.value })} />
            </div>
            <div>
              <label className="label">New Password</label>
              <input type="password" className="input" value={editing.NewPassword || ''} onChange={(e) => setEditing({ ...editing, NewPassword: e.target.value })} placeholder="Leave blank to keep current" />
            </div>
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={editing.Role || 'Staff'}
                onChange={(e) => setEditing({ ...editing, Role: e.target.value })}
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-600">
                <input type="checkbox" className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300" checked={!!editing.IsActive} onChange={(e) => setEditing({ ...editing, IsActive: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveEdit}><Save size={16} /> Save Changes</button>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} />
    </div>
  );
}
