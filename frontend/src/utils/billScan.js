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
// (Pen ticks after a name come out as @, <, >, € too: "TAB@<" -> "TAB".)
const trimTok = (t) => t.replace(/^[*~"'“”‘’«»®©•.,;:!?_\-/\\<>@€]+|[*~"“”‘’«»®©•.,;:!?_\-/\\<>@€]+$/g, '');

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
  // A bold header OCR couldn't read comes out as bits: "SUED KN EE EY IEE FY ER CA".
  const parts = text.split(' ');
  // (A strength like "6X" or "3C" isn't such a bit: "SCH BIO MP 6X".)
  if (parts.length >= 4 && parts.filter((p) => p.length <= 2 && !/\d/.test(p)).length >= parts.length / 2) return null;
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
      // Noise OCR wasn't sure of anywhere on the line (an unreadable bold
      // header, stamps, pen marks): real item lines have some word it is sure of.
      if (words.length && words.every((w) => w.c != null && w.c < 60)) continue;
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

// --- Bill columns ----------------------------------------------------------
// When the read area includes the bill's header row, each column is read into
// its Item Master field:
//   Item Description -> Item Name   HSNCODE -> HSN    Rack -> Rack
//   MFR -> Manufacturer             Batch -> Category Pack -> Pack   MRP -> MRP
// Other headings (Qty, Exp, Rate, Amount...) are kept as columns too, only so
// their figures don't spill into the ones above; they aren't saved.

// Header text as plain lower-case letters: "M.R.P." -> "mrp", "HSN/SAC" -> "hsnsac".
const headKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const HEADINGS = [
  ['name', /^(itemdescription|itemname|itemdetails|productname|productdescription|descriptionofgoods|description|particulars|product|products|medicine|nameofproduct|items?)$/],
  ['hsnCode', /^(hsn|hsncode|hsnsac|hsnno|hsnc)$/],
  ['rack', /^(rack|rackno)$/],
  ['manufacturer', /^(mfr|mfrs|mfg|mfgr|mfrname|manufacturer|mkt|company|comp)$/],
  ['category', /^(batch|batchno|batchnumber|bno|btch)$/],
  ['pack', /^(pack|packing|pkg|packsize|pak)$/],
  ['mrp', /^(mrp|mrprs)$/],
  // Read only for a Purchase Order (Item Master has no quantity).
  ['qty', /^(qty|qnty|qtty|quantity|billqty)$/],
  // Not saved, but named so "Old MRP" isn't taken for the MRP column.
  ['_', /^(oldmrp|ptr|pts|freeqty)$/],
];
const headingOf = (key) => (HEADINGS.find(([, re]) => re.test(key)) || [null])[0];
const PHRASE_GAP = 0.012; // words of one heading ("Item Description") are closer than this

// One line of positioned words -> its columns [{ field | null, x, x1 }] sorted
// left to right, or null when the line isn't the item table's header (it must
// name the Item Description column and at least two others).
function headerColumns(words) {
  const ws = words.filter((w) => w.x != null && w.x1 != null && headKey(w.t));
  const cols = [];
  for (let i = 0; i < ws.length;) {
    let hit = null;
    for (let n = Math.min(3, ws.length - i); n >= 1 && !hit; n -= 1) {
      const part = ws.slice(i, i + n);
      const field = headingOf(part.map((w) => headKey(w.t)).join(''));
      if (field) hit = { field, x: part[0].x, x1: part[n - 1].x1, n, t: part.map((w) => w.t).join(' ') };
    }
    if (hit) { if (hit.field === '_') hit.field = null; cols.push(hit); i += hit.n; continue; }
    const w = ws[i];
    const prev = cols[cols.length - 1];
    // A heading word OCR didn't recognise, right after a heading ("Item Descripti0n"),
    // belongs to it; on its own it's another column (Qty, Exp, Rate...).
    if (prev && w.x - prev.x1 < PHRASE_GAP) { prev.x1 = w.x1; prev.t = `${prev.t} ${w.t}`; }
    else cols.push({ field: null, x: w.x, x1: w.x1, n: 1, t: w.t });
    i += 1;
  }
  const known = cols.filter((c) => c.field);
  if (!known.some((c) => c.field === 'name')) return null;
  if (new Set(known.map((c) => c.field)).size < 3) return null;
  // A field named twice (two "Pack" headings): keep the first.
  const seen = new Set();
  for (const c of cols) {
    if (c.field && seen.has(c.field)) c.field = null;
    else if (c.field) seen.add(c.field);
  }
  cols.sort((a, b) => a.x - b.x);
  // Where each column ends: halfway to the next heading — except Item
  // Description, whose names are long and run on up to the next heading.
  for (let i = 0; i < cols.length; i += 1) {
    const next = cols[i + 1];
    cols[i].end = !next ? Infinity : cols[i].field === 'name' ? next.x - 0.004 : (cols[i].x1 + next.x) / 2;
  }
  return cols;
}

const columnAt = (cols, w) => {
  const mid = w.x1 != null ? (w.x + w.x1) / 2 : w.x;
  return cols.find((c) => mid < c.end) || cols[cols.length - 1];
};

const words = (ws) => ws.map((w) => trimTok(cleanLine(w.t))).filter(Boolean);
const CLEAN = {
  hsnCode: (ws) => {
    const d = words(ws).map(fixOcrDigits).join('').replace(/\D/g, '');
    return /^\d{4,8}$/.test(d) ? d : '';
  },
  rack: (ws) => words(ws).join(' ').toUpperCase().slice(0, 50),
  manufacturer: (ws) => words(ws).join(' ').toUpperCase().slice(0, 200),
  // A batch number has no spaces; OCR sometimes splits one ("B 2304").
  category: (ws) => words(ws).join('').toUpperCase().slice(0, 100),
  pack: (ws) => words(ws).map(fixOcrDigits).join(' ').toUpperCase().slice(0, 50),
  mrp: (ws) => {
    const nums = words(ws).map((t) => fixOcrDigits(t).replace(/^[₹$]|^rs\.?/i, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, ''))
      .filter((t) => /^\d+(\.\d{1,2})?$/.test(t));
    return nums.length ? Number(nums[nums.length - 1]).toFixed(2) : '';
  },
  // "10", "10+2" (2 free) -> "10"
  qty: (ws) => {
    const t = words(ws).map(fixOcrDigits).join(' ');
    const m = /\d+(\.\d+)?/.exec(t);
    return m && Number(m[0]) > 0 ? String(Number(m[0])) : '';
  },
};
export const BILL_FIELDS = ['name', 'hsnCode', 'rack', 'manufacturer', 'category', 'pack', 'mrp', 'qty'];

// --- Columns found from the item rows (when the header can't be read) ------
// Bold, boxed bill headers often come out of OCR as noise ("SEE en ©"), but
// the item rows read well. Then the columns are found from the rows: a row's
// words that sit close together form a cell ("NASIVION PAED DROPS"), cells
// at the same place on every row form a column, and what a column holds says
// what it is — rack numbers, MFR codes, the names, pack sizes, batch numbers,
// expiry dates, quantities, prices, HSN codes.

const EXP = /^(0?[1-9]|1[0-2])[/\-.]?\d{2}$/; // 04/28, 0428
const PACKISH = /^(\d+\s*[x*×]\s*\d+|\d+\s*['`’]?\s*[sS5]|\d+(\.\d+)?\s*(ml|gm?|kg|l|mg|mcg)|1[o0]s)$/i; // 15'S, 10 S, 10ML, 30ML, 105 (10S read as 105)
const share = (cells, test) => (cells.length ? cells.filter((c) => test(c.t)).length / cells.length : 0);
// OCR reads 5 as $ or S inside prices and drops decimal points: "$0.00" -> 50.00, "17525" -> 175.25.
const priceOf = (t, decimals) => {
  let s = t.replace(/[$S]/g, '5').replace(/[oO]/g, '0').replace(/[:;,]/g, '.').replace(/[^\d.]/g, '');
  if (!/\d/.test(s)) return null;
  if (decimals && !s.includes('.') && s.length >= 3) s = `${s.slice(0, -2)}.${s.slice(-2)}`;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// OCR reads two figures printed close together as one word: "175.0035.00"
// (MRP + discount), "12/27/33049910" (expiry + HSN). Split it, each part
// given its share of the word's width, so each lands in its own column.
function unglue(w) {
  const t = w.t.replace(/^[^\d]+|[^\d]+$/g, '');
  let parts = null;
  const dec = t.match(/\d+[.,]\d{2}/g);
  if (dec && dec.length > 1 && dec.join('').length >= t.replace(/[^\d.,]/g, '').length - 1) parts = dec;
  const exp = /^(\d{1,2}\/\d{2})\D?(\d{4,8})$/.exec(t);
  if (exp) parts = [exp[1], exp[2]];
  if (!parts) return [w];
  const per = (w.x1 - w.x) / w.t.length;
  let at = 0;
  return parts.map((p) => {
    const i = w.t.indexOf(p, at);
    at = i + p.length;
    return { t: p, x: w.x + i * per, x1: w.x + at * per };
  });
}

const hasDigit = (t) => /\d/.test(t);
function rowCells(line, gap) {
  const ws = line
    .flatMap((w) => (w.x != null && w.x1 != null ? unglue(w) : [w]))
    .map((w) => ({ t: trimTok(cleanLine(w.t)), x: w.x, x1: w.x1 }))
    .filter((w) => w.t && w.x != null && w.x1 != null)
    .sort((a, b) => a.x - b.x);
  const cells = [];
  for (const w of ws) {
    const last = cells[cells.length - 1];
    // Two figures side by side are two columns ("200" | "100ML", "185.00" | "35.00"),
    // however close they're printed; words of a name stay together.
    const twoFigures = last && hasDigit(w.t) && hasDigit(last.words[last.words.length - 1].t);
    if (last && w.x - last.x1 < gap && !twoFigures) { last.t += ` ${w.t}`; last.x1 = w.x1; last.words.push(w); } else cells.push({ ...w, words: [w] });
  }
  return cells;
}

// The table's columns from its rows' cells: an x position is inside a column
// when cells of enough rows cover it; where hardly any row has a cell is the
// gap between two columns. (Joining every overlapping cell instead chains
// neighbouring columns together as soon as one row's cell spans both.)
// Every cell is then given to the one column it overlaps most.
function findColumns(rows) {
  const N = 1000;
  const cov = new Array(N).fill(0);
  for (const cells of rows) {
    const hit = new Uint8Array(N);
    for (const c of cells) for (let b = Math.max(0, Math.floor(c.x * N)); b < Math.min(N, Math.ceil(c.x1 * N)); b += 1) hit[b] = 1;
    hit.forEach((h, b) => { cov[b] += h; });
  }
  const thr = Math.max(1, rows.length * 0.2);
  let runs = [];
  for (let b = 0; b < N; b += 1) {
    if (cov[b] <= thr) continue;
    const last = runs[runs.length - 1];
    if (last && last.b1 === b) last.b1 = b + 1; else runs.push({ b0: b, b1: b + 1 });
  }
  runs = runs.map((r) => ({ x: r.b0 / N, x1: r.b1 / N }));
  const overlap = (c, r) => Math.min(c.x1, r.x1) - Math.max(c.x, r.x);
  const nearest = (cols, c) => cols.reduce((best, r) => {
    const d = overlap(c, r);
    return !best || d > best.d ? { r, d } : best;
  }, null)?.r;
  // Runs only a few rows have cells in (the tail of a long name) aren't columns.
  const count = new Map(runs.map((r) => [r, 0]));
  for (const c of rows.flat()) { const r = nearest(runs, c); if (r) count.set(r, count.get(r) + 1); }
  let cols = runs.filter((r) => count.get(r) >= Math.max(2, rows.length / 3)).map((r) => ({ ...r, cells: [] }));
  const assign = () => {
    cols.forEach((c) => { c.cells = []; });
    for (const cells of rows) for (const c of cells) { c.col = nearest(cols, c); c.col?.cells.push(c); }
  };
  assign();
  // Figures printed with hardly a space between them (MRP "185.00" and
  // Disc "35.00") can still come out as one column: split it up.
  const split = cols.flatMap((col) => {
    const cuts = crowdCuts(rows.map((cells) => cells.filter((c) => c.col === col)));
    if (!cuts) return [col];
    const edges = [col.x, ...cuts, col.x1];
    return edges.slice(1).map((x1, j) => ({ x: edges[j], x1, cells: [] }));
  });
  if (split.length > cols.length) { cols = split; assign(); }
  return cols;
}

// One column's words or cells, row by row ([[{ t, x, x1 }]]): when most rows
// hold two or more separate figures in it, it's really that many columns —
// returns where to cut it (x positions between them), else null.
function crowdCuts(groups) {
  const figs = groups.map((g) => g.filter((w) => /\d/.test(w.t)).sort((a, b) => a.x - b.x)).filter((g) => g.length);
  if (figs.length < 2) return null;
  // Only figures (prices, discounts, amounts) — not a name or a batch column.
  const all = figs.flat();
  if (all.filter((w) => !/[A-Za-z]{2,}/.test(w.t)).length < all.length * 0.8) return null;
  const tally = new Map();
  for (const g of figs) tally.set(g.length, (tally.get(g.length) || 0) + 1);
  const [k, n] = [...tally].sort((a, b) => b[1] - a[1])[0];
  if (k < 2 || n < figs.length * 0.5) return null;
  // Where each figure usually sits (its middle); cut halfway between two.
  const mids = Array.from({ length: k }, (_, j) => {
    const at = figs.filter((g) => g.length === k).map((g) => g[j]);
    return at.reduce((s, w) => s + (w.x + w.x1) / 2, 0) / at.length;
  });
  return mids.slice(1).map((m, j) => (mids[j] + m) / 2);
}

function extractByContent(layout, raw = false) {
  const lines = layout.map((l) => l.filter((w) => w.x != null && w.x1 != null)).filter((l) => l.length);
  // Width of one letter, from the words on lines that look like item rows
  // (the bill's big header print would make it too wide): gaps under ~0.8
  // of it are a space inside a cell.
  const rowish = lines.filter((l) => l.filter((w) => /\d/.test(w.t)).length >= 4);
  const widths = rowish.flat().filter((w) => /^[A-Za-z]{4,}$/.test(w.t)).map((w) => (w.x1 - w.x) / w.t.length);
  if (widths.length < 3) return null;
  const gap = median(widths) * 0.8;
  // Item rows: a word (the name) and about as many figures as the fullest row
  // (rack, batch, expiry, qty, prices, HSN...). Header noise and the
  // supplier's address have far fewer; totals and notes are left out.
  const all = lines.map((l) => rowCells(l, gap));
  const figuresOf = (cells) => cells.filter((c) => /\d/.test(c.t)).length;
  const most = Math.max(...all.map(figuresOf));
  const rows = all.filter((cells) => {
    const text = cells.map((c) => c.t).join(' ');
    return figuresOf(cells) >= Math.max(4, most * 0.5) && /[A-Za-z]{3,}/.test(text) && !/\b(total|grand|goods\s*value|taxable|amount|bill\s*amt|net)\b/i.test(text);
  });
  if (rows.length < 2) return null;

  // Columns: places where the rows' cells line up (each needs cells on at
  // least a third of the rows — not a stray mark).
  const real = findColumns(rows);

  // Item Description: the column with the most letters.
  const nameCol = real.reduce((best, c) => {
    const n = c.cells.reduce((s, x) => s + letters(x.t), 0);
    return !best || n > best.n ? { col: c, n } : best;
  }, null)?.col;
  if (!nameCol) return null;
  const at = real.indexOf(nameCol);
  const left = real.slice(0, at);
  const right = real.slice(at + 1);
  const field = new Map(); // col -> field
  // Left of the names: MFR codes (letters) and the rack number (digits).
  for (const c of left) {
    if (share(c.cells, (t) => /^[A-Za-z]{2,8}$/.test(t)) >= 0.6) field.set(c, 'manufacturer');
    else if (share(c.cells, (t) => /^[\dA-Za-z]{1,5}$/.test(t) && /\d/.test(t.replace(/[lIoOs]/g, '0'))) >= 0.6 && ![...field.values()].includes('rack')) field.set(c, 'rack');
  }
  const pick = (name, test, min = 0.5, from = 0) => {
    const c = right.slice(from).find((col) => !field.has(col) && share(col.cells, test) >= min);
    if (c) field.set(c, name);
    return c ? right.indexOf(c) : -1;
  };
  // (Also sizes OCR garbled: "BOML", "2OGM", "HOOML" for 30ML, 20GM, 100ML.)
  const packAt = pick('pack', (t) => PACKISH.test(t.replace(/\s+/g, '')) || /^[\dA-Za-z]{1,4}\s?(ml|gm|g)$/i.test(t));
  const batchAt = pick('category', (t) => /^[A-Za-z0-9\-/]{4,20}$/.test(t) && /\d/.test(t) && !EXP.test(t) && !HSN.test(t) && !/^\d+[.,]\d{2}$/.test(t), 0.5, Math.max(0, packAt + 1));
  pick('hsnCode', (t) => HSN.test(t.replace(/\D/g, '')) && t.replace(/\D/g, '').length >= 6, 0.6);
  const expAt = right.findIndex((col) => !field.has(col) && share(col.cells, (t) => EXP.test(t)) >= 0.5);
  if (expAt >= 0) field.set(right[expAt], 'exp');
  // Qty: small whole numbers (not "000", an Old MRP that lost its point), after the expiry.
  const qtyAt = pick('qty', (t) => /^\d{1,4}$/.test(t) && Number(t) > 0, 0.6, Math.max(0, expAt + 1, batchAt + 1));
  // MRP: the first price column after Qty that isn't mostly 0.00 (Old MRP usually is).
  const priceCol = (col) => share(col.cells, (t) => /^[\d$S.,:]+$/.test(t) && /\d/.test(t)) >= 0.6;
  const mrpCol = right.slice(Math.max(0, qtyAt + 1)).find((col) => !field.has(col) && priceCol(col)
    && share(col.cells, (t) => (priceOf(t, true) || 0) > 0) >= 0.6);
  if (mrpCol) field.set(mrpCol, 'mrp');
  // The Rate column after MRP: an MRP below the rate lost digits in OCR
  // ("1:50" for 111.50) — better left empty to fill in than saved wrong.
  const rateCol = mrpCol && right.slice(right.indexOf(mrpCol) + 1).find((col) => !field.has(col) && priceCol(col));

  // The table as read, every column, for the column-matching preview.
  if (raw) {
    const heads = real.map((col, i) => {
      const f = col === nameCol ? 'name' : field.get(col);
      return { label: col === rateCol ? 'Rate' : FIELD_LABEL[f] || `Column ${i + 1}`, field: f && f !== 'exp' ? f : null };
    });
    const table = [];
    for (const cells of rows) {
      const inCol = (col) => cells.filter((c) => c.col === col);
      const hit = parseItemLine(inCol(nameCol).flatMap((c) => c.words).flatMap((w) => splitGlued(w.t).split(' ').map((t) => ({ t, x: w.x }))), 0, null, false);
      if (!hit) continue;
      table.push(real.map((col) => (col === nameCol ? hit.name : words(inCol(col).flatMap((c) => c.words)).join(' '))));
    }
    return table.length ? { heads, rows: table } : null;
  }

  const out = [];
  const seen = new Set();
  for (const cells of rows) {
    const inCol = (col) => cells.filter((c) => c.col === col);
    const nameWords = inCol(nameCol).flatMap((c) => c.words);
    const hit = parseItemLine(nameWords.flatMap((w) => splitGlued(w.t).split(' ').map((t) => ({ t, x: w.x }))), 0, null, false);
    if (!hit) continue;
    const k = compact(hit.name);
    if (seen.has(k)) continue;
    seen.add(k);
    const row = { name: hit.name, hsnCode: '', rack: '', manufacturer: '', category: '', pack: '', mrp: '', qty: '' };
    for (const [col, f] of field) {
      const ws = inCol(col).flatMap((c) => c.words);
      if (f === 'exp' || !ws.length) continue;
      if (f === 'mrp') {
        const n = priceOf(ws.map((w) => w.t).join(''), true);
        const rateWs = rateCol ? inCol(rateCol).flatMap((c) => c.words) : [];
        // (Only a rate read with its decimal point is trusted for this.)
        const rateText = rateWs.map((w) => w.t).join('');
        const rate = /\d\.\d{2}/.test(rateText) ? priceOf(rateText, true) : null;
        row.mrp = n != null && !(rate != null && n < rate) ? n.toFixed(2) : '';
      } else if (f === 'pack') {
        row.pack = words(ws).join('').toUpperCase().replace(/^(\d+)O(\d*)/, '$10$2').replace(/^(\d+)[S5]$/, "$1'S").replace(/^1[O0]S$/, "10'S").replace(/^(\d+)'?S$/, "$1'S").slice(0, 50);
      } else if (f === 'rack') {
        // Number racks read as letters: "0ll" / "ott" -> 011, "01s" -> 015.
        const raw = words(ws).join('').toUpperCase();
        row.rack = (/^[\dOLITS]{2,4}$/.test(raw) ? raw.replace(/[LIT]/g, '1').replace(/O/g, '0').replace(/S$/, '5') : raw).slice(0, 50);
      } else row[f] = CLEAN[f](ws);
    }
    if (!row.pack && hit.pack) row.pack = hit.pack;
    out.push(row);
  }
  if (!out.length) return null;
  const found = new Set(['name', ...field.values()]);
  return { fields: BILL_FIELDS.filter((f) => found.has(f)), rows: out };
}

// OCR sometimes runs a name's words together: "CLONAMPEL2MG" -> "CLONAMPEL 2MG",
// "CLONAMPELIMGTAB" -> "CLONAMPEL 1MG TAB".
function splitGlued(t) {
  const m = /^([A-Za-z]{4,})(\d+(?:\.\d+)?|[Il])(mg|ml|mcg|gm)(tab|tabs|cap|caps|syp|inj)?$/i.exec(t);
  if (!m) return t;
  const strength = m[2].replace(/^[Il]$/, '1') + m[3];
  return [m[1], strength, m[4]].filter(Boolean).join(' ');
}

// The bill's item rows split into its columns: { fields: [field names whose
// column was found], rows: [{ name, hsnCode, rack, manufacturer, category,
// pack, mrp, qty }] }, or null when no header row was read (then only names can be
// picked out — see extractItems). layout: lines of positioned words [[{ t, x, x1 }]].
export function extractBillRows(layout) {
  if (!layout) return null;
  let cols = null;
  const found = new Set();
  const out = [];
  const seen = new Set();
  for (const line of layout) {
    const head = headerColumns(line);
    if (head) { cols = head; head.forEach((c) => c.field && found.add(c.field)); continue; }
    if (!cols || !line.length) continue;
    const by = new Map(cols.map((c) => [c, []]));
    for (const w of line) by.get(columnAt(cols, w)).push(w);
    const nameCol = cols.find((c) => c.field === 'name');
    // An item row carries figures outside the name (batch, qty, rate...);
    // the supplier's notes, totals and a wrapped second line don't.
    const figures = cols.filter((c) => c !== nameCol).reduce((n, c) => n + by.get(c).filter((w) => /\d/.test(w.t)).length, 0);
    if (figures < 2) continue;
    const hit = parseItemLine(by.get(nameCol), 0, null, false);
    if (!hit) continue;
    const k = compact(hit.name);
    if (seen.has(k)) continue;
    seen.add(k);
    const row = { name: hit.name };
    for (const f of BILL_FIELDS.slice(1)) {
      const c = cols.find((col) => col.field === f);
      row[f] = c ? CLEAN[f](by.get(c)) : '';
    }
    if (!row.pack && hit.pack) row.pack = hit.pack;
    out.push(row);
  }
  // No readable header (or nothing under it): find the columns from the rows.
  if (!cols || !out.length) return extractByContent(layout);
  return { fields: BILL_FIELDS.filter((f) => found.has(f)), rows: out };
}

// The bill's item table as read, every column kept, for the column-matching
// preview: { heads: [{ label: the bill's heading, field: BILL_FIELDS name | null }],
// rows: [[cell text, one per head]] }, or null. The Item Description cell is
// the cleaned name; a name wrapped onto a second line ("CAPSICUM ANNUUM" /
// "30C 100ML") is joined back up.
const FIELD_LABEL = {
  name: 'Item Description', hsnCode: 'HSN', rack: 'Rack', manufacturer: 'MFR', category: 'Batch', pack: 'Pack', mrp: 'MRP', qty: 'Qty', exp: 'Exp',
};
const NOT_WRAP = /\b(total|grand|amount|taxable|net|value|words|remarks)\b/i;

// Under one heading the bill may print two figures ("MRP" over "185.00 35.00",
// the discount having no heading OCR could read): give each its own column.
function splitHeads(cols, lines) {
  const groups = new Map(cols.map((c) => [c, []]));
  for (const line of lines) {
    if (line.filter((w) => /\d/.test(w.t)).length < 3) continue;
    const by = new Map(cols.map((c) => [c, []]));
    for (const w of line) by.get(columnAt(cols, w)).push(w);
    for (const c of cols) groups.get(c).push(by.get(c));
  }
  return cols.flatMap((c) => {
    const cuts = c.field === 'name' ? null : crowdCuts(groups.get(c));
    if (!cuts) return [c];
    const ends = [...cuts, c.end];
    return ends.map((end, j) => (j === 0 ? { ...c, end } : { field: null, x: cuts[j - 1], x1: cuts[j - 1], end, t: '' }));
  });
}

export function extractBillTable(input) {
  if (!input) return null;
  // Figures OCR read as one word ("175.0035.00") split up first.
  const layout = input.map((l) => l.flatMap((w) => (w.x != null && w.x1 != null ? unglue(w) : [w])));
  let cols = null;
  const rows = [];
  let last = null;
  for (const [n, line] of layout.entries()) {
    const head = headerColumns(line);
    if (head) { if (!cols) cols = splitHeads(head, layout.slice(n + 1)); last = null; continue; }
    if (!cols || !line.length) continue;
    const by = new Map(cols.map((c) => [c, []]));
    for (const w of line) by.get(columnAt(cols, w)).push(w);
    const nameCol = cols.find((c) => c.field === 'name');
    const nameWs = by.get(nameCol);
    const figures = cols.filter((c) => c !== nameCol).reduce((n, c) => n + by.get(c).filter((w) => /\d/.test(w.t)).length, 0);
    if (figures < 2) {
      // Only a few words, all under Item Description, right after an item: the rest of its name.
      const more = words(nameWs).join(' ').toUpperCase();
      if (last && nameWs.length === line.length && nameWs.length <= 4 && /[A-Z0-9]/.test(more) && !NOT_WRAP.test(more)) {
        last[cols.indexOf(nameCol)] += ` ${more}`;
      } else last = null;
      continue;
    }
    const hit = parseItemLine(nameWs, 0, null, false);
    if (!hit) { last = null; continue; }
    last = cols.map((c) => (c === nameCol ? hit.name : words(by.get(c)).join(' ')));
    const packCol = cols.findIndex((c) => c.field === 'pack');
    if (packCol >= 0 && !last[packCol] && hit.pack) last[packCol] = hit.pack;
    rows.push(last);
  }
  if (!cols || !rows.length) return extractByContent(layout, true);
  // Leave out columns with nothing in them (stray heading words), and repeated lines.
  const keep = cols.map((c, i) => c.field === 'name' || rows.some((r) => r[i]));
  const seen = new Set();
  const nameAt = cols.findIndex((c) => c.field === 'name');
  // Only a line repeated exactly (OCR reading it twice) is dropped here: the
  // same item with another batch is its own line — repeats of Item Name +
  // HSN + Batch are left out once the columns are matched.
  const unique = rows.filter((r) => {
    const k = r.map((c) => compact(c)).join('|');
    if (!compact(r[nameAt]) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    heads: cols.map((c, i) => ({ label: cleanLine(c.t || '') || FIELD_LABEL[c.field] || `Column ${i + 1}`, field: c.field })).filter((_, i) => keep[i]),
    rows: unique.map((r) => r.filter((_, i) => keep[i])),
  };
}

// --- Supplier and bill date (top of the bill) ------------------------------
// The supplier's block is the top-left of the bill, above the customer's
// ("M/s.", "Customer", "Bill To"...); the right side holds the GST No, the
// invoice box... on the same lines. -> { vendorName, address, mobile, gstNo,
// email, billDate: 'yyyy-mm-dd' } (each '' when not read).

const CUSTOMER = /(c?ustomer\b|\bcust\.?\s*code|\bm\s*\/\s*s\b|\bbill\s*to|billed\s*to|ship\s*to|buyer|consignee|party\s*name|sold\s*to|deliver\s*to)/i;
const NOT_NAME = /\b(tax\s*invoice|invoice|bill\s*of\s*supply|original|duplicate|triplicate|cash|credit|estimate|gst|dl\s*no|phone|mobile)\b/i;
const CONTACT_TOK = /^(complaint|complalat|billing|phone|ph|mob|mobile|cell|tel|whats\w*|accounts?|email|e-?mail|gst\w*|dl|d\.l\.?|fssai|website|www\S*)\b/i;
const PHONE_NO = /(?<!\d)[6-9]\d{9}(?!\d)/;
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/;
const EMAIL_ADDR = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

// dd/mm/yy, dd-mm-yyyy, "01/1026" (a lost slash) -> 'yyyy-mm-dd' or ''.
export function billDateOf(raw) {
  const t = String(raw || '').trim();
  let d; let m; let y;
  const parts = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(t);
  if (parts) [, d, m, y] = parts;
  else {
    const digits = t.replace(/\D/g, '');
    if (digits.length === 6) [d, m, y] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
    else if (digits.length === 8) [d, m, y] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
    else return '';
  }
  const year = Number(y.length === 2 ? `20${y}` : y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2100 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function extractBillHeader(layout) {
  const lines = (layout || []).map((l) => l.filter((w) => w.x != null).sort((a, b) => a.x - b.x)).filter((l) => l.length);
  const out = { vendorName: '', address: '', mobile: '', gstNo: '', email: '', billDate: '' };
  const textOf = (ws) => ws.map((w) => w.t).join(' ');

  // Bill date: "Bill Date : 01/10/26", "Invoice Date", or a plain "Date :".
  for (const re of [/\b(bill|invoice|inv)\.?\s*date\b\s*[:\-.]?\s*([0-9][0-9/\-. ]{4,10}[0-9])/i, /\bdate\b\s*[:\-.]?\s*([0-9][0-9/\-. ]{4,10}[0-9])/i]) {
    for (const l of lines) {
      const m = re.exec(textOf(l));
      const date = m && billDateOf(m[m.length - 1].split(' ')[0]);
      if (date) { out.billDate = date; break; }
    }
    if (out.billDate) break;
  }

  // The supplier's block: lines above the customer's.
  const end = lines.findIndex((l) => CUSTOMER.test(textOf(l)));
  const block = lines.slice(0, end > 0 ? end : Math.min(lines.length, 8));
  const blockText = block.map(textOf).join('\n');
  out.mobile = (PHONE_NO.exec(blockText.replace(/[\s-]/g, (c) => (c === '\n' ? c : ''))) || [''])[0];
  out.gstNo = (GSTIN.exec(blockText.toUpperCase()) || [''])[0];
  const email = (EMAIL_ADDR.exec(blockText) || [''])[0];
  out.email = /\.[a-z]{2,}$/i.test(email) ? email : '';

  // Each line's left part — the words before the right side's column (GST
  // No, DL No, Email... which starts after a wide gap at about the same place
  // on each line) — without phone numbers, emails and their labels.
  const widths = block.flat().filter((w) => /^[A-Za-z]{4,}$/.test(w.t)).map((w) => (w.x1 - w.x) / w.t.length);
  const wide = (widths.length ? median(widths) : 0.008) * 4;
  const rightStarts = block.map((l) => l.find((w, i) => i > 0 && w.x > 0.3 && w.x - (l[i - 1].x1 ?? l[i - 1].x) >= wide)?.x).filter((x) => x != null);
  const rightAt = rightStarts.length ? median(rightStarts) - 0.005 : 0.5;
  const leftOf = (l) => {
    const kept = [l[0]];
    // (A gap twice as wide also ends it: a stray mark far off to the right.)
    for (let i = 1; i < l.length && l[i].x < rightAt && l[i].x - (l[i - 1].x1 ?? l[i - 1].x) < wide * 2; i += 1) kept.push(l[i]);
    return kept;
  };
  const leftParts = block.map((l) => (l[0].x > 0.3 ? '' : leftOf(l)
    .map((w) => trimTok(cleanLine(w.t)))
    .filter((t) => t && !CONTACT_TOK.test(t) && !/\d{6,}|@/.test(t) && !/^[^A-Za-z0-9]+$/.test(t))
    .join(' ')
    .trim()));
  const nameAt = leftParts.findIndex((p) => letters(p) >= 4 && !NOT_NAME.test(p) && /[A-Za-z]{3,}/.test(p));
  if (nameAt < 0) return out;
  out.vendorName = leftParts[nameAt].replace(/\s+/g, ' ').toUpperCase().slice(0, 200);
  // Address: the lines after the name, leaving out "(Division of ...)" notes
  // and lines that held only contact details.
  out.address = leftParts.slice(nameAt + 1)
    .filter((p) => letters(p) >= 3 && !/^\(/.test(p) && !/^(of|division)\b/i.test(p) && !/division|distribution\s*service/i.test(p))
    .slice(0, 3)
    .join(', ')
    .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
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

// How alike two names are, 0..1, ignoring case, spaces and punctuation
// ("NAGAMMAIL PHARMA" vs "Nagammai Pharma" is about 0.96).
export const likeness = (a, b) => dice(compact(a), compact(b));

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
