import { useEffect, useState, useCallback } from 'react';
import { Save, Search, ShieldCheck, User } from 'lucide-react';
import { Spinner, EmptyState, Toast, CardHeader } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { userApi, menuAccessApi } from '../../api/client.js';
import { MENU_GROUPS, ALL_MENU_ITEMS, ACCESS_LEVELS } from '../../config/menuItems.js';

const emptyAccess = () => {
  const m = {};
  for (const it of ALL_MENU_ITEMS) m[it.key] = 'No Access';
  return m;
};

const levelStyle = {
  Full: 'peer-checked:bg-emerald-600 peer-checked:text-white peer-checked:border-emerald-600',
  View: 'peer-checked:bg-brand-600 peer-checked:text-white peer-checked:border-brand-600',
  'No Access': 'peer-checked:bg-slate-500 peer-checked:text-white peer-checked:border-slate-500',
};

// Recursive: a node with `submenu` is a nested bordered box (one level
// darker background per depth would be overkill — depth is at most a
// couple of levels here, e.g. Clinic > Consultation > Medication), a true
// leaf renders as the Full/View/No Access row.
function AccessNode({ node, access, setLevel, depth = 0 }) {
  if (node.submenu) {
    return (
      <div className={depth === 0 ? 'rounded-lg border border-ink-100 bg-ink-50/40 p-3' : 'ml-3 border-l border-ink-200 pl-3'}>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">{node.label}</p>
        <div className="space-y-1.5">
          {node.submenu.map((child) => (
            <AccessNode key={child.key || child.label} node={child} access={access} setLevel={setLevel} depth={depth + 1} />
          ))}
        </div>
      </div>
    );
  }
  return <AccessRow item={node} access={access} setLevel={setLevel} />;
}

function AccessRow({ item, access, setLevel }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ink-100 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-ink-700">{item.label}</span>
      <div className="flex gap-2">
        {ACCESS_LEVELS.map((lvl) => (
          <label key={lvl} className="cursor-pointer">
            <input
              type="radio"
              name={`acc-${item.key}`}
              className="peer sr-only"
              checked={access[item.key] === lvl}
              onChange={() => setLevel(item.key, lvl)}
            />
            <span className={`inline-block rounded-md border border-ink-200 px-3 py-1 text-xs font-medium text-ink-500 transition-colors ${levelStyle[lvl]}`}>
              {lvl}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function MenuAccess() {
  const { toast, show } = useToast();
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [access, setAccess] = useState(emptyAccess());
  const [loadingAccess, setLoadingAccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadUsers = useCallback(async (q = '') => {
    setLoadingUsers(true);
    try {
      setUsers(await userApi.list(q));
    } catch {
      show('Failed to load users', 'error');
    } finally {
      setLoadingUsers(false);
    }
  }, [show]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => {
    const t = setTimeout(() => loadUsers(userSearch), 350);
    return () => clearTimeout(t);
  }, [userSearch, loadUsers]);

  const selectUser = async (u) => {
    setSelectedUser(u);
    setLoadingAccess(true);
    const base = emptyAccess();
    try {
      const saved = await menuAccessApi.get(u.UserId);
      for (const row of saved) {
        if (row.MenuKey in base) base[row.MenuKey] = row.AccessLevel;
      }
    } catch {
      show('Failed to load access', 'error');
    } finally {
      setAccess(base);
      setLoadingAccess(false);
    }
  };

  const setLevel = (key, level) => setAccess((a) => ({ ...a, [key]: level }));

  const setAllTo = (level) => {
    const next = {};
    for (const it of ALL_MENU_ITEMS) next[it.key] = level;
    setAccess(next);
  };

  const save = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const items = ALL_MENU_ITEMS.map((it) => ({ menuKey: it.key, accessLevel: access[it.key] }));
      await menuAccessApi.save(selectedUser.UserId, items);
      show('Menu access saved', 'success');
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_1fr]">
        {/* LEFT: Users */}
        <div className="card h-fit">
          <CardHeader icon={User} title="Users" subtitle="Select a user" />
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Search user..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
          </div>
          {loadingUsers ? (
            <Spinner />
          ) : users.length === 0 ? (
            <EmptyState message="No users." />
          ) : (
            <div className="max-h-[60vh] space-y-1 overflow-y-auto">
              {users.map((u) => (
                <button
                  key={u.UserId}
                  onClick={() => selectUser(u)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    selectedUser?.UserId === u.UserId ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  <span className="truncate">{u.Username}</span>
                  {!u.IsActive && <span className="badge bg-slate-100 text-slate-500">Inactive</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: Menu access */}
        <div className="card">
          <CardHeader
            icon={ShieldCheck}
            title="Menu Access"
            subtitle={selectedUser ? `Permissions for ${selectedUser.Username}` : 'Select a user to set permissions'}
            actions={
              selectedUser && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn-secondary" onClick={() => setAllTo('No Access')}>Clear all</button>
                  <button className="btn-secondary" onClick={() => setAllTo('Full')}>Grant all</button>
                  <button className="btn-primary" onClick={save} disabled={saving}>
                    <Save size={16} /> {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )
            }
          />

          {!selectedUser ? (
            <EmptyState message="Choose a user on the left to configure menu access." />
          ) : loadingAccess ? (
            <Spinner />
          ) : (
            <div className="space-y-6">
              {MENU_GROUPS.map((g) => (
                <div key={g.group}>
                  <p className="section-title mb-2">{g.group}</p>
                  <div className="space-y-1.5">
                    {g.items.map((it) => (
                      <AccessNode key={it.key || it.label} node={it} access={access} setLevel={setLevel} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
