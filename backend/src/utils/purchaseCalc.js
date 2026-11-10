// Purchase / Order line formulas. The same file is in
// frontend/src/utils/purchaseCalc.js so the screen and the server work out
// every line the same way — keep the two copies identical.
//   P.Rate       = MRP - (MRP x Disc % / 100)   (Disc % is the discount off the MRP)
//   Amount       = Quantity x P.Rate (Free units aren't charged; the discount
//                  is already in the P.Rate, so it isn't taken off again)
//   GST %        = CGST % + SGST %
//   GST Amount   = Amount / 100 x GST %
//   Total Amount = Amount + GST Amount
// Each step is rounded to paise.

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

// P.Rate from the MRP and Disc %: e.g. MRP 140, Disc 40 % -> 84.
export const pRateOf = (mrp, discPercent) => round2(num(mrp) - (num(mrp) * num(discPercent)) / 100);

// discPercent is taken (callers pass the whole line) but already in the P.Rate.
// eslint-disable-next-line no-unused-vars
export function purchaseLine({ pRate, discPercent, quantity, cgstPercent, sgstPercent }) {
  const rate = round2(num(pRate));
  const amount = round2(num(quantity) * rate);
  const gstPercent = round2(num(cgstPercent) + num(sgstPercent));
  const gstAmount = round2((amount / 100) * gstPercent);
  return { rate, amount, gstPercent, gstAmount, total: round2(amount + gstAmount) };
}

export const purchaseTotal = (lines) => round2(lines.reduce((s, l) => s + purchaseLine(l).total, 0));

// Round Off: what takes a total to the nearest rupee.
//   e.g. 24.25 -> -0.25 (Net 24.00); 24.50 -> +0.50 (Net 25.00); 24.00 -> 0
export const roundOffOf = (total) => round2(Math.round(round2(total)) - round2(total));

// Stock In selling price: the MRP less Discount % of it.
//   e.g. MRP 32.12, Discount 10 % -> 28.91; no discount -> 32.12
export function selAmount({ mrp, discPercent }) {
  return round2(num(mrp) * (1 - num(discPercent) / 100));
}

// Pieces in one pack, read from the item's Pack text: "10's" / "10" / "10 tabs"
// -> 10, "1x15" -> 15, "10x10" -> 100. A volume or weight ("200ML", "50GM")
// or anything else can't be split, so it counts as 1.
export function packSize(pack) {
  const s = String(pack ?? '').trim().toLowerCase();
  const times = /^(\d+)\s*[x×*]\s*(\d+)/.exec(s);
  if (times) return Math.max(1, Number(times[1]) * Number(times[2]));
  const count = /^(\d+)\s*('?s|tabs?|tablets?|caps?|capsules?|nos|pcs?|pieces?)?$/.exec(s);
  return count ? Math.max(1, Number(count[1])) : 1;
}

// Pieces in one pack for a unit price. Item Master keeps the count in Type /
// Unit ("15" = 15 tablets a strip); when Unit isn't a count, the Pack text is
// read instead ("10's", "1x15"), and anything else counts as 1.
export function unitsPerPack(pack, unit) {
  const n = Number(String(unit ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : packSize(pack);
}

// Sales discounts. A row's Amount is Quantity x Sale Price less its Disc %;
// the bill's Discount % then comes off the rows' Sub Total.
//   e.g. 2 x 32.12 = 64.24, Disc 10 % -> 57.82; bill Disc 5 % of 57.82 -> 2.89, Total 54.93
export function saleLineAmount({ quantity, rate, discPercent }) {
  const gross = round2(num(quantity) * num(rate));
  return round2(gross - (gross * num(discPercent)) / 100);
}
export function saleBill(amounts, discPercent) {
  const subTotal = round2(amounts.reduce((s, a) => s + num(a), 0));
  const discountAmount = round2((subTotal * num(discPercent)) / 100);
  return { subTotal, discountAmount, total: round2(subTotal - discountAmount) };
}
