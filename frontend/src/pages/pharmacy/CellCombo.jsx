import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, Plus, Pencil, Trash2 } from 'lucide-react';

const MAX_SUGGESTIONS = 50;

// A text box with a searchable dropdown of names (Bulk Itemlist's cells,
// Purchase Master's value boxes), like the Item screen's MasterPicker: typing filters the names, and a name that matches
// none (ignoring case) offers an "Add" option. The footer has New / Edit /
// Delete: Edit and Delete act on the highlighted name (picked with the arrow
// keys, else the one matching the box). The dropdown is portalled with fixed
// positioning so the table's scroll box doesn't clip it; it closes when
// anything else scrolls.
//  - createFn(name) -> { id, name }, then onCreated(row)
//  - onRename(option, newName) / onDelete(option): async; onDelete returns
//    false when the user backs out of its confirm
export default function CellCombo({ value, onChange, options, createFn, onCreated, onRename, onDelete, addLabel, onEnter, className, disabled, placeholder }) {
  const inputRef = useRef(null);
  const dropRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The footer's inline name box: null, or { kind: 'new' | 'edit', text, target }.
  const [form, setForm] = useState(null);

  const q = value.trim().toLowerCase();
  const filtered = (q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options).slice(0, MAX_SUGGESTIONS);
  const exactMatch = options.find((o) => o.name.toLowerCase() === q);
  const canAdd = !!q && !exactMatch;
  // Keyboard order: the Add option (when shown) first, then the names.
  const choices = [...(canAdd ? [{ add: true }] : []), ...filtered];
  const target = (choices[active] && !choices[active].add ? choices[active] : null) || exactMatch || null;

  const openAt = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect());
    setOpen(true);
  };
  const close = () => { setOpen(false); setActive(-1); setForm(null); setError(''); };
  // Focus leaving for somewhere outside the box and its dropdown closes it.
  const closeIfOutside = (e) => {
    const to = e.relatedTarget;
    if (to && (to === inputRef.current || dropRef.current?.contains(to))) return;
    close();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onScroll = (e) => { if (!e.target.closest?.('[data-cell-combo]')) close(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); };
  }, [open]);

  const pick = (name) => { onChange(name); close(); };
  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };
  const addNew = (name) => run(async () => {
    const created = await createFn(name);
    onCreated(created);
    pick(created.name);
  });
  const choose = (c) => (c.add ? addNew(value.trim()) : pick(c.name));

  const startForm = (kind) => {
    setError('');
    setForm(kind === 'new' ? { kind, text: canAdd ? value.trim() : '' } : { kind, text: target.name, target });
  };
  const cancelForm = () => { setForm(null); setError(''); inputRef.current?.focus(); };
  const submitForm = () => {
    const name = form.text.trim();
    if (!name) return setError('Enter a name');
    if (form.kind === 'new') {
      const existing = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
      return existing ? pick(existing.name) : addNew(name);
    }
    if (name === form.target.name) return cancelForm();
    if (options.some((o) => o !== form.target && o.name.toLowerCase() === name.toLowerCase())) {
      return setError(`"${name}" already exists`);
    }
    const old = form.target.name;
    return run(async () => {
      await onRename(form.target, name);
      if (value.trim() === old) onChange(name);
      setForm(null);
      setActive(-1);
      inputRef.current?.focus();
    });
  };
  const remove = () => run(async () => {
    const old = target.name;
    if ((await onDelete(target)) === false) return;
    if (value.trim().toLowerCase() === old.toLowerCase()) onChange('');
    setActive(-1);
  });

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return openAt();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => Math.max(-1, Math.min(choices.length - 1, a + step)));
    } else if (e.key === 'Enter') {
      if (open && choices[active]) { e.preventDefault(); choose(choices[active]); } else { close(); onEnter?.(); }
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const footBtn = 'flex items-center gap-1 rounded px-1.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <>
      <input
        ref={inputRef}
        className={className}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={openAt}
        onBlur={closeIfOutside}
        onChange={(e) => { onChange(e.target.value); setActive(-1); setForm(null); openAt(); }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {open && rect && createPortal(
        <div
          ref={dropRef}
          data-cell-combo
          className="fixed z-50 flex flex-col rounded-lg border border-ink-200 bg-white text-xs shadow-elevated"
          style={{ top: rect.bottom + 2, left: rect.left, width: Math.max(rect.width, 224) }}
          // Keep focus in the cell box while clicking, except in the footer's name box.
          onMouseDown={(e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }}
        >
          <div className="max-h-52 overflow-y-auto p-1">
            {choices.length === 0 && <p className="px-2.5 py-2 text-center text-ink-400">No values yet</p>}
            {choices.map((c, i) => (
              <button
                key={c.add ? '__add' : c.id}
                type="button"
                onClick={() => choose(c)}
                disabled={c.add && busy}
                className={`flex w-full items-center gap-2 rounded-md border-l-2 px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 ${
                  c.add ? 'border-transparent font-medium text-brand-700 hover:bg-brand-50' : 'text-ink-600 hover:bg-ink-50'
                } ${!c.add && c === target ? 'border-brand-700 bg-brand-50 font-medium text-ink-800' : 'border-transparent'} ${
                  c.add && i === active ? 'bg-brand-50' : ''}`}
              >
                {c.add
                  ? <><Plus size={13} /> {busy ? 'Adding...' : `Add "${value.trim()}" ${addLabel}`}</>
                  : <span className="truncate">{c.name}</span>}
              </button>
            ))}
          </div>

          <div className="border-t border-ink-100 px-1.5 py-1">
            {form ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  className="h-6 min-w-0 flex-1 rounded border border-ink-200 px-1.5 text-xs focus:border-brand-400 focus:outline-none"
                  placeholder={form.kind === 'new' ? 'New name' : 'Rename to'}
                  value={form.text}
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                  onBlur={closeIfOutside}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitForm(); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelForm(); }
                  }}
                />
                <button type="button" className={`${footBtn} text-brand-700 hover:bg-brand-50`} title="Save" disabled={busy} onClick={submitForm}><Check size={13} /></button>
                <button type="button" className={`${footBtn} text-ink-500 hover:bg-ink-50`} title="Cancel" disabled={busy} onClick={cancelForm}><X size={13} /></button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <button type="button" className={`${footBtn} text-brand-700 hover:bg-brand-50`} disabled={busy} onClick={() => startForm('new')}>
                  <Plus size={13} /> New
                </button>
                <button
                  type="button" className={`${footBtn} text-ink-500 hover:bg-ink-50`} disabled={busy || !target || !onRename}
                  title={target ? `Rename "${target.name}"` : 'Highlight a value to edit it'} onClick={() => startForm('edit')}
                >
                  <Pencil size={12} /> Edit
                </button>
                <button
                  type="button" className={`${footBtn} text-ink-500 hover:bg-red-50 hover:text-red-600`} disabled={busy || !target || !onDelete}
                  title={target ? `Delete "${target.name}"` : 'Highlight a value to delete it'} onClick={remove}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            )}
            {error && <p className="px-1 pt-1 text-red-600">{error}</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
