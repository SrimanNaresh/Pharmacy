import { X } from 'lucide-react';

export function PageHeader({ title, actions }) {
  return (
    <div className="no-print mb-4 flex flex-col gap-3 border-b border-ink-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-lg font-bold tracking-tight text-ink-800 sm:text-xl">{title}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// Compact header used inside a card: icon + title/subtitle on the left,
// optional action buttons on the right. Keeps every screen consistent.
export function CardHeader({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="mb-2 flex flex-col flex-wrap gap-2 border-b border-ink-100 pb-1.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex shrink-0 items-center gap-2">
        {Icon && (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon size={14} />
          </div>
        )}
        <div>
          <h3 className="whitespace-nowrap text-sm font-semibold text-ink-800">{title}</h3>
          {subtitle && <p className="text-xs text-ink-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null;
  const width = size === 'lg' ? 'max-w-3xl' : size === 'xl' ? 'max-w-5xl' : 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/50 p-4 backdrop-blur-sm">
      <div className={`mt-8 w-full ${width} animate-fade-in rounded-2xl bg-white shadow-elevated`}>
        <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
          <h3 className="text-lg font-bold text-ink-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600">
            <X size={20} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading...' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-slate-400">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ message = 'No records found.' }) {
  return <div className="py-10 text-center text-sm text-slate-400">{message}</div>;
}

export function Toast({ toast }) {
  if (!toast) return null;
  const styles = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-slate-800',
  };
  return (
    <div className="fixed bottom-6 right-6 z-[60]">
      <div className={`rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${styles[toast.type] || styles.info}`}>
        {toast.message}
      </div>
    </div>
  );
}
