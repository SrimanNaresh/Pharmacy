import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Editable combo box: type freely OR pick from a filtered suggestion list.
 * The typed text IS the value (free entry allowed).
 *
 * Props:
 *  - value:       current string value
 *  - onChange:    (string) => void
 *  - options:     array of { value, hint? } suggestions
 *  - placeholder
 */
export default function ComboBox({ value, onChange, options = [], placeholder = 'Type or select...' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const q = (value || '').trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.value.toLowerCase().includes(q) ||
          (o.hint || '').toLowerCase().includes(q)
      )
    : options;

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          className="input pr-9"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:bg-ink-100"
          tabIndex={-1}
        >
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-ink-200 bg-white p-1 shadow-elevated animate-fade-in">
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                o.value === value ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-600 hover:bg-ink-50'
              }`}
            >
              <span className="truncate">{o.value}</span>
              {o.hint && <span className="shrink-0 text-xs text-ink-400">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
