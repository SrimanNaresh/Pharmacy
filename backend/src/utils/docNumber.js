// Document numbers: <CLINIC CODE>-<PREFIX><4 digits>, e.g. AP-S0001. Built
// from the row's id, so there's nothing to generate or keep unique; past 9999
// the number just gets longer.
export const CLINIC_CODE = process.env.CLINIC_CODE || 'AP';

export const docNo = (prefix, id) => `${CLINIC_CODE}-${prefix}${String(id).padStart(4, '0')}`;

// The same number as a SQL expression over an id column.
export const docNoSql = (prefix, idExpr) =>
  `'${CLINIC_CODE}-${prefix}' + CASE WHEN ${idExpr} < 10000 THEN RIGHT('0000' + CAST(${idExpr} AS VARCHAR(10)), 4) ELSE CAST(${idExpr} AS VARCHAR(10)) END`;

// Parses a number back to its id (AP-S0012 -> 12); null when it doesn't match.
export function idFromDocNo(prefix, value) {
  const m = new RegExp(`^${CLINIC_CODE}-${prefix}0*(\\d+)$`, 'i').exec(String(value || '').trim());
  return m ? Number(m[1]) : null;
}
