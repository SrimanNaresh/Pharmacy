// Pieces of the phone item cards (Return, Sales Return, Sales): every field has
// a heading, a box and a note line, each of the same height, so the boxes line
// up across a row whether or not a field has a note.

// Class for a typed box (input / select) inside a card field.
export const cardBox = 'h-[30px] w-full min-w-0 rounded-lg border border-ink-200 bg-white px-1 text-center text-12 tabular-nums shadow-sm placeholder:text-10 placeholder:text-ink-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50 disabled:text-ink-400';
export const cardBad = '!border-red-400 !bg-red-50 text-red-700';

export function CardField({ label, note = '', children }) {
  return (
    <label className="block min-w-0">
      <span className="block h-4 truncate text-center text-10 font-semibold leading-4 text-ink-500">{label}</span>
      {children}
      <span className="block h-3.5 truncate text-center text-9 leading-[14px] text-ink-400">{note}</span>
    </label>
  );
}

// A shown-only value in the same size as a typed box.
export function CardValue({ children, className = '' }) {
  return <div className={`flex h-[30px] items-center justify-center truncate rounded-lg bg-ink-50 px-1 text-12 tabular-nums text-ink-700 ${className}`}>{children}</div>;
}

// The card: a numbered header (title, sub line, tag on the right), then its rows.
export function ItemCard({ no, title, sub, tag, tagClass = 'bg-ink-100 text-ink-500', bad = false, dim = false, children }) {
  return (
    <div className={`overflow-hidden rounded-xl border bg-white shadow-sm ${bad ? 'border-red-300' : 'border-ink-200'} ${dim ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2 border-b border-ink-100 bg-brand-50/60 px-2.5 py-2">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-10 font-bold text-white">{no}</span>
        <div className="min-w-0 flex-1">
          {typeof title === 'string' ? <p className="text-13 font-semibold leading-snug text-ink-800">{title}</p> : title}
          {sub && <p className="text-10.5 text-ink-500">{sub}</p>}
        </div>
        {tag && <span className={`shrink-0 rounded-full px-2 py-0.5 text-10 font-semibold ${tagClass}`}>{tag}</span>}
      </div>
      <div className="space-y-1.5 p-2">{children}</div>
    </div>
  );
}
