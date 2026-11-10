// Reading a purchase bill (photo or PDF) for Item Master > Scan Bill.
//  - loadBillPages(file): the bill as page pictures (canvases) to preview.
//  - createOcr(): a Tesseract reader that can turn a page upright and read a
//    page, or just a selected part of it (e.g. the Item Description column).
// Tesseract and PDF.js are loaded only when a bill is scanned, so they don't
// slow the rest of the app.

const MAX_PDF_PAGES = 10;
const PAGE_PX = 2600; // longest side of a page picture

function blankCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// The source scaled so its longest side is at most `max` px, on white.
function fitted(source, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = blankCanvas(w * k, h * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image can't be opened — use a JPG or PNG photo, or a PDF")); };
    img.src = url;
  });
}

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

// -> [canvas] one per page (a photo is one page; a PDF up to 10 pages).
export async function loadBillPages(file) {
  if (isPdf(file)) {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    try {
      for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n += 1) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: PAGE_PX / Math.max(base.width, base.height) });
        const c = blankCanvas(viewport.width, viewport.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push(c);
      }
    } finally {
      pdf.destroy();
    }
    return pages;
  }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name)) {
    throw new Error('Choose a photo (JPG / PNG) or a PDF of the bill');
  }
  const img = await loadImage(file);
  return [fitted(img, img.naturalWidth, img.naturalHeight, 4000)];
}

// A copy turned by 90, 180 or 270 degrees clockwise.
export function rotateCanvas(src, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (!d) return src;
  const side = d % 180 !== 0;
  const c = blankCanvas(side ? src.height : src.width, side ? src.width : src.height);
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// The part of the page inside rect ({ x, y, w, h } as shares of the page), or
// the whole page; grey and scaled so the text is big enough for Tesseract
// (small print reads far better upscaled).
function prepared(src, rect, size = 2400, max = 4000) {
  const r = rect || { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(r.x * src.width);
  const sy = Math.round(r.y * src.height);
  const sw = Math.max(1, Math.round(r.w * src.width));
  const sh = Math.max(1, Math.round(r.h * src.height));
  const longest = Math.max(sw, sh);
  const k = longest < size ? Math.min(3, size / longest) : longest > max ? max / longest : 1;
  const c = blankCanvas(sw * k, sh * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g; d[i + 1] = g; d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Words Tesseract is sure of: a page the right way up has many, a sideways or
// upside-down one almost none.
const sureWords = (data) => (data.words || []).filter((w) => w.confidence >= 70 && /[A-Za-z]{3,}/.test(w.text)).length;

// Sure words in the middle strip that show the page is the right way up
// (sideways or upside-down text gives almost none).
const CLEARLY_UPRIGHT = 12;

// The middle of the page, top to bottom (where the item rows are), enlarged
// and grey like a real read — but no bigger than needed, so it reads fast.
function middleStrip(page) {
  const h = page.height > page.width ? 0.3 : 0.45;
  return prepared(page, { x: 0, y: (1 - h) / 2, w: 1, h }, 1800, 1800);
}

// Does the text run across the page (upright or upside down) rather than up
// and down it (sideways)? Lines of print leave blank rows of pixels between
// them; sideways, the blank lines run top to bottom instead. A quick guess
// from a small copy of the page, only used to pick which angle to try first.
function linesRunAcross(page) {
  const small = fitted(page, page.width, page.height, 400);
  const { width: w, height: h } = small;
  const d = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const rows = new Array(h).fill(0);
  const cols = new Array(w).fill(0);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < 384) { rows[y] += 1; cols[x] += 1; }
    }
  }
  // How many times the ink comes and goes along each direction: print lines
  // stacked down the page make many such bands.
  const bands = (counts, across) => {
    let n = 0;
    let inked = false;
    for (const c of counts) {
      const now = c > across * 0.01;
      if (now && !inked) n += 1;
      inked = now;
    }
    return n;
  };
  return bands(rows, w) >= bands(cols, h);
}

// One Tesseract reader, kept while the Scan Bill popup is open.
export async function createOcr() {
  const { createWorker } = await import('tesseract.js');
  let onPercent = null;
  const worker = await createWorker('eng', 1, {
    logger: (m) => { if (onPercent && m.status === 'recognizing text') onPercent(Math.round(m.progress * 100)); },
  });
  // PSM 6: read as one block of rows — keeps each bill row on one line.
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });

  return {
    // How far to turn the page (clockwise) so its text is upright: 0, 90, 180 or 270.
    // Bills are often scanned sideways (a landscape bill on a portrait page).
    // Only a strip across the middle is read for this, enlarged like a real
    // read (a small photo read as is gives too few sure words and every
    // angle got tried), and it stops at the first angle that reads clearly.
    // first: the angle to try first (a PDF's other pages: page 1's angle).
    async uprightAngle(page, first = null) {
      const order = [...new Set([first, ...(linesRunAcross(page) ? [0, 180, 90, 270] : [90, 270, 0, 180])].filter((d) => d != null))];
      let best = { deg: 0, score: -1 };
      for (const deg of order) {
        const score = sureWords((await worker.recognize(middleStrip(rotateCanvas(page, deg)))).data);
        if (score > best.score) best = { deg, score };
        if (score >= CLEARLY_UPRIGHT) break;
      }
      return best.deg;
    },
    // Read the page, or just rect on it -> { text, layout: [[{ t, x, x1, c }]] },
    // x / x1 (left / right edge) as shares of the area's width — lets the
    // bill's columns (Rack, MFR, Item Description, HSN...) be told apart;
    // c: how sure OCR is of the word (0-100).
    async read(page, rect, percent) {
      onPercent = percent || null;
      try {
        const area = prepared(page, rect);
        const { data } = await worker.recognize(area);
        const layout = (data.lines || []).map((l) => (l.words || []).map((w) => ({ t: w.text, x: w.bbox.x0 / area.width, x1: w.bbox.x1 / area.width, c: w.confidence })));
        return { text: data.text, layout };
      } finally {
        onPercent = null;
      }
    },
    done: () => worker.terminate(),
  };
}
