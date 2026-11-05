import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, Check } from 'lucide-react';

/**
 * Single-select dropdown with a type-to-search filter.
 *
 * Props:
 *  - options:     array of { value, label }
 *  - value:       currently selected value
 *  - onChange:    (value) => void
 *  - placeholder
 *  - searchPlaceholder: placeholder for the inner filter input
 */
export default function SearchSelect({ options, value, onChange, placeholder = 'Select...', searchPlaceholder = 'Search medicine...', className = 'input', textSize = 'text-sm' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState(null);
  const ref = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const pick = (v) => {
    onChange(v);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          if (!open) setRect(e.currentTarget.getBoundingClientRect());
          setOpen((o) => !o);
        }}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className={selected ? 'truncate text-ink-800' : 'truncate text-ink-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width }}
          className="z-50 rounded-lg border border-ink-200 bg-white shadow-elevated animate-fade-in"
        >
          <div className="border-b border-ink-100 p-2">
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                autoFocus
                className={`w-full rounded-md border border-ink-200 py-1.5 pl-8 pr-2 ${textSize} focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100`}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className={`px-3 py-3 text-center ${textSize} text-ink-400`}>No matches</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 ${textSize} transition-colors ${
                    o.value === value ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <Check size={15} className="shrink-0 text-brand-600" />}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
