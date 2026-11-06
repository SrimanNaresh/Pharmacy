// Scan a purchase bill on Item Master: pick the item names out of the bill's
// text, then compare each one with the items already in Item Master.
// Pure functions only (no OCR here) so they can be tested on plain text.

// Lines with these words are bill headers / footers / totals, not items.
const NOT_ITEM = new RegExp(
  '\\b(' + [
    'invoice', 'bill\\s*(no|date|to)', 'tax\\s*invoice', 'gstin', 'gst\\s*no', 'd\\.?\\s*l\\.?\\s*no', 'drug\\s*lic',
    'phone', 'ph', 'mobile', 'cell', 'road', 'street', 'nagar', 'distributors?', 'agenc(y|ies)', 'enterprises',
    'traders', 'wholesale', 'pvt', 'ltd', 'limited', 'email', 'e-mail', 'address', 'state\\s*code', 'pin\\s*code',
    'total', 'sub\\s*total', 'grand', 'net\\s*(amt|amount|payable|value)', 'round(ed)?\\s*off', 'amount\\s*in\\s*words',
    'taxable', 'cgst', 'sgst', 'igst', 'discount', 'disc\\s*amt', 'freight', 'balance', 'outstanding',
    'bank', 'ifsc', 'a/c', 'accounts?', 'billing', 'whats\\s*a?u?pp?', 'upi', 'signature', 'authori[sz]ed', 'thank', 'e\\.?\\s*&\\s*o\\.?\\s*e',
    'terms', 'conditions', 'subject\\s*to', 'jurisdiction', 'page\\s*\\d', 'continued',
    'particulars', 'description', 'product\\s*name', 'item\\s*name', 'hsn\\s*(code)?', 'batch', 'exp(iry)?\\s*date',
    'qty', 'quantity', 'mrp', 'rate', 'amount', 'sl\\.?\\s*no', 's\\.?\\s*no',
    'rupees', 'only', 'due\\s*date', 'order\\s*no', 'dated', 'customer', 'supplier', 'buyer', 'seller',
    'minimum', 'courier', 'station', 'shortages?', 'receipt', 'g\\s*pay', 'payment', 'responsible', 'remarks',
    'checked\\s*by', 'packed\\s*by', 'web\\s*order', 'play\\s*store', 'whats\\s*app', 'complaint',
  ].join('|') + ')\\b',
  'i',
);

const DATE = /^(0?[1-9]|1[0-2])[/\-.](\d{2}|\d{4})$/; // 12/27, 03-2028 (expiry)
const FULL_DATE = /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/;
const DECIMAL = /^[₹$]?\d+[.,]\d{1,3}$/; // 45.50 (rate / amount)
const HSN = /^(30|33|34|38|39|40|48|90|96)\d{2}(\d{2}|\d{4})?$/; // 3004, 30049099
const PACK = /^(\d+\s*[x*×]\s*\d+|\d+\s*['`’]?\s*s)$/i; // 10's, 15S, 1x10, 10*10
const UNIT = '(mg|mcg|gm?|kg|ml|l|iu|%|cm|mm|m|inch)';
// 500MG, 75/10MG, 50MG/500MG, 20G, 1ML, 2.5ML
const STRENGTH = new RegExp(`^(\\d+(\\.\\d+)?${UNIT}?[/+])*\\d+(\\.\\d+)?${UNIT}$`, 'i');
// Dosage forms: a 1-2 letter "word" after one of these is a stray mark, not part of the name.
const FORM = /^(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|drops?|syp|syrup|susp|inj|amp|vial|cream|gel|oint|lotion|soln|spray|powder|sachet|respules?)$/i;

// A token that ends the item name: an expiry, a rate, an HSN code, or a batch
// number (letters and digits mixed, like B2304 or AX12C, but not 500MG).
function endsName(tok) {
  if (DATE.test(tok) || FULL_DATE.test(tok) || DECIMAL.test(tok) || HSN.test(tok)) return true;
  if (/^\d{6,}$/.test(tok)) return true; // an all-digit batch number
  const t = tok.replace(/[^A-Za-z0-9]/g, '');
  if (t.length >= 5 && /[A-Za-z]/.test(t) && /\d/.test(t) && !STRENGTH.test(tok) && !PACK.test(tok)) {
    const digits = t.replace(/\D/g, '').length;
    if (digits >= 3) return true;
  }
  return false;
}

const letters = (s) => (s.match(/[A-Za-z]/g) || []).length;

// OCR often reads a zero as @, ©, o or e inside numbers ("65@", "1@'S",
// "3eml", "3ee4"). Put the zeros back where a token is clearly a number.
function fixOcrDigits(tok) {
  let t = tok.replace(/[@©]/g, (c, i) => (/\d/.test(tok[i - 1] || '') || /\d/.test(tok[i + 1] || '') ? '0' : c));
  if (t.length <= 5 && /^\d[\doOeE]*\d$/.test(t)) t = t.replace(/[oOeE]/g, '0'); // 3ee4 -> 3004 (not batch nos like 6088E16701)
  const m = /^(\d+)([oOeE@]+)(\d*)(mg|ml|gm|g|mcg|['`’]?s)$/i.exec(t); // 3eml -> 30ml, 1@'s -> 10's
  if (m) t = m[1] + '0'.repeat(m[2].length) + m[3] + m[4];
  const one = /^([\dIl|]*[Il|][\dIl|]*)(mg|ml|mcg|gm)$/i.exec(t); // IMG -> 1MG, l0ML -> 10ML
  if (one) t = one[1].replace(/[Il|]/g, '1') + one[2];
  return t;
}

const cleanLine = (raw) => raw.replace(/[|¦[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
// Stray marks around a word: *, ~, quotes, a full stop after DROPS...
// (Also slashes from tick marks: "50MG/500MG/" -> "50MG/500MG".)
const trimTok = (t) => t.replace(/^[*~"'“”‘’«»®©•.,;:!?_\-/\\]+|[*~"“”‘’«»®©•.,;:!?_\-/\\]+$/g, '');

// The bill's column header, e.g. "Rack MFR Item Description Pack Batch ...":
// returns how many columns come before the item name (2 here), or null when
// the line isn't the header.
const NAME_HEAD = /\b(item\s*description|item\s*name|product\s*name|product|particulars|description\s*of\s*goods|description|medicine)\b/i;
export function headerLead(raw) {
  const line = cleanLine(raw);
  const m = NAME_HEAD.exec(line);
  if (!m) return null;
  const after = line.slice(m.index + m[0].length);
  // A header also names the other columns.
  if (!/\b(qty|quantity|batch|mrp|rate|pack|amount|exp)/i.test(after)) return null;
  const before = line.slice(0, m.index).trim();
  return before ? before.split(' ').length : 0;
}

// A bill line as words: [{ t: text, x: left edge as a share of the page width, or null }].
const lineWords = (raw) => cleanLine(raw).split(' ').filter(Boolean).map((t) => ({ t, x: null }));
const SHORT_CODE = /^[A-Za-z]{2,8}$/; // a manufacturer code like SUN, MERCK, ICON
const COL_TOL = 0.015; // words this close (share of page width) are in the same column

// One bill line -> { name, pack, first, second } or null when it isn't an item line.
//  lead: columns before the item name (from the header), or null if unknown.
//  mfrX: where a manufacturer-code column sits before the name, or null.
//  first / second: the first two words left after the serial / rack number
//  (used to spot a manufacturer column).
//  needFigures: a whole-bill line must carry figures after the name; a line
//  from a selected Item Description column needn't.
export function parseItemLine(input, lead = null, mfrX = null, needFigures = true) {
  let words = (typeof input === 'string' ? lineWords(input) : input)
    .map((w) => ({ ...w, t: cleanLine(w.t) })).filter((w) => w.t);
  const whole = words.map((w) => w.t).join(' ');
  if (letters(whole) < 3) return null;
  if (NOT_ITEM.test(whole)) return null;
  if (lead) {
    // Drop the columns before the name (serial no, rack, manufacturer code...).
    let k = 0;
    while (k < lead && k < words.length - 1 && words[k].t.length <= 8) k += 1;
    words = words.slice(k);
  } else {
    // Serial / rack numbers: "1", "12.", "008"
    let k = 0;
    while (k < 2 && k < words.length - 1 && /^\(?\d{1,4}[.)\]:]?$/.test(words[k].t)) k += 1;
    words = words.slice(k);
  }
  const first = words[0] || null;
  const second = words[1] || null;
  if (mfrX != null && first && first.x != null && second && SHORT_CODE.test(first.t) && Math.abs(first.x - mfrX) <= COL_TOL) {
    words = words.slice(1);
  }

  const toks = words.map((w) => trimTok(fixOcrDigits(w.t))).filter(Boolean);
  const upper = (whole.match(/[A-Z]/g) || []).length >= letters(whole) * 0.75;
  const name = [];
  let pack = '';
  let i = 0;
  for (; i < toks.length; i += 1) {
    const tok = toks[i];
    if (endsName(tok)) break;
    if (!pack && PACK.test(tok) && name.length) { pack = tok; continue; }
    const t = trimTok(tok);
    if (t) name.push(t);
  }
  // Stray marks after the name (a pharmacist's tick read as "ae", "g", "A"):
  // short lower-case bits on an upper-case bill, or 1-2 letters after a dosage
  // form or a number.
  if (upper) {
    for (let j = name.length - 1; j >= 1; j -= 1) {
      if (name[j].length <= 3 && /[a-z]/.test(name[j]) && !/^(mg|ml|gm|mcg|iu|kg)$/i.test(name[j])) name.splice(j, 1);
    }
  }
  while (name.length > 1) {
    const last = name[name.length - 1];
    const prev = name[name.length - 2];
    if ((/^[A-Za-z]{1,2}$/.test(last) && (FORM.test(prev) || /\d/.test(prev))) || (/^\d$/.test(last) && FORM.test(prev))) name.pop();
    else break;
  }
  // An item line carries the bill's figures after the name (batch, expiry,
  // rate, quantity...). Header lines like the supplier's name or address don't.
  const rest = toks.slice(i);
  let trailingNums = 0;
  for (let j = name.length - 1; j >= 0 && /^[\d.,]+$/.test(name[j]); j -= 1) trailingNums += 1;
  const figures = rest.filter((t) => /\d/.test(t)).length + trailingNums;
  if (needFigures && figures < 2) return null;
  // Trailing quantities after the name ("CROCIN TAB 10 15.20") are not part of
  // it — but "DIAMICRON XR 60" followed by a batch number keeps its 60.
  // (In a selected name column there are no quantities: keep every number.)
  if (needFigures && (rest.length === 0 || /^[\d.,:;\-+]+$/.test(rest[0]))) {
    while (name.length > 1 && /^[\d.,:;\-+]+$/.test(name[name.length - 1])) name.pop();
  }
  while (name.length && /^[^A-Za-z0-9]+$/.test(name[name.length - 1])) name.pop();
  while (name.length && /^[^A-Za-z0-9]+$/.test(name[0])) name.shift();

  const text = name.join(' ').replace(/\s+([,.)])/g, '$1').trim();
  if (letters(text) < 3 || !/[A-Za-z]{3,}/.test(text)) return null;
  // OCR noise: mostly symbols, or one long word of random case.
  const clean = text.replace(/[^A-Za-z0-9 ]/g, '');
  if (clean.length < text.length * 0.7) return null;
  return { name: text.toUpperCase().slice(0, 200), pack: pack.toUpperCase(), first, second };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// Many bills put a manufacturer code column (SUN, MERCK, ICON) before the item
// name. Spot it from word positions: on several item lines the first word is a
// short code at the same spot, and the word after it (the name) also starts at
// one same spot — when the first word is the name itself, the second word
// moves with the name's length.
function findMfrColumn(hits) {
  const cands = hits.filter((h) => h.first?.x != null && h.second?.x != null && SHORT_CODE.test(h.first.t));
  let best = [];
  for (const c of cands) {
    const group = cands.filter((d) => Math.abs(d.first.x - c.first.x) <= COL_TOL);
    if (group.length > best.length) best = group;
  }
  if (best.length < 2 || best.length < hits.length * 0.4) return null;
  // Codes are short (SUN, MERCK, ICON); names' first words are usually longer.
  if (median(best.map((h) => h.first.t.length)) > 5) return null;
  const nameX = median(best.map((h) => h.second.x));
  const aligned = best.filter((h) => Math.abs(h.second.x - nameX) <= COL_TOL).length;
  if (aligned < best.length * 0.7) return null;
  return median(best.map((h) => h.first.x));
}

// All item lines of a bill, without repeats. `layout` (optional) is the same
// bill as lines of positioned words — [[{ t, x }]] — and lets a manufacturer
// column be told apart from the name. column: true when the text is only the
// Item Description column the user selected — every line is then a name.
export function extractItems(text, layout = null, { column = false } = {}) {
  const lines = layout || String(text || '').split(/\r?\n/).map(lineWords);
  let headerFound = false;
  const parse = (mfrX) => {
    const hits = [];
    let lead = null;
    for (const words of lines) {
      if (!column) {
        const head = headerLead(words.map((w) => w.t).join(' '));
        if (head != null) { lead = head; headerFound = true; continue; }
      }
      const hit = parseItemLine(words, lead, mfrX, !column);
      if (hit) hits.push(hit);
    }
    return hits;
  };
  let hits = parse(null);
  // A readable header already says where the name column is; only guess the
  // manufacturer column from word positions when it couldn't be read.
  const mfrX = column || headerFound ? null : findMfrColumn(hits);
  if (mfrX != null) hits = parse(mfrX);

  const seen = new Set();
  const out = [];
  for (const h of hits) {
    const k = compact(h.name);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: h.name, pack: h.pack });
  }
  return out;
}

// --- Matching ------------------------------------------------------------

// "Eltroxin  75mg Tab" and "ELTROXIN 75MG TAB." compare equal.
export const normalize = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
export const compact = (s) => normalize(s).replace(/ /g, '');

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) || 0);
  return (2 * common) / (a.length - 1 + b.length - 1);
}

// Items -> an index the matcher reuses for every bill line.
export function buildIndex(items) {
  return items.map((it) => {
    const norm = normalize(it.Name);
    return { item: it, norm, comp: norm.replace(/ /g, ''), first: norm.split(' ')[0] || '', grams: null };
  });
}

// How alike two names are. `chars` (0..1) is the share of character pairs in
// common; `rank` adds a little when the first word (the brand) is the same or
// one name starts with the other, so same-brand items list first.
function score(qNorm, qComp, e) {
  const chars = dice(qComp, e.comp);
  let rank = chars;
  const qFirst = qNorm.split(' ')[0] || '';
  if (qFirst.length >= 3 && qFirst === e.first) rank += 0.2;
  else if (qFirst.length >= 4 && e.first.length >= 4 && (e.first.startsWith(qFirst) || qFirst.startsWith(e.first))) rank += 0.1;
  if (qComp.length >= 4 && (e.comp.startsWith(qComp) || qComp.startsWith(e.comp))) rank += 0.1;
  return { chars, rank };
}

export const SIMILAR_MIN = 0.55; // rank below this: not offered at all
export const SAME_ITEM_MIN = 0.8; // chars at or above this (and clearly ahead of the next): picked by default

// One name -> { exact: item | null, similar: [{ item, chars, rank }] best first (at most 6),
// likely: the similar item that is very probably the same one, or null }.
export function matchName(name, index) {
  const qNorm = normalize(name);
  const qComp = qNorm.replace(/ /g, '');
  if (!qComp) return { exact: null, similar: [], likely: null };
  const exact = index.find((e) => e.comp === qComp);
  if (exact) return { exact: exact.item, similar: [], likely: null };
  const similar = [];
  for (const e of index) {
    const s = score(qNorm, qComp, e);
    if (s.rank >= SIMILAR_MIN) similar.push({ item: e.item, ...s });
  }
  similar.sort((a, b) => b.rank - a.rank || b.chars - a.chars);
  const top = similar.slice(0, 6);
  const best = [...top].sort((a, b) => b.chars - a.chars);
  const likely = best[0] && best[0].chars >= SAME_ITEM_MIN && (!best[1] || best[0].chars - best[1].chars >= 0.08) ? best[0].item : null;
  return { exact: null, similar: top, likely };
}
