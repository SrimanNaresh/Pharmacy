import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera, FileUp, ScanLine, Plus, Trash2, RotateCcw, RotateCw,
  ChevronLeft, ChevronRight, Crop, ArrowLeft, Sparkles, ZoomIn, ZoomOut, Hand, SquareDashedMousePointer,
} from 'lucide-react';
import { Modal } from '../../components/ui.jsx';
import { itemMasterApi } from '../../api/client.js';
import { emptyForm } from './ItemForm.jsx';
import { buildIndex, compact, extractItems, matchName } from '../../utils/billScan.js';
import { gridKeys } from '../../components/grid/gridKeys.js';

// Item Master > Scan Bill: add a supplier bill's new items to Item Master.
//  1. Upload a photo / PDF of the bill (or take a photo on a phone).
//  2. The bill is shown, turned upright; drag a box around the Item
//     Description column and only that part is read (OCR, in the browser).
//  3. The names found are listed in tabs:
//     - New items: will be added (Add button at the end of the list)
//     - Similar: close to an existing item and matched to it — pick
//       "Add as a new item" in its dropdown if it's really a different item
//     - Already exists: the same name is in Item Master — skipped
// Each tab is a grid like the Purchase Order item grid. Only the item name is
// saved here; fill in the rest (pack, MRP, GST...) from the Item List.

let nextId = 1;
const newRow = (name) => ({ id: nextId++, name, include: true, choice: null, result: null });
const NEW = 'new';
const code = (it) => it.ItemCode || `ITM${String(it.ItemId).padStart(6, '0')}`;
const MIN_BOX = 0.02; // a selection smaller than this (share of the page) is a slip, not a box

export default function ScanBillModal({ open, onClose, onAdded }) {
  const [items, setItems] = useState([]);
  // Matching needs the item list: until it's loaded nothing can be read or
  // added, or every line would look new.
  const [itemsReady, setItemsReady] = useState(false);
  const [step, setStep] = useState('pick'); // pick | select | review
  const [fileName, setFileName] = useState('');
  const [pages, setPages] = useState([]); // page pictures (canvases), turned upright
  const [pageNo, setPageNo] = useState(0);
  const [box, setBox] = useState(null); // selected area { x, y, w, h } as shares of the page
  const [zoom, setZoom] = useState(1); // preview size: 1 = fit, 2, 3
  const [moving, setMoving] = useState(false); // zoomed in: drag pans the bill instead of drawing a box
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState('new');
  const [rawText, setRawText] = useState('');
  const [busy, setBusy] = useState(null); // { stage, percent } while working
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState('');
  const photoRef = useRef(null);
  const fileRef = useRef(null);
  const ocrRef = useRef(null); // Tesseract reader, made on first use

  const loadItems = useCallback(() => itemMasterApi.list().then((list) => { setItems(list); setItemsReady(true); }), []);

  const reset = () => {
    setStep('pick'); setFileName(''); setPages([]); setPageNo(0); setBox(null); setZoom(1); setMoving(false); setRows([]); setTab('new');
    setRawText(''); setError(''); setSummary(''); setBusy(null);
  };

  useEffect(() => {
    if (!open) return undefined;
    reset();
    setItemsReady(false);
    loadItems().catch(() => setError("Couldn't load the item list, so bill lines can't be checked against it — close this and try again"));
    return () => {
      // Free the OCR reader when the popup closes.
      const ocr = ocrRef.current;
      ocrRef.current = null;
      ocr?.then((o) => o.done()).catch(() => {});
    };
  }, [open, loadItems]);

  const getOcr = async () => {
    if (!ocrRef.current) {
      setBusy({ stage: 'Getting the text reader ready (the first time can take a moment)', percent: null });
      ocrRef.current = import('../../utils/billOcr.js').then((m) => m.createOcr());
      ocrRef.current.catch(() => { ocrRef.current = null; });
    }
    return ocrRef.current;
  };

  const index = useMemo(() => buildIndex(items), [items]);

  // Each row with its match, what happens to it and which tab it's on.
  const view = useMemo(() => {
    const seen = new Map();
    return rows.map((r, i) => {
      const key = compact(r.name);
      const m = matchName(r.name, index);
      let status;
      if (r.result?.added) status = 'added';
      else if (!key) status = 'empty';
      else if (seen.has(key)) status = 'dup';
      else if (m.exact) status = 'exists';
      else if (m.similar.length) status = 'similar';
      else status = 'new';
      if (key && !seen.has(key)) seen.set(key, i + 1);
      const choice = r.choice ?? (m.likely ? m.likely.ItemId : NEW);
      const asNew = status === 'new' || status === 'empty' || (status === 'similar' && choice === NEW);
      // Saved rows move to Already Exists (with their new code).
      const tabOf = status === 'added' ? 'exists' : asNew ? 'new' : status === 'similar' ? 'similar' : 'exists';
      const willAdd = r.include && asNew && status !== 'empty';
      return { ...r, m, status, choice, willAdd, tab: tabOf, dupOf: seen.get(key) };
    });
  }, [rows, index]);

  const counts = useMemo(() => {
    const c = { new: 0, similar: 0, exists: 0, add: 0, added: 0 };
    for (const v of view) {
      c[v.tab] += 1;
      if (v.willAdd) c.add += 1;
      if (v.status === 'added') c.added += 1;
    }
    return c;
  }, [view]);

  const update = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, result: patch.result ?? (r.result?.added ? r.result : null) } : r)));
  const remove = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addAfter = (id) => setRows((rs) => {
    const i = rs.findIndex((r) => r.id === id);
    return [...rs.slice(0, i + 1), newRow(''), ...rs.slice(i + 1)];
  });

  // 1. A bill was chosen: show it, turned upright.
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    setFileName(file.name);
    try {
      setBusy({ stage: 'Opening the bill', percent: null });
      const { loadBillPages } = await import('../../utils/billOcr.js');
      const loaded = await loadBillPages(file);
      const ocr = await getOcr();
      setBusy({ stage: 'Turning the bill the right way up', percent: null });
      const { rotateCanvas } = await import('../../utils/billOcr.js');
      const upright = [];
      for (const p of loaded) upright.push(rotateCanvas(p, await ocr.uprightAngle(p)));
      setPages(upright);
      setStep('select');
    } catch (err) {
      setError(err.message || "Couldn't open this bill");
      setStep('pick');
    } finally {
      setBusy(null);
    }
  };

  const rotate = async (deg) => {
    const { rotateCanvas } = await import('../../utils/billOcr.js');
    setPages((ps) => ps.map((p, i) => (i === pageNo ? rotateCanvas(p, deg) : p)));
    setBox(null);
  };

  // 2. Read the selected column (or the whole page) and add what's found to the list.
  const read = async (whole) => {
    setError(''); setSummary('');
    try {
      const ocr = await getOcr();
      setBusy({ stage: whole ? 'Reading the whole page' : 'Reading the selected column', percent: 0 });
      const { text, layout } = await ocr.read(pages[pageNo], whole ? null : box, (percent) => setBusy((b) => (b ? { ...b, percent } : b)));
      setRawText((t) => (t ? `${t}\n\n` : '') + text.trim());
      const found = extractItems(text, layout, { column: !whole });
      if (!found.length) {
        setError(whole
          ? 'No item lines were found on this page. Select just the Item Description column instead.'
          : 'No item names were read from the selected part. Make the box cover the item names from the first row to the last.');
        return;
      }
      const have = new Set(rows.map((r) => compact(r.name)));
      const added = found.filter((f) => !have.has(compact(f.name))).map((f) => newRow(f.name));
      setRows((rs) => [...rs, ...added]);
      setTab('new');
      setStep('review');
      if (rows.length) setSummary(`${added.length} more line${added.length === 1 ? '' : 's'} read from the bill`);
    } catch (err) {
      setError(err.message || "Couldn't read this bill");
    } finally {
      setBusy(null);
    }
  };

  // 3. Save the new items.
  const addItems = async () => {
    const todo = view.filter((v) => v.willAdd);
    for (const v of todo) {
      if (v.name.trim().length > 200) return setError(`"${v.name.slice(0, 30)}...": Item Name must be at most 200 characters`);
    }
    setSaving(true); setError(''); setSummary('');
    let ok = 0;
    let failed = 0;
    for (const v of todo) {
      try {
        const r = await itemMasterApi.create({ ...emptyForm, name: v.name.trim() });
        update(v.id, { result: { added: true, code: r.ItemCode } });
        ok += 1;
      } catch (err) {
        update(v.id, { result: { error: err.response?.data?.error || 'Save failed' } });
        failed += 1;
      }
    }
    await loadItems().catch(() => {});
    setSaving(false);
    setSummary(`${ok} item${ok === 1 ? '' : 's'} added to Item Master${failed ? ` · ${failed} failed — see the red rows` : ''}`);
    if (!failed) setTab('exists');
    if (ok) onAdded?.(ok);
  };

  const working = Boolean(busy) || saving;
  const page = pages[pageNo];
  const tabRows = view.filter((v) => v.tab === tab);

  return (
    <Modal open={open} onClose={working ? () => {} : onClose} size="xl" title="Scan Purchase Bill">
      <div className="space-y-3">
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={onFile} />

        <Steps step={step} />

        {/* Step 1: pick the bill */}
        {step === 'pick' && !busy && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-brand-200 bg-brand-50/40 px-4 py-8 text-center">
            <ScanLine size={28} className="text-brand-500" />
            <div className="text-sm text-ink-600">
              <p className="font-semibold text-ink-800">Upload the supplier&apos;s bill</p>
              <p className="text-xs">A photo (JPG / PNG) or a PDF. Next you&apos;ll mark the Item Description column on it.</p>
            </div>
            <div className="flex w-full max-w-sm gap-2">
              <button type="button" className="btn-secondary min-w-0 flex-1 whitespace-nowrap px-2 sm:hidden" disabled={!itemsReady} onClick={() => photoRef.current?.click()}>
                <Camera size={16} /> Take Photo
              </button>
              <button type="button" className="btn-primary min-w-0 flex-1 whitespace-nowrap px-2" disabled={!itemsReady} onClick={() => fileRef.current?.click()}>
                <FileUp size={16} /> {itemsReady ? 'Upload Photo / PDF' : 'Loading items...'}
              </button>
            </div>
          </div>
        )}

        {busy && <Progress busy={busy} />}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
        {summary && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{summary}</p>}

        {/* Step 2: preview, select the Item Description column */}
        {step === 'select' && page && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-600">
                <b className="text-ink-800">Drag a box around the Item Description column</b> — from the first item name to the last. Only that part is read.
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {pages.length > 1 && (
                  <>
                    <button type="button" className="btn-ghost px-1.5 py-1" disabled={working || pageNo === 0} title="Previous page" onClick={() => { setPageNo((n) => n - 1); setBox(null); }}><ChevronLeft size={16} /></button>
                    <span className="text-xs tabular-nums text-ink-500">Page {pageNo + 1} / {pages.length}</span>
                    <button type="button" className="btn-ghost px-1.5 py-1" disabled={working || pageNo === pages.length - 1} title="Next page" onClick={() => { setPageNo((n) => n + 1); setBox(null); }}><ChevronRight size={16} /></button>
                    <span className="mx-1 h-4 w-px bg-ink-200" />
                  </>
                )}
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={working} title="Turn left" onClick={() => rotate(270)}><RotateCcw size={16} /></button>
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={working} title="Turn right" onClick={() => rotate(90)}><RotateCw size={16} /></button>
                <span className="mx-1 h-4 w-px bg-ink-200" />
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={zoom === 1} title="Zoom out" onClick={() => { const z = zoom - 1; setZoom(z); if (z === 1) setMoving(false); }}><ZoomOut size={16} /></button>
                <span className="w-7 text-center text-xs tabular-nums text-ink-500">{zoom}×</span>
                <button type="button" className="btn-ghost px-1.5 py-1" disabled={zoom === 3} title="Zoom in" onClick={() => setZoom((z) => z + 1)}><ZoomIn size={16} /></button>
                {zoom > 1 && (
                  <div className="ml-1 flex overflow-hidden rounded-lg border border-ink-200 text-xs font-semibold">
                    <button type="button" className={`flex items-center gap-1 px-2 py-1 ${moving ? 'bg-brand-600 text-white' : 'text-ink-500'}`} title="Drag to move around the bill" onClick={() => setMoving(true)}><Hand size={14} /> Move</button>
                    <button type="button" className={`flex items-center gap-1 px-2 py-1 ${!moving ? 'bg-brand-600 text-white' : 'text-ink-500'}`} title="Drag to mark the column" onClick={() => setMoving(false)}><SquareDashedMousePointer size={14} /> Select</button>
                  </div>
                )}
              </div>
            </div>

            <BoxSelect page={page} box={box} onBox={setBox} disabled={working} zoom={zoom} moving={moving} />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" disabled={working} onClick={() => fileRef.current?.click()}>
                  <FileUp size={16} /> Another Bill
                </button>
                {rows.length > 0 && (
                  <button type="button" className="btn-secondary" disabled={working} onClick={() => setStep('review')}>
                    <ArrowLeft size={16} /> Back to List
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" disabled={working} onClick={() => read(true)} title="Read the whole page and pick out the item lines">
                  <Sparkles size={16} /> Read Whole Page
                </button>
                <button type="button" className="btn-primary" disabled={working || !box} onClick={() => read(false)}>
                  <Crop size={16} /> {box ? 'Read Selected Column' : 'Select the column first'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: the items, in tabs */}
        {step === 'review' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="truncate text-xs text-ink-500">From <b className="text-ink-700">{fileName}</b> · {rows.length} line{rows.length === 1 ? '' : 's'} read</p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary px-3 text-xs" disabled={working || !pages.length} onClick={() => { setBox(null); setSummary(''); setError(''); setStep('select'); }}>
                  <Crop size={14} /> Read More From Bill
                </button>
                <button type="button" className="btn-secondary px-3 text-xs" disabled={working} onClick={() => fileRef.current?.click()}>
                  <FileUp size={14} /> Another Bill
                </button>
              </div>
            </div>

            <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink-100 no-scrollbar">
              {[
                ['new', 'New Items', counts.new, 'text-brand-700'],
                ['similar', 'Similar · Matched', counts.similar, 'text-amber-700'],
                ['exists', 'Already Exists', counts.exists, 'text-ink-500'],
              ].map(([key, label, n, tone]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === key ? `border-brand-600 ${tone}` : 'border-transparent text-ink-400 hover:text-ink-600'}`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 text-[11px] ${tab === key ? 'bg-brand-50' : 'bg-ink-100'}`}>{n}</span>
                </button>
              ))}
            </div>

            <p className="text-[11px] text-ink-500">
              {tab === 'new' && 'These will be added to Item Master. Check the names (OCR can misread digits) and delete any row you don\'t want.'}
              {tab === 'similar' && 'Each of these looks like an item you already have, so it is skipped. If one is really a different item, pick "Not the same — add as a new item" in its Matched to list — it moves to New Items.'}
              {tab === 'exists' && 'Already in Item Master — skipped.'}
            </p>

            <ItemGrid tab={tab} rows={tabRows} disabled={working} update={update} remove={remove} addAfter={addAfter} />

            {tab === 'new' && (
              <div className="flex justify-end pt-1">
                <button type="button" className="btn-primary" disabled={working || !itemsReady || counts.add === 0} onClick={addItems}>
                  <Plus size={16} /> {saving ? 'Adding...' : `Add ${counts.add} New Item${counts.add === 1 ? '' : 's'}`}
                </button>
              </div>
            )}

            {rawText && (
              <details className="rounded-lg border border-ink-100 px-3 py-2 text-xs text-ink-500">
                <summary className="cursor-pointer font-medium">Text read from the bill</summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-600">{rawText}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Steps({ step }) {
  const all = [['pick', 'Upload'], ['select', 'Select column'], ['review', 'Review & add']];
  const at = all.findIndex(([k]) => k === step);
  return (
    <ol className="flex items-center gap-2 text-[11px] font-semibold">
      {all.map(([k, label], i) => (
        <li key={k} className={`flex items-center gap-1.5 ${i <= at ? 'text-brand-700' : 'text-ink-400'}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i < at ? 'bg-brand-600 text-white' : i === at ? 'border-2 border-brand-600' : 'border border-ink-300'}`}>{i + 1}</span>
          <span className={i === at ? '' : 'max-sm:hidden'}>{label}</span>
          {i < all.length - 1 && <span className="mx-1 h-px w-5 bg-ink-200" />}
        </li>
      ))}
    </ol>
  );
}

function Progress({ busy }) {
  return (
    <div className="rounded-xl border border-ink-100 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink-600">
        <ScanLine size={14} className="animate-pulse text-brand-600" /> {busy.stage}
        {busy.percent != null && <span className="ml-auto tabular-nums">{busy.percent}%</span>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          className={`h-full rounded-full bg-brand-500 transition-all ${busy.percent == null ? 'w-1/3 animate-pulse' : ''}`}
          style={busy.percent != null ? { width: `${busy.percent}%` } : undefined}
        />
      </div>
    </div>
  );
}

// The bill picture; drag on it (mouse or finger) to mark the area to read.
// box / onBox use shares of the picture (0..1), so they don't depend on its
// size on screen. zoom > 1 shows it larger in a scrolling box; while `moving`,
// a drag scrolls the bill (a finger pans) instead of drawing.
function BoxSelect({ page, box, onBox, disabled, zoom = 1, moving = false }) {
  const url = useMemo(() => page.toDataURL('image/jpeg', 0.85), [page]);
  const wrap = useRef(null);
  const start = useRef(null);
  const [draft, setDraft] = useState(null);

  const at = (e) => {
    const r = wrap.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  const down = (e) => {
    if (disabled || moving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = at(e);
    setDraft({ ...start.current, w: 0, h: 0 });
  };
  const move = (e) => { if (start.current) setDraft(rectOf(start.current, at(e))); };
  const up = (e) => {
    if (!start.current) return;
    const r = rectOf(start.current, at(e));
    start.current = null;
    setDraft(null);
    if (r.w >= MIN_BOX && r.h >= MIN_BOX) onBox(r);
  };

  const shown = draft || box;
  const zoomed = zoom > 1;
  return (
    <div className={`max-h-[62vh] overflow-auto rounded-xl border border-ink-100 bg-ink-50 p-2 ${zoomed ? '' : 'flex justify-center'}`}>
      <div
        ref={wrap}
        className={`relative select-none overflow-hidden ${zoomed ? 'block' : 'inline-block'} ${disabled ? 'cursor-wait' : moving ? 'cursor-grab' : 'cursor-crosshair'}`}
        style={{ touchAction: moving ? 'pan-x pan-y' : 'none', width: zoomed ? `${zoom * 100}%` : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { start.current = null; setDraft(null); }}
      >
        <img src={url} alt="The bill" draggable={false} className={zoomed ? 'block w-full' : 'block max-h-[calc(62vh-1rem)] max-w-full'} />
        {shown && (
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-brand-500"
            style={{
              left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%`,
              boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
            }}
          />
        )}
        {!shown && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="rounded-full bg-ink-900/75 px-3 py-1 text-[11px] font-medium text-white">Drag over the Item Description column</span>
          </div>
        )}
      </div>
    </div>
  );
}

// The tab's rows as a grid, styled like the Purchase Order item grid.
//  - New Items:        #  | Item Name (editable)       | + / delete
//  - Similar · Matched: # | Name on Bill               | Matched to (dropdown, or "Add as a new item")
//  - Already Exists:   #  | Name on Bill               | Item in Item Master
const cell = 'border border-ink-200 px-1 py-0.5 break-words align-middle';
const hd = 'border border-ink-200 px-1.5 py-1.5 text-center align-middle text-[11px]';
const box = 'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] uppercase focus:border-brand-400 focus:bg-white focus:outline-none disabled:text-ink-500';

function ItemGrid({ tab, rows, disabled, update, remove, addAfter }) {
  const second = tab === 'similar' ? 'Matched to' : tab === 'exists' ? 'Item in Item Master' : null;
  const cols = 3;
  const rename = (v) => (e) => update(v.id, { name: e.target.value.toUpperCase(), choice: null });

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-left text-[12px]" {...gridKeys}>
        <thead>
          <tr className="bg-brand-50 text-[11px] font-bold leading-tight text-brand-700">
            <th className={`${hd} w-10`}>#</th>
            <th className={`${hd} !text-left`}>{tab === 'new' ? 'Item Name' : 'Name on Bill'}</th>
            {second && <th className={`${hd} w-[48%] !text-left`}>{second}</th>}
            {tab === 'new' && <th className={`${hd} w-16`} />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={cols} className={`${cell} py-6 text-center text-ink-400`}>Nothing here.</td></tr>
          )}
          {rows.map((v, r) => {
            const bad = v.result?.error;
            return (
              <tr key={v.id} className={bad ? 'bg-red-50' : v.status === 'added' ? 'bg-emerald-50/60' : ''} title={bad || ''}>
                <td className={`${cell} text-center text-ink-400`}>{r + 1}</td>

                {tab === 'new' && (
                  <>
                    <td className={cell}>
                      <input className={box} data-r={r} data-c={0} value={v.name} disabled={disabled} placeholder="Type the item name" onChange={rename(v)} />
                      {bad && <p className="px-1 text-[11px] text-red-600">{bad}</p>}
                    </td>
                    <td className={cell}>
                      <div className="flex justify-center">
                        <button type="button" data-r={r} data-c={1} className="rounded p-0.5 text-brand-600 hover:bg-brand-50" disabled={disabled} title="Add a row below" onClick={() => addAfter(v.id)}><Plus size={13} /></button>
                        <button type="button" data-r={r} data-c={2} className="rounded p-0.5 text-red-500 hover:bg-red-50" disabled={disabled} title="Delete row" onClick={() => remove(v.id)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </>
                )}

                {tab === 'similar' && (
                  <>
                    <td className={cell}>
                      <input className={box} data-r={r} data-c={0} value={v.name} disabled={disabled} onChange={rename(v)} />
                    </td>
                    <td className={cell}>
                      <select
                        className={`${box} normal-case`}
                        data-r={r}
                        data-c={1}
                        data-own-updown
                        value={v.choice}
                        disabled={disabled}
                        onChange={(e) => update(v.id, { choice: e.target.value === NEW ? NEW : Number(e.target.value) })}
                      >
                        {v.m.similar.map((s) => (
                          <option key={s.item.ItemId} value={s.item.ItemId}>
                            {s.item.Name} ({code(s.item)}) · {Math.round(s.chars * 100)}% alike
                          </option>
                        ))}
                        <option value={NEW}>➕ Not the same — add as a new item</option>
                      </select>
                    </td>
                  </>
                )}

                {tab === 'exists' && (
                  <>
                    <td className={`${cell} px-2 uppercase text-ink-700`}>{v.name}</td>
                    <td className={`${cell} px-2`}>
                      {v.status === 'added' && <span className="font-medium text-emerald-700">Added now · {v.result.code}</span>}
                      {v.status === 'exists' && <span className="text-ink-600">{v.m.exact.Name} <span className="text-ink-400">({code(v.m.exact)}){v.m.exact.Status === 'Inactive' ? ' · Inactive' : ''}</span></span>}
                      {v.status === 'dup' && <span className="text-ink-400">Repeated on the bill</span>}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
