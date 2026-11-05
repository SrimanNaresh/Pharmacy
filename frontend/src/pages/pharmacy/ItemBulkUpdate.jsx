import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Search, Save, Undo2, ChevronLeft, ChevronRight } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { itemMasterApi } from '../../api/client.js';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { usePickLists } from './usePickLists.js';

const PAGE = 50;

// Editable columns: body key, item column, heading, kind and width.
const COLS = [
  { key: 'category', col: 'Category', label: 'Category', kind: 'list', list: 'category', w: 'w-36' },
  { key: 'potency', col: 'Potency', label: 'Potency', kind: 'list', list: 'potency', w: 'w-24' },
  { key: 'pack', col: 'Pack', label: 'Pack', kind: 'pack', w: 'w-24' },
  { key: 'hsnCode', col: 'HSNCode', label: 'HSN Code', kind: 'text', w: 'w-24' },
  { key: 'manufacturer', col: 'ManufacturerName', label: 'Manufacturer', kind: 'list', list: 'manufacturer', w: 'w-40' },
  { key: 'mrp', col: 'MRP', label: 'MRP', kind: 'number', w: 'w-24' },
  { key: 'cgstPercent', col: 'CGSTPercent', label: 'CGST %', kind: 'number', w: 'w-16' },
  { key: 'sgstPercent', col: 'SGSTPercent', label: 'SGST %', kind: 'number', w: 'w-16' },
  { key: 'rack', col: 'Rack', label: 'Rack', kind: 'text', w: 'w-20' },
  { key: 'boxNo', col: 'BoxNo', label: 'Box', kind: 'text', w: 'w-16' },
  { key: 'status', col: 'Status', label: 'Status', kind: 'status', w: 'w-24' },
];

// A cell's value as the box shows it, for comparing with what was typed.
const asText = (col, v) => (v == null ? '' : ['MRP', 'CGSTPercent', 'SGSTPercent'].includes(col) ? String(Number(v)) : String(v));

// Pharmacy > Item > Bulk Update: the item list as an editable grid. Changes are
// kept across pages and searches until Save sends them all at once; if any
// row is wrong nothing is saved and those rows turn red with the reason.
export default function ItemBulkUpdate() {
  const { toast, show } = useToast();
  const { lists } = usePickLists((m) => show(m, 'error'));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [changes, setChanges] = useState({}); // itemId -> { key: value }
  const [errors, setErrors] = useState({}); // itemId -> reason
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => itemMasterApi.list()
    .then(setRows).catch(() => show('Failed to load items', 'error')).finally(() => setLoading(false)), [show]);
  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => [...new Set(rows.map((r) => r.Category).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!category || r.Category === category)
      && (!q || [r.Name, r.ItemCode, r.GenericName].some((v) => v && v.toLowerCase().includes(q))));
  }, [rows, search, category]);
  useEffect(() => { setPage(0); }, [search, category]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const valueOf = (r, c) => (changes[r.ItemId] && c.key in changes[r.ItemId] ? changes[r.ItemId][c.key] : asText(c.col, r[c.col]));
  const isChanged = (r, c) => !!changes[r.ItemId] && c.key in changes[r.ItemId];

  // Typing a cell back to what's saved drops the change.
  const edit = (r, c, value) => {
    setChanges((all) => {
      const row = { ...(all[r.ItemId] || {}) };
      if (value === asText(c.col, r[c.col])) delete row[c.key];
      else row[c.key] = value;
      const next = { ...all };
      if (Object.keys(row).length) next[r.ItemId] = row;
      else delete next[r.ItemId];
      return next;
    });
    setErrors((e) => {
      if (!e[r.ItemId]) return e;
      const next = { ...e };
      delete next[r.ItemId];
      return next;
    });
  };

  const count = Object.keys(changes).length;

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.entries(changes).map(([itemId, ch]) => ({ itemId: Number(itemId), ...ch }));
      const r = await itemMasterApi.bulkUpdate(body);
      show(`Saved ${r.saved} item(s)`, 'success');
      setChanges({});
      setErrors({});
      await load();
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors) setErrors(Object.fromEntries(data.errors.map((e) => [e.itemId, e.error])));
      show(data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!confirm(`Discard the changes to ${count} item(s)?`)) return;
    setChanges({});
    setErrors({});
  };

  const cellBox = 'w-full rounded border bg-transparent px-1.5 py-0.5 text-[13px] focus:bg-white focus:outline-none';
  const cell = 'border border-ink-200 px-1 py-0.5';

  const editor = (r, c, rIdx, cIdx) => {
    const changed = isChanged(r, c);
    const cls = `${cellBox} ${changed ? 'border-amber-400 bg-amber-50 font-medium text-amber-900' : 'border-transparent focus:border-brand-400'}`;
    const common = { className: cls, 'data-r': rIdx, 'data-c': cIdx, value: valueOf(r, c), onChange: (e) => edit(r, c, e.target.value) };
    if (c.kind === 'list') {
      // A list can hold the same name twice (older data); show it once.
      const opts = [...new Set(lists[c.list].map((o) => o.name))];
      const v = valueOf(r, c);
      return (
        <select {...common}>
          <option value="">—</option>
          {v && !opts.includes(v) && <option value={v}>{v}</option>}
          {opts.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    }
    if (c.kind === 'status') {
      return (
        <select {...common}>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      );
    }
    if (c.kind === 'pack') return <input {...common} list="bulk-pack-values" />;
    if (c.kind === 'number') return <input {...common} type="number" min="0" step="0.01" className={`${cls} no-spin text-right`} />;
    return <input {...common} />;
  };

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={Layers}
          title="Item Bulk Update"
          subtitle={count ? `${count} item(s) changed – not saved yet` : `${filtered.length} item(s) · edit cells, then save them all at once`}
          actions={
            <>
              <div className="relative w-full sm:w-56">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input pl-9" placeholder="Name, code or generic..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {count > 0 && (
                <>
                  <button type="button" className="btn-secondary" onClick={discard} disabled={saving}><Undo2 size={16} /> Discard changes</button>
                  <button type="button" className="btn-primary" onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving...' : `Save ${count} item(s)`}</button>
                </>
              )}
            </>
          }
        />

        <datalist id="bulk-pack-values">{lists.pack.map((p) => <option key={p} value={p} />)}</datalist>

        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState message="No items found." />
        ) : (
          <>
            <div className="max-h-[70vh] overflow-auto rounded-lg border border-ink-200">
              <table className="w-max min-w-full border-collapse text-left text-[13px]" {...gridKeys}>
                <thead className="sticky top-0 z-20">
                  <tr className="bg-brand-50 font-bold text-brand-700">
                    <th className={`${cell} sticky left-0 z-30 w-[88px] min-w-[88px] bg-brand-50 px-2`}>Item Code</th>
                    <th className={`${cell} sticky left-[88px] z-30 w-56 min-w-[14rem] bg-brand-50 px-2`}>Item Name</th>
                    {COLS.map((c) => <th key={c.key} className={`${cell} ${c.w} px-2 ${c.kind === 'number' ? 'text-right' : ''}`}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, rIdx) => {
                    const err = errors[r.ItemId];
                    const changed = !!changes[r.ItemId];
                    const tint = err ? 'bg-red-50' : changed ? 'bg-amber-50/60' : 'bg-white';
                    // The pinned cells need a solid colour, or columns scrolled under them show through.
                    const pinTint = err ? 'bg-red-50' : changed ? 'bg-amber-50' : 'bg-white';
                    return (
                      <tr key={r.ItemId} className={tint}>
                        <td className={`${cell} sticky left-0 z-10 px-2 text-ink-500 ${pinTint}`}>{r.ItemCode}</td>
                        <td className={`${cell} sticky left-[88px] z-10 px-2 font-medium ${pinTint} ${err ? 'text-red-700' : 'text-ink-800'}`} title={err || ''}>
                          {r.Name}
                          {err && <p className="text-[11px] font-normal text-red-600">{err}</p>}
                        </td>
                        {COLS.map((c, cIdx) => <td key={c.key} className={`${cell} ${c.w}`}>{editor(r, c, rIdx, cIdx)}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-ink-500">
              <span>Changed cells are amber; rows that couldn't be saved are red.</span>
              {pages > 1 && (
                <span className="flex items-center gap-2">
                  <button type="button" className="btn-ghost px-2 py-1" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /></button>
                  Page {page + 1} of {pages}
                  <button type="button" className="btn-ghost px-2 py-1" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}><ChevronRight size={15} /></button>
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
