// Keyboard moves for editable tables. Put `{...gridKeys}` on the <table> (or
// any wrapper) and give every box `data-r={row} data-c={col}`:
//  - ← / → go to the previous / next box; inside a text box the cursor
//    moves through the text first, so it only leaves at either end.
//  - ↑ / ↓ go to the same column in the row above / below (number boxes
//    never step their value).
//  - Arriving in a number box selects its value.
//  - Row buttons (e.g. + / delete) with data-r / data-c join in, so the
//    arrows reach them and Enter / Space presses them.
// A box with `data-picker-open="true"` (an open SearchPick list) or
// `data-own-updown` (e.g. a Batch dropdown that ↑ / ↓ step through) keeps
// ↑ / ↓ for itself. Disabled boxes are skipped.

const cellAt = (root, r, c) => root.querySelector(`[data-r="${r}"][data-c="${c}"]:not(:disabled)`);

function cellsOf(root) {
  return [...root.querySelectorAll('[data-r][data-c]:not(:disabled)')]
    .map((el) => ({ el, r: Number(el.dataset.r), c: Number(el.dataset.c) }))
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

// Whether the text cursor can still move that way inside this box.
function cursorCanMove(el, dir) {
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;
  let start;
  let end;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return false; // number boxes have no text cursor
  }
  if (start == null) return false;
  if (start !== end) return false; // a selection: the arrow leaves the box
  return dir < 0 ? start > 0 : end < el.value.length;
}

function focusCell(el) {
  el.focus();
  if (el.type === 'number' || el.type === 'text') {
    try { el.select(); } catch { /* not selectable */ }
  }
}

function onKeyDown(e) {
  const el = e.target;
  if (!el.dataset || el.dataset.r == null || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const root = e.currentTarget;
  const r = Number(el.dataset.r);
  const c = Number(el.dataset.c);

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (el.dataset.pickerOpen === 'true' || el.dataset.ownUpdown != null) return;
    e.preventDefault();
    const next = cellAt(root, r + (e.key === 'ArrowUp' ? -1 : 1), c);
    if (next) focusCell(next);
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (cursorCanMove(el, dir)) return;
    const cells = cellsOf(root);
    const i = cells.findIndex((x) => x.el === el);
    const next = cells[i + dir];
    if (next) {
      e.preventDefault();
      focusCell(next.el);
    }
  }
}

function onFocus(e) {
  if (e.target.type === 'number') {
    try { e.target.select(); } catch { /* ignore */ }
  }
}

// Stops the mouse wheel from changing a focused number box's value.
function onWheel(e) {
  if (e.target.type === 'number' && document.activeElement === e.target) e.target.blur();
}

export const gridKeys = { onKeyDown, onFocus, onWheel };
