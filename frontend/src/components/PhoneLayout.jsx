import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, List } from 'lucide-react';

const PHONE = '(max-width: 767px)';

// Phones: sizes a form page to the screen (between the top bar and the footer
// bar) so only its item area scrolls — when the fixed parts plus at least
// minArea px of that area fit; on a shorter screen the page scrolls normally,
// so nothing can overlap. `deps` are whatever changes the fixed parts' height.
// Put pageRef on the page, areaRef on the scrolling area and footerRef on the
// PhoneFooter; fit(...) gives each level its classes.
export function usePhoneFit(deps = [], minArea = 120) {
  const pageRef = useRef(null);
  const areaRef = useRef(null);
  const footerRef = useRef(null);
  const [fitHeight, setFitHeight] = useState(null);
  const [screenSize, setScreenSize] = useState(0);

  useEffect(() => {
    const changed = () => setScreenSize((n) => n + 1);
    const phone = window.matchMedia(PHONE);
    window.addEventListener('resize', changed);
    phone.addEventListener('change', changed);
    return () => { window.removeEventListener('resize', changed); phone.removeEventListener('change', changed); };
  }, []);

  useLayoutEffect(() => {
    const page = pageRef.current;
    const main = page?.closest('main');
    if (!page || !main || !window.matchMedia(PHONE).matches) return setFitHeight(null);
    const top = main.getBoundingClientRect().top + parseFloat(getComputedStyle(main).paddingTop);
    const footer = footerRef.current?.getBoundingClientRect().height || 0;
    const available = Math.floor(window.innerHeight - top - footer - 8);
    const fixedParts = page.scrollHeight - (areaRef.current?.offsetHeight || 0);
    setFitHeight(fixedParts + minArea <= available ? available : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenSize, ...deps]);

  const on = fitHeight != null;
  const fit = {
    page: on ? 'flex flex-col' : 'max-md:pb-14',
    pageStyle: on ? { height: fitHeight } : undefined,
    card: on ? 'flex min-h-0 flex-1 flex-col !pb-3' : '',
    form: on ? 'flex min-h-0 flex-1 flex-col' : '',
    section: on ? 'min-h-0 flex-1' : '',
    area: on ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl' : '',
  };
  return { pageRef, areaRef, footerRef, fit };
}

// Phones: a bar of buttons fixed to the bottom edge of the screen. Portaled to
// <body>, as a page's fade-in wrapper would otherwise pin it to the page.
export function PhoneFooter({ footerRef, children }) {
  return createPortal(
    <div ref={footerRef} data-phone-footer className="fixed inset-x-0 bottom-0 z-20 grid auto-cols-fr grid-flow-col gap-2 border-t border-ink-200 bg-white/95 pl-4 pr-[4.25rem] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_12px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
      {children}
    </div>,
    document.body,
  );
}

// Phones: the New Item / list tab bar (the first tab turns amber while a listed
// line is being edited).
export function PhoneTabs({ tab, onTab, editing, count, newLabel = 'New Item', editLabel = 'Edit Item', listLabel }) {
  const base = 'flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-13 font-semibold transition-colors';
  return (
    <div className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1">
      <button type="button" onClick={() => onTab('new')} className={`${base} ${tab === 'new' ? (editing ? 'bg-amber-500 text-white shadow-sm' : 'bg-white text-brand-700 shadow-sm') : 'text-ink-500'}`}>
        {editing ? <Pencil size={14} /> : <Plus size={14} />} {editing ? editLabel : newLabel}
      </button>
      <button type="button" onClick={() => onTab('list')} className={`${base} ${tab === 'list' ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500'}`}>
        <List size={14} /> {listLabel}
        <span className={`rounded-full px-1.5 text-11 ${count ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500'}`}>{count}</span>
      </button>
    </div>
  );
}
