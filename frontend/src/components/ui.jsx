import { useLocation } from 'react-router-dom';
import { X, Inbox, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { sectionOf } from '../config/tones.js';

export function PageHeader({ title, actions }) {
  return (
    <div className="no-print mb-4 flex flex-col gap-3 border-b border-ink-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-lg font-bold tracking-tight text-ink-800 sm:text-xl">{title}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// Header used inside a card: a badge in the section's colour (the same colour
// as its main menu), the section path above the title on wider screens, the
// title and subtitle, and optional action buttons on the right. Keeps every
// screen consistent.
export function CardHeader({ icon: Icon, title, subtitle, actions }) {
  const { pathname } = useLocation();
  const section = sectionOf(pathname);
  const { tone } = section;
  const path = [section.group, ...section.trail].filter((p, i, a) => p && a.indexOf(p) === i && p !== title);
  return (
    <div className="relative mb-2.5 flex flex-col flex-wrap gap-2 border-b border-ink-100 pb-2 sm:flex-row sm:items-center sm:justify-between">
      <span className={`pointer-events-none absolute -bottom-px left-0 h-0.5 w-14 rounded-full ${tone.bar}`} />
      <div className="flex min-w-0 shrink-0 items-center gap-2.5">
        {Icon && (
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ring-4 ${tone.grad} ${tone.ring}`}>
            <Icon size={15} />
          </div>
        )}
        <div className="min-w-0">
          {path.length > 0 && (
            <p className={`hidden text-10 font-bold uppercase leading-tight tracking-[0.12em] sm:block ${tone.text}`}>{path.join(' › ')}</p>
          )}
          <h3 className="whitespace-nowrap text-15 font-bold leading-tight tracking-tight text-ink-900">{title}</h3>
          {subtitle && <p className="text-12 leading-snug text-ink-400">{subtitle}</p>}
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
      <div className={`mt-8 w-full ${width} animate-fade-in overflow-hidden rounded-2xl bg-white shadow-elevated`}>
        <div className="flex items-center justify-between border-b border-ink-100 bg-gradient-to-r from-ink-50 to-white px-6 py-4">
          <h3 className="text-lg font-bold tracking-tight text-ink-800">{title}</h3>
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
    <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-ink-400">
      <div className="relative h-8 w-8">
        <div className="absolute inset-0 rounded-full border-[3px] border-brand-100" />
        <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-transparent border-t-brand-500 border-r-teal-400" />
      </div>
      <span className="text-13 font-medium">{label}</span>
    </div>
  );
}

export function EmptyState({ message = 'No records found.' }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-2.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-ink-50 to-ink-100 text-ink-400 ring-1 ring-ink-100">
        <Inbox size={22} />
      </span>
      <p className="max-w-xs text-sm text-ink-500">{message}</p>
    </div>
  );
}

// Toasts drop in at the top on phones (clear of the Menu button in the
// bottom-right corner) and sit bottom-right on wider screens.
export function Toast({ toast }) {
  if (!toast) return null;
  const styles = {
    success: { box: 'border-emerald-200 bg-white', icon: 'bg-emerald-500', Icon: CheckCircle2 },
    error: { box: 'border-red-200 bg-white', icon: 'bg-red-500', Icon: AlertCircle },
    info: { box: 'border-ink-200 bg-white', icon: 'bg-ink-700', Icon: Info },
  };
  const s = styles[toast.type] || styles.info;
  return (
    <div className="fixed inset-x-3 top-14 z-[60] flex justify-center sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto">
      <div key={toast.message} className={`flex max-w-md items-center gap-2.5 rounded-xl border py-2 pl-2 pr-4 text-sm font-medium text-ink-800 shadow-elevated toast-in ${s.box}`}>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white ${s.icon}`}><s.Icon size={16} /></span>
        {toast.message}
      </div>
    </div>
  );
}
