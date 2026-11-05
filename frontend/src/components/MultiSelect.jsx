import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';

/**
 * Checkbox-style multi-select dropdown with chips.
 *
 * Props:
 *  - options:  array of string option values
 *  - value:    array of selected values
 *  - onChange: (nextArray) => void
 *  - placeholder
 */
export default function MultiSelect({ options, value = [], onChange, placeholder = 'Select...' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = (opt) => {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };

  const remove = (opt, e) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== opt));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="input flex min-h-[42px] items-center justify-between gap-2 text-left"
      >
        <span className="flex flex-1 flex-wrap gap-1">
          {value.length === 0 ? (
            <span className="text-ink-400">{placeholder}</span>
          ) : (
            value.map((v) => (
              <span key={v} className="badge bg-brand-100 text-brand-700">
                {v}
                <X size={12} className="ml-1 cursor-pointer hover:text-brand-900" onClick={(e) => remove(v, e)} />
              </span>
            ))
          )}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-ink-200 bg-white p-1 shadow-elevated animate-fade-in">
          {options.map((opt) => {
            const selected = value.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                  selected ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-600 hover:bg-ink-50'
                }`}
              >
                {opt}
                {selected && <Check size={15} className="text-brand-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
