import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Pill, ClipboardList, UserPlus, UserCheck,
  FileText, ChevronDown, ChevronRight, Stethoscope, Settings, Receipt, MessageCircle, TestTube, Sparkles, Package, Building2,
  ShoppingCart, Boxes, Store, PackagePlus, Undo2, BarChart3, Search, X, ChevronLeft, Home, LayoutGrid, Menu, SlidersHorizontal, RotateCcw,
  List, Wallet, Users, ShieldCheck, Layers, FilePlus,
} from 'lucide-react';
import { MENU_GROUPS } from '../config/menuItems.js';
import { MENU_TONE_OF, MENU_TONES } from '../config/tones.js';
import { menuAccessApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const GROUP_ICONS = {
  Dashboard: LayoutDashboard,
  Registration: UserPlus,
  Settings: Settings,
  Reports: FileText,
  Pharmacy: Package,
  Item: Package,
  Vendor: Store,
  'Purchase / Order': ShoppingCart,
  'Stock In': PackagePlus,
  Return: Undo2,
  Sales: Receipt,
  Report: BarChart3,
  Clinic: Building2,
};

// Icon per nested submenu label (any depth below the top-level group) —
// falls back to Pill when a label isn't listed here.
const SUBMENU_ICONS = {
  Medication: Pill,
  Lab: TestTube,
  Consultation: Stethoscope,
  'Patient Queue': UserCheck,
  Communication: MessageCircle,
  Billing: Receipt,
  "Coming Up's": Sparkles,
  Purchase: ShoppingCart,
  Sales: Receipt,
  Stock: Boxes,
  Item: Package,
  Vendor: Store,
  'Purchase / Order': ShoppingCart,
  'Stock In': PackagePlus,
  Return: Undo2,
  Report: BarChart3,
  Adjustment: SlidersHorizontal,
  'Purchase Return': Undo2,
  'Sales Return': RotateCcw,
};

// A leaf has `to`; a node has `submenu` (an array of further leaves/nodes,
// to any depth — e.g. Clinic > Consultation > Medication > Medication List).
function nodeIsActive(node, pathname) {
  if (node.to) return pathname === node.to;
  if (node.submenu) return node.submenu.some((c) => nodeIsActive(c, pathname));
  return false;
}

// --- Desktop: horizontal bar of group buttons, each opening a dropdown below it ---
//
// The dropdown panel is portaled to document.body instead of nesting inside
// the bar: the bar needs `overflow-x-auto` so it can scroll when the groups
// don't all fit, but CSS has no way to scroll one axis while leaving the
// other's overflow visible — the browser clips both, which squashed any
// dropdown rendered inline here down to the bar's own height. Portaling
// escapes that clip and lets the panel float freely below its button.
const DROPDOWN_WIDTH = 300; // px — wide enough for a 2-level-indented label

// Static (not interpolated) so Tailwind's scanner can see these class names.
const INDENT_LABEL = ['pl-3', 'pl-5', 'pl-7'];
const INDENT_LEAF = ['mx-1', 'ml-3 mr-1', 'ml-5 mr-1'];

function DesktopGroupButton({ item, pathname, isOpen, onToggle }) {
  const Icon = item.icon;
  const activeInGroup = item.children.some((c) => nodeIsActive(c, pathname));

  if (item.direct) {
    return (
      <NavLink
        to={item.direct}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
          activeInGroup ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
        }`}
      >
        <Icon size={16} className={activeInGroup ? 'text-teal-300' : 'text-white/50'} />
        {item.label}
      </NavLink>
    );
  }

  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
        activeInGroup || isOpen ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon size={16} className={activeInGroup ? 'text-teal-300' : 'text-white/50'} />
      {item.label}
      <ChevronDown size={13} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
    </button>
  );
}

// Recursive: a node with `submenu` renders as an always-expanded, indented
// labeled section (same visual language Medication/Lab always used); a leaf
// renders as the link. Depth clamps into INDENT_* so arbitrary nesting still
// renders sensibly even past the depths this menu actually uses.
function DesktopNode({ node, pathname, onNavigate, depth }) {
  const i = Math.min(depth, INDENT_LABEL.length - 1);

  if (node.submenu) {
    return (
      <div className="px-1">
        <p className={`${INDENT_LABEL[i]} pb-1 pt-1.5 text-11 font-semibold uppercase tracking-wide text-ink-300`}>
          {node.label}
        </p>
        {node.submenu.map((child) => (
          <DesktopNode key={child.label || child.to} node={child} pathname={pathname} onNavigate={onNavigate} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <NavLink
      to={node.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `${INDENT_LEAF[i]} block rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-600 hover:bg-ink-50'
        }`
      }
    >
      {node.label}
    </NavLink>
  );
}

// Accent per column (icon chip and top edge), cycled in order. Static class
// strings so Tailwind's scanner keeps them.
const ACCENTS = [
  { chip: 'from-blue-500 to-indigo-600', edge: 'from-blue-500 to-indigo-500' },
  { chip: 'from-teal-500 to-emerald-600', edge: 'from-teal-400 to-emerald-500' },
  { chip: 'from-violet-500 to-purple-600', edge: 'from-violet-400 to-purple-500' },
  { chip: 'from-amber-500 to-orange-600', edge: 'from-amber-400 to-orange-500' },
  { chip: 'from-rose-500 to-pink-600', edge: 'from-rose-400 to-pink-500' },
  { chip: 'from-sky-500 to-cyan-600', edge: 'from-sky-400 to-cyan-500' },
  { chip: 'from-emerald-500 to-green-600', edge: 'from-emerald-400 to-green-500' },
];

// The label with the searched-for text marked.
function Highlight({ text, query }) {
  const i = query ? text.toLowerCase().indexOf(query) : -1;
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-200/70 px-px text-inherit">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

// The nodes whose label (or a parent section's label) contains `query`;
// sections keep only their matching pages. Empty query keeps everything.
function filterByQuery(nodes, query) {
  if (!query) return nodes;
  return nodes.map((n) => {
    if (n.label.toLowerCase().includes(query)) return n;
    if (!n.submenu) return null;
    const submenu = filterByQuery(n.submenu, query);
    return submenu.length ? { ...n, submenu } : null;
  }).filter(Boolean);
}

function firstLeaf(nodes) {
  for (const n of nodes) {
    const leaf = n.submenu ? firstLeaf(n.submenu) : n;
    if (leaf) return leaf;
  }
  return null;
}

// Card width the panel aims for, and the narrowest a card may get.
const CARD_WIDTH = 168;
const CARD_MIN = 136;

// Where a popup of this width goes: under its menu button, shifted just enough
// to stay 8px inside both screen edges; as tall as the screen below it allows.
function fitToScreen(rect, width) {
  const w = Math.min(width, window.innerWidth - 16);
  const left = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, 8), window.innerWidth - w - 8);
  const top = rect.bottom + 6;
  return { position: 'fixed', top, left, width: w, maxHeight: Math.max(160, window.innerHeight - top - 12) };
}

const pageCount = (nodes) => nodes.reduce((n, c) => n + (c.submenu ? pageCount(c.submenu) : 1), 0);

// A column's pages; a nested submenu (Consultation > Medication) shows as a
// small sub-heading with a rule; its pages line up with the card's others.
function ColumnLinks({ nodes, onNavigate, query }) {
  return nodes.map((child) => (child.submenu ? (
    <div key={child.label} className="mt-1.5">
      <div className="mb-0.5 flex items-center gap-1.5 px-1.5">
        <span className="text-10 font-semibold uppercase tracking-wider text-ink-400"><Highlight text={child.label} query={query} /></span>
        <span className="h-px flex-1 bg-ink-100" />
      </div>
      <ColumnLinks nodes={child.submenu} onNavigate={onNavigate} query={query} />
    </div>
  ) : (
    <NavLink
      key={child.to || child.label}
      to={child.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group flex items-start gap-1 rounded-md px-1.5 py-[3px] text-13 leading-[18px] transition-all ${
          isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-600 hover:bg-ink-50 hover:text-brand-700'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <ChevronRight
            size={12}
            strokeWidth={2.5}
            className={`mt-[3px] shrink-0 transition-transform group-hover:translate-x-0.5 ${isActive ? 'text-brand-600' : 'text-ink-300 group-hover:text-brand-500'}`}
          />
          <span><Highlight text={child.label} query={query} /></span>
        </>
      )}
    </NavLink>
  )));
}

// A group made of several submenus (Pharmacy: Item, Vendor, Purchase / Order,
// ...; Clinic: Consultation, Patient Queue, ...) opens as a row of small cards,
// centred on the screen and wrapping to more rows when they don't fit. Each
// card is one part: an accent-coloured icon chip and title, then its pages.
// Pages sitting directly in the group (Clinic Master) form a first card
// titled with the group's own name. The search box in the header narrows the
// cards to matching pages; Enter opens the first match.
function DesktopColumnsPanel({ item, rect, panelRef, onNavigate }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const direct = item.children.filter((c) => !c.submenu);
  const parts = [
    ...(direct.length ? [{ label: item.label, icon: item.icon, submenu: direct }] : []),
    ...item.children.filter((c) => c.submenu),
  ];
  const q = query.trim().toLowerCase();
  // Each card keeps its accent colour (its index) while others are filtered out.
  const shown = parts
    .map((part, i) => ({ part: part.label.toLowerCase().includes(q) ? part : { ...part, submenu: filterByQuery(part.submenu, q) }, i }))
    .filter(({ part }) => part.submenu.length);
  const matches = shown.reduce((n, { part }) => n + pageCount(part.submenu), 0);

  // As wide as its sections need, never wider than the screen; cards share the
  // width with no gaps at the sides, fewer columns (more rows) on a narrow
  // screen, and the panel keeps its size while searching.
  const box = fitToScreen(rect, parts.length * CARD_WIDTH + 16);
  const width = box.width;
  const cols = Math.max(1, Math.min(parts.length, Math.floor((width - 16) / CARD_MIN)));

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      const leaf = firstLeaf(shown.map(({ part }) => part));
      if (leaf) { navigate(leaf.to); onNavigate(); }
    } else if (e.key === 'Escape') {
      // First Esc clears the search, the next closes the menu.
      if (query) setQuery('');
      else onNavigate();
    }
  };

  const GroupIcon = item.icon;
  return createPortal(
    <div
      ref={panelRef}
      // Placed by its left edge (not a transform, which the opening animation
      // would override and make the panel slide in sideways).
      style={box}
      className="z-50 overflow-y-auto rounded-xl border border-ink-200/70 bg-gradient-to-b from-slate-50 to-white shadow-elevated menu-drop"
    >
      <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-1.5">
        <GroupIcon size={13} className="text-brand-600" />
        <span className="text-xs font-semibold text-ink-700">{item.label}</span>
        <span className="text-11 text-ink-400">· {q ? `${matches} match${matches === 1 ? '' : 'es'}` : `${parts.length} sections`}</span>
        <div className="relative ml-auto w-56">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Search ${item.label} pages...`}
            className="h-7 w-full rounded-md border border-ink-200 bg-white pl-7 pr-6 text-xs text-ink-700 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          {query && (
            <button type="button" title="Clear" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-ink-400">No pages match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className="grid gap-1.5 p-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map(({ part, i }) => {
            const Icon = part.icon || SUBMENU_ICONS[part.label] || Pill;
            const accent = ACCENTS[i % ACCENTS.length];
            return (
              <div
                key={part.label}
                className="relative overflow-hidden rounded-lg bg-white px-2 pb-1.5 pt-2 ring-1 ring-ink-100 transition-shadow hover:shadow-md hover:ring-ink-200"
              >
                <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accent.edge}`} />
                {/* Same height on every card (room for a heading that wraps,
                    like "Purchase / Order"), so the pages line up across cards. */}
                <div className="mb-1 flex h-[34px] items-center gap-1.5 px-1.5">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-white shadow-sm ${accent.chip}`}>
                    <Icon size={13} strokeWidth={2.25} />
                  </span>
                  <span className="min-w-0 text-13 font-semibold leading-tight text-ink-800"><Highlight text={part.label} query={q} /></span>
                </div>
                <ColumnLinks nodes={part.submenu} onNavigate={onNavigate} query={q} />
              </div>
            );
          })}
        </div>
      )}
    </div>,
    document.body
  );
}

function DesktopDropdownPanel({ item, pathname, rect, panelRef, onNavigate }) {
  if (item.children.filter((c) => c.submenu).length > 1) {
    return <DesktopColumnsPanel item={item} rect={rect} panelRef={panelRef} onNavigate={onNavigate} />;
  }

  return createPortal(
    <div
      ref={panelRef}
      style={fitToScreen(rect, DROPDOWN_WIDTH)}
      className="z-50 overflow-y-auto rounded-xl border border-ink-100 bg-white py-2 shadow-elevated menu-drop"
    >
      {item.children.map((c) => (
        <DesktopNode key={c.label || c.to} node={c} pathname={pathname} onNavigate={onNavigate} depth={0} />
      ))}
    </div>,
    document.body
  );
}

// --- Mobile: same accordion tree as the old sidebar, shown as a dropdown panel ---

// Recursive: a node with `submenu` is a toggleable accordion branch (open by
// default only if it contains the active route); a leaf is the link.
function MobileNode({ node, pathname, onNavigate, depth }) {
  if (!node.submenu) {
    return (
      <NavLink
        to={node.to}
        onClick={onNavigate}
        className={({ isActive }) =>
          `relative block rounded-lg px-3 py-1.5 text-13 transition-colors ${
            isActive ? 'bg-white/10 font-semibold text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90'
          }`
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className="absolute -left-[13px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-teal-300" />}
            {node.label}
          </>
        )}
      </NavLink>
    );
  }

  const active = nodeIsActive(node, pathname);
  const [open, setOpen] = useState(active);
  const SubIcon = SUBMENU_ICONS[node.label] || Pill;

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-13 font-medium transition-colors ${
          active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90'
        }`}
      >
        <span className="flex items-center gap-2">
          <SubIcon size={14} className={active ? 'text-teal-300' : 'text-white/40'} />
          {node.label}
        </span>
        <ChevronRight size={13} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="ml-[18px] mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
          {node.submenu.map((child) => (
            <MobileNode key={child.label || child.to} node={child} pathname={pathname} onNavigate={onNavigate} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileGroupItem({ item, pathname, onNavigate }) {
  const Icon = item.icon;
  const activeInGroup = item.children.some((c) => nodeIsActive(c, pathname));
  const [open, setOpen] = useState(activeInGroup);

  if (item.direct) {
    return (
      <NavLink
        to={item.direct}
        onClick={onNavigate}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          activeInGroup ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
        }`}
      >
        <Icon size={18} className={activeInGroup ? 'text-teal-300' : 'text-white/50'} />
        {item.label}
      </NavLink>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
          activeInGroup ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
        }`}
      >
        <span className="flex items-center gap-3">
          <Icon size={18} className={activeInGroup ? 'text-teal-300' : 'text-white/50'} />
          {item.label}
        </span>
        <ChevronRight size={15} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="ml-[22px] mt-1 space-y-0.5 border-l border-white/10 pl-3 animate-slide-in">
          {item.children.map((c) => (
            <MobileNode key={c.label || c.to} node={c} pathname={pathname} onNavigate={onNavigate} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}

// Recursive: prune a node (and its whole branch) when nothing in it is
// allowed; keep a submenu node only if at least one descendant survives.
function filterNode(node, allowed) {
  if (node.submenu) {
    const submenu = node.submenu.map((c) => filterNode(c, allowed)).filter(Boolean);
    return submenu.length ? { label: node.label, submenu } : null;
  }
  return allowed(node.key) ? { label: node.label, to: node.to } : null;
}

// `open` controls visibility on both breakpoints: the horizontal bar on
// desktop, and the dropdown accordion panel on mobile — one hamburger
// toggle in the header drives both via this single prop.
// The signed-in user's menu: MENU_GROUPS less what their Menu Access hides.
// A user who has never been configured in Menu Access sees everything, as before.
// Once an admin has saved any access for them, only items granted Full/View show —
// anything not explicitly granted (including menus added after their last save) is hidden.
function useMenu() {
  const { user } = useAuth();
  const [access, setAccess] = useState(null); // null = not loaded yet; Map of menuKey -> AccessLevel

  useEffect(() => {
    if (!user?.userId) return;
    menuAccessApi.get(user.userId)
      .then((rows) => setAccess(new Map(rows.map((r) => [r.MenuKey, r.AccessLevel]))))
      .catch(() => setAccess(new Map()));
  }, [user?.userId]);

  return useMemo(() => {
    const configured = access && access.size > 0;
    const allowed = (key) => !configured || ['Full', 'View'].includes(access.get(key));
    return MENU_GROUPS.map((g) => {
      const children = g.items.map((it) => filterNode(it, allowed)).filter(Boolean);
      const only = children.length === 1 && !children[0].submenu && children[0].label === g.group ? children[0] : null;
      return { type: 'group', label: g.group, icon: GROUP_ICONS[g.group] || ClipboardList, children, direct: only?.to || null };
    }).filter((g) => g.children.length > 0);
  }, [access]);
}

// Every page under the given nodes as { trail, label, to }, for the sidebar
// search (trail = the submenu labels above it).
function leavesOf(nodes, trail = []) {
  return nodes.flatMap((c) => (c.submenu
    ? leavesOf(c.submenu, [...trail, c.label])
    : [{ trail, label: c.label, to: c.to }]));
}

// Desktop left-side menu (the header's menu button moves the menu here and
// back): the same groups as the top bar, as an accordion in a fixed column.
// The search box on top lists the matching pages instead ("Stock In ›
// Adjustment"); ↑ / ↓ pick one, Enter opens it, Esc clears the search.
export function SideNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const menu = useMenu();
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState(0);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) return [];
    return menu.flatMap((item) => leavesOf(item.children).map((p) => ({ ...p, group: item.label, icon: item.icon })))
      .map((p) => ({ ...p, title: p.label === p.group ? p.label : `${p.group} › ${[...p.trail, p.label].join(' › ')}` }))
      .filter((p) => p.title.toLowerCase().includes(q));
  }, [menu, q]);
  useEffect(() => { setPick(0); }, [q]);

  const open = (to) => { setQuery(''); navigate(to); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setPick((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPick((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[pick]) { e.preventDefault(); open(results[pick].to); }
    else if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); }
  };

  return (
    <aside className="no-print no-scrollbar hidden w-56 shrink-0 overflow-y-auto bg-sidebar-gradient shadow-sm animate-slide-in lg:block">
      <div className="sticky top-0 z-10 bg-[#1d306e] px-2 pb-1 pt-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-white/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search menu..."
            aria-label="Search menu"
            className="w-full rounded-lg border border-white/15 bg-white/10 py-1.5 pl-8 pr-7 text-13 text-white placeholder-white/40 outline-none transition-colors focus:border-teal-300/60 focus:bg-white/15"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/50 hover:text-white">
              <X size={13} />
            </button>
          )}
        </div>
      </div>
      {q ? (
        <nav className="space-y-0.5 px-2 py-1">
          {results.length === 0 && <p className="px-3 py-2 text-13 text-white/50">No matching pages.</p>}
          {results.map((r, i) => {
            const Icon = r.icon;
            const current = pathname === r.to;
            return (
              <button
                key={r.to}
                onClick={() => open(r.to)}
                onMouseEnter={() => setPick(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-13 transition-colors ${
                  i === pick ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'
                } ${current ? 'font-semibold' : ''}`}
              >
                <Icon size={15} className="shrink-0 text-white/50" />
                <span className="min-w-0"><Highlight text={r.title} query={q} /></span>
              </button>
            );
          })}
        </nav>
      ) : (
        <nav className="space-y-0.5 px-2 py-1">
          {menu.map((item) => (
            <MobileGroupItem key={item.label} item={item} pathname={pathname} onNavigate={() => {}} />
          ))}
        </nav>
      )}
    </aside>
  );
}

// Phones and tablets: a round Menu button in the bottom-right corner (inside
// the right end of a page's bottom bar when it has one). It opens a panel that
// starts at the main menus; picking one shows only its child menus, and a
// child with its own submenu opens the next level. Back goes up one level and
// Main Menu returns to the top. Picking a page opens it and closes the panel.
// Each main menu has its own colour, carried down into its child levels; the
// panel springs out of the button, rows slide in one after another, and levels
// slide sideways (forward from the right, back from the left).
// Icons for single pages in the phone menu (by label; lists get a list icon).
const PAGE_ICONS = {
  Payments: Wallet, 'Vendor Payments': Wallet, 'Stock Report': BarChart3, 'All in One': LayoutGrid,
  'Bulk Update': Layers, 'Pharmacy Details': Store, 'User Master': Users, 'Menu Access': ShieldCheck,
};
const pageIcon = (label) => PAGE_ICONS[label] || (/list/i.test(label) ? List : FilePlus);
const childPreview = (nodes) => nodes.map((n) => n.label).join(' · ');

export function MobileMenu() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const menu = useMenu();
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState([]); // the menus drilled into, top first
  const [dir, setDir] = useState('fwd'); // which way the last level change went
  const [bottom, setBottom] = useState(16);
  const fabRef = useRef(null);

  // Sit in the middle of the right end of a page's bottom bar, if it has one.
  useEffect(() => {
    let ro = null;
    let watched = null;
    const place = () => {
      const bar = document.querySelector('[data-phone-footer]');
      const shown = bar && getComputedStyle(bar).display !== 'none';
      if (bar !== watched) {
        ro?.disconnect();
        ro = bar && window.ResizeObserver ? new ResizeObserver(place) : null;
        ro?.observe(bar);
        watched = bar;
      }
      const h = fabRef.current?.offsetHeight || 44;
      setBottom(shown ? Math.max(4, (bar.offsetHeight - h) / 2) : 16);
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(document.body, { childList: true });
    window.addEventListener('resize', place);
    return () => { mo.disconnect(); ro?.disconnect(); window.removeEventListener('resize', place); };
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => { setTrail([]); setDir('fwd'); setOpen((o) => !o); };
  const goTo = (next, direction) => { setDir(direction); setTrail(next); };
  const current = trail[trail.length - 1];
  const items = current ? (current.children || current.submenu) : menu;
  const pick = (node) => {
    if (node.direct) navigate(node.direct);
    else if (node.children || node.submenu) goTo([...trail, node], 'fwd');
    else if (node.to) navigate(node.to);
  };
  const levelTone = trail[0] ? MENU_TONES[MENU_TONE_OF[trail[0].label] || 'brand'] : null;
  const HeadIcon = current ? (current.icon || SUBMENU_ICONS[current.label] || trail[0]?.icon || LayoutGrid) : LayoutGrid;

  return createPortal(
    <div className="no-print lg:hidden">
      {open && <div className="fixed inset-0 z-40 bg-ink-900/45 backdrop-blur-[3px] menu-fade" onClick={() => setOpen(false)} />}

      {open && (
        <div
          className="fixed right-3 z-50 flex max-h-[72vh] w-[min(20.5rem,calc(100vw-1.5rem))] origin-bottom-right flex-col overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-12px_rgba(15,23,42,0.45)] ring-1 ring-black/5 menu-pop"
          style={{ bottom: bottom + (fabRef.current?.offsetHeight || 44) + 12 }}
          role="dialog" aria-label="Menu"
        >
          {/* Header: gradient with soft rings; title and path change per level. */}
          <div className="relative overflow-hidden bg-sidebar-gradient px-3.5 pb-3 pt-3 text-white">
            <span className="pointer-events-none absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/10" />
            <span className="pointer-events-none absolute -bottom-12 right-16 h-24 w-24 rounded-full bg-white/5" />
            <div key={`h${trail.length}`} className="relative flex items-center gap-2.5 menu-title-in">
              {current ? (
                <button type="button" onClick={() => goTo(trail.slice(0, -1), 'back')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 transition-colors hover:bg-white/25 active:scale-95" aria-label="Back" title="Back">
                  <ChevronLeft size={18} />
                </button>
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15"><HeadIcon size={17} /></span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-15 font-bold leading-tight tracking-tight">{current ? current.label : 'Main Menu'}</p>
                <p className="truncate text-11 text-white/70">
                  {current ? ['Main Menu', ...trail.slice(0, -1).map((t) => t.label)].join(' › ') : `Hi ${user?.username || 'there'} · where to next?`}
                </p>
              </div>
              {current && (
                <button type="button" onClick={() => goTo([], 'back')} className="flex shrink-0 items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-11 font-bold text-brand-800 shadow-sm transition-transform hover:-translate-y-0.5 active:scale-95" title="Back to the main menu">
                  <Home size={13} /> Main Menu
                </button>
              )}
            </div>
            {/* Level dots: where you are in the menu. */}
            <div className="relative mt-2.5 flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-1 rounded-full transition-all duration-300 ${i === trail.length ? 'w-5 bg-white' : i < trail.length ? 'w-2 bg-white/70' : 'w-2 bg-white/25'}`} />
              ))}
            </div>
          </div>

          <nav key={trail.map((t) => t.label).join('/') || 'root'} className={`no-scrollbar flex-1 overflow-y-auto p-2 ${dir === 'back' ? 'menu-slide-back' : 'menu-slide-fwd'}`}>
            {items.map((node, i) => {
              const drill = !node.direct && !!(node.children || node.submenu);
              const active = node.direct ? pathname === node.direct : nodeIsActive(node.children ? { submenu: node.children } : node, pathname);
              const tone = levelTone || MENU_TONES[MENU_TONE_OF[node.label] || 'brand'];
              const Icon = node.icon || (drill ? SUBMENU_ICONS[node.label] || trail[0]?.icon || ClipboardList : pageIcon(node.label));
              const kids = drill ? (node.children || node.submenu) : null;
              return (
                <button
                  key={node.label} type="button" onClick={() => pick(node)}
                  style={{ animationDelay: `${40 + i * 35}ms` }}
                  className={`group relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors menu-item-in ${active ? tone.soft : 'hover:bg-ink-50 active:bg-ink-100'}`}
                >
                  {active && <span className={`absolute inset-y-2 left-0 w-1 rounded-r-full ${tone.bar}`} />}
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-200 group-hover:scale-105 group-active:scale-95 ${active ? tone.solid : tone.chip}`}>
                    <Icon size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm leading-tight ${active ? `font-bold ${tone.text}` : 'font-semibold text-ink-800'}`}>{node.label}</span>
                    {kids && <span className="mt-0.5 block truncate text-11 text-ink-400">{childPreview(kids)}</span>}
                    {!kids && active && <span className={`mt-0.5 block text-11 font-semibold ${tone.text}`}>You are here</span>}
                  </span>
                  {kids ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="rounded-full bg-ink-100 px-1.5 text-10 font-bold leading-4 text-ink-500">{pageCount(kids)}</span>
                      <ChevronRight size={16} className="text-ink-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink-500" />
                    </span>
                  ) : (
                    <ChevronRight size={15} className={`shrink-0 transition-all duration-200 ${active ? 'text-ink-400' : 'text-transparent group-hover:translate-x-0.5 group-hover:text-ink-300'}`} />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      )}

      <button
        ref={fabRef} type="button" onClick={toggle}
        className={`fixed right-3 z-50 flex h-11 w-11 items-center justify-center rounded-full text-white shadow-[0_8px_20px_-4px_rgba(37,99,235,0.55)] ring-4 ring-white/80 transition-all duration-300 active:scale-90 ${open ? 'bg-ink-800' : 'bg-brand-gradient hover:scale-105'}`}
        style={{ bottom }}
        aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} title="Menu"
      >
        {!open && <span className="pointer-events-none absolute inset-0 rounded-full bg-brand-400/50 fab-halo" />}
        <Menu size={20} className={`absolute transition-all duration-300 ${open ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}`} />
        <X size={20} className={`absolute transition-all duration-300 ${open ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'}`} />
      </button>
    </div>,
    document.body,
  );
}

// `side`: the menu sits in SideNav on desktop, so the top bar is left out
// there (the mobile dropdown still works as before).
export default function TopNav({ open, side = false }) {
  const { pathname } = useLocation();
  const [openGroup, setOpenGroup] = useState(null);
  const [openRect, setOpenRect] = useState(null);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const navRowRef = useRef(null);
  const openBtnRef = useRef(null);

  // Close the open dropdown on an outside click (checking both the bar — for
  // its buttons — and the portaled panel, which lives outside the bar's DOM
  // subtree), on route change, or when the menu bar scrolls. A window resize
  // keeps it open and re-fits it to the new screen size.
  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpenGroup(null);
    };
    const onResize = () => {
      const btn = openBtnRef.current;
      if (btn?.isConnected && btn.offsetParent) setOpenRect(btn.getBoundingClientRect());
      else setOpenGroup(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  useEffect(() => { setOpenGroup(null); }, [pathname]);
  useEffect(() => { if (!open) setOpenGroup(null); }, [open]);

  function closeDropdown() { setOpenGroup(null); }

  function toggleGroup(label, e) {
    if (openGroup === label) { setOpenGroup(null); return; }
    openBtnRef.current = e.currentTarget;
    setOpenRect(e.currentTarget.getBoundingClientRect());
    setOpenGroup(label);
  }

  const menu = useMenu();

  const handleDesktopNavigate = () => setOpenGroup(null);
  const openItem = openGroup ? menu.find((m) => m.label === openGroup) : null;

  return (
    <div ref={wrapRef} className="relative">
      {/* Desktop: horizontal bar */}
      {!side && <nav
        ref={navRowRef}
        onScroll={closeDropdown}
        className={`no-scrollbar hidden items-center gap-1 overflow-x-auto bg-sidebar-gradient px-4 shadow-sm transition-all duration-200 lg:flex lg:px-6 ${
          open ? 'max-h-10 py-1 opacity-100' : 'pointer-events-none max-h-0 overflow-hidden py-0 opacity-0'
        }`}
      >
        {menu.map((item) => (
          <DesktopGroupButton
            key={item.label}
            item={item}
            pathname={pathname}
            isOpen={openGroup === item.label}
            onToggle={(e) => toggleGroup(item.label, e)}
          />
        ))}
      </nav>}

      {!side && openItem && openRect && (
        <DesktopDropdownPanel item={openItem} pathname={pathname} rect={openRect} panelRef={panelRef} onNavigate={handleDesktopNavigate} />
      )}

      {/* Phones and tablets use the Menu button in the bottom-right corner (MobileMenu). */}
    </div>
  );
}
