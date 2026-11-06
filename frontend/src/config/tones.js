import { MENU_GROUPS } from './menuItems.js';

// One colour per main menu, used by the phone menu and by every screen's card
// header, so a section looks the same wherever it appears. Full class names
// (not built from parts) so Tailwind keeps them.
export const MENU_TONE_OF = {
  Dashboard: 'brand', Item: 'violet', Vendor: 'amber', 'Purchase / Order': 'sky', 'Stock In': 'emerald',
  Return: 'rose', Sales: 'teal', Report: 'indigo', Settings: 'slate',
};

export const MENU_TONES = {
  brand: { chip: 'bg-brand-50 text-brand-600', solid: 'bg-brand-600 text-white', soft: 'bg-brand-50', bar: 'bg-brand-500', text: 'text-brand-700', grad: 'from-brand-500 to-brand-700', ring: 'ring-brand-100' },
  violet: { chip: 'bg-violet-50 text-violet-600', solid: 'bg-violet-600 text-white', soft: 'bg-violet-50', bar: 'bg-violet-500', text: 'text-violet-700', grad: 'from-violet-500 to-violet-700', ring: 'ring-violet-100' },
  amber: { chip: 'bg-amber-50 text-amber-600', solid: 'bg-amber-500 text-white', soft: 'bg-amber-50', bar: 'bg-amber-500', text: 'text-amber-700', grad: 'from-amber-400 to-amber-600', ring: 'ring-amber-100' },
  sky: { chip: 'bg-sky-50 text-sky-600', solid: 'bg-sky-600 text-white', soft: 'bg-sky-50', bar: 'bg-sky-500', text: 'text-sky-700', grad: 'from-sky-500 to-sky-700', ring: 'ring-sky-100' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600', solid: 'bg-emerald-600 text-white', soft: 'bg-emerald-50', bar: 'bg-emerald-500', text: 'text-emerald-700', grad: 'from-emerald-500 to-emerald-700', ring: 'ring-emerald-100' },
  rose: { chip: 'bg-rose-50 text-rose-600', solid: 'bg-rose-600 text-white', soft: 'bg-rose-50', bar: 'bg-rose-500', text: 'text-rose-700', grad: 'from-rose-500 to-rose-700', ring: 'ring-rose-100' },
  teal: { chip: 'bg-teal-50 text-teal-600', solid: 'bg-teal-600 text-white', soft: 'bg-teal-50', bar: 'bg-teal-500', text: 'text-teal-700', grad: 'from-teal-500 to-teal-700', ring: 'ring-teal-100' },
  indigo: { chip: 'bg-indigo-50 text-indigo-600', solid: 'bg-indigo-600 text-white', soft: 'bg-indigo-50', bar: 'bg-indigo-500', text: 'text-indigo-700', grad: 'from-indigo-500 to-indigo-700', ring: 'ring-indigo-100' },
  slate: { chip: 'bg-slate-100 text-slate-600', solid: 'bg-slate-700 text-white', soft: 'bg-slate-100', bar: 'bg-slate-500', text: 'text-slate-700', grad: 'from-slate-500 to-slate-700', ring: 'ring-slate-200' },
};

const leaves = (items, trail) => items.flatMap((it) => (it.submenu ? leaves(it.submenu, [...trail, it.label]) : [{ ...it, trail }]));
const PAGE_SECTION = new Map(
  MENU_GROUPS.flatMap((g) => leaves(g.items, []).map((p) => [p.to, { group: g.group, trail: p.trail, label: p.label }])),
);

// The menu section a page belongs to: { group, trail, label, tone }.
export function sectionOf(pathname) {
  const s = PAGE_SECTION.get(pathname);
  const group = s?.group || 'Dashboard';
  return { group, trail: s?.trail || [], label: s?.label || '', tone: MENU_TONES[MENU_TONE_OF[group] || 'brand'] };
}
