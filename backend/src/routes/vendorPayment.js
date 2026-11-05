import { Router } from 'express';
import { getPool, sql } from '../db/pool.js';
import { docNo, docNoSql } from '../utils/docNumber.js';

// Pharmacy > Vendor > Payments: pay a vendor against one Stock In (its invoice
// number is the Stock In No). Amounts follow the Vendor Payments report: a
// line charges its paid Quantity x Rate plus its order line's GST; a Return
// credits its units at the line's rate spread over paid + free units.
// Balance = Total - Returns - Paid. Only an Admin may delete a payment.
const router = Router();

export const PAY_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card'];
const SI_NO = docNoSql('SI', 'h.StockInId');
const VP_NO = docNoSql('VP', 'p.PaymentId');
const text = (v) => (v == null ? '' : String(v).trim());
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// One row per active Stock In with its Total, Returns, Paid and Balance.
export const INVOICES = `
  SELECT h.StockInId, ${SI_NO} AS InvoiceNo, h.InDate, h.VendorId, v.VendorName, h.PurchaseOrderId,
         ${docNoSql('PO', 'h.PurchaseOrderId')} AS OrderNo,
         ISNULL((SELECT SUM(a + ROUND(a * g / 100, 2)) FROM (
           SELECT ROUND(l.Quantity * l.Rate, 2) AS a, ISNULL(pol.CGSTPercent, 0) + ISNULL(pol.SGSTPercent, 0) AS g
           FROM StockInItem l JOIN PurchaseOrderItem pol ON pol.LineId = l.PoLineId
           WHERE l.StockInId = h.StockInId) x), 0) AS Total,
         ISNULL((SELECT SUM(a + ROUND(a * g / 100, 2)) FROM (
           SELECT ROUND(ri.Quantity * ri.Rate * sl.Quantity / NULLIF(sl.Quantity + sl.FreeQty, 0), 2) AS a,
                  ISNULL(pol.CGSTPercent, 0) + ISNULL(pol.SGSTPercent, 0) AS g
           FROM StockReturnItem ri
           JOIN StockReturn rh ON rh.StockReturnId = ri.StockReturnId AND rh.IsActive = 1
           JOIN StockInItem sl ON sl.LineId = ri.StockInLineId
           JOIN PurchaseOrderItem pol ON pol.LineId = sl.PoLineId
           WHERE rh.StockInId = h.StockInId) y), 0) AS Returns,
         ISNULL((SELECT SUM(p.Amount) FROM VendorPayment p WHERE p.StockInId = h.StockInId AND p.IsActive = 1), 0) AS Paid
  FROM StockIn h JOIN Vendor v ON v.VendorId = h.VendorId
  WHERE h.IsActive = 1
`;
export const withBalance = (r) => {
  const net = round2(Number(r.Total) - Number(r.Returns));
  return { ...r, NetPayable: net, Balance: round2(net - Number(r.Paid)) };
};

// Invoices for the Invoice No drop-down, newest first. ?vendorId narrows to one
// vendor; ?all=1 keeps fully paid ones too.
router.get('/invoices', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request()
      .input('vendorId', sql.Int, Number(req.query.vendorId) || null)
      .query(`SELECT * FROM (${INVOICES}) i WHERE (@vendorId IS NULL OR i.VendorId = @vendorId) ORDER BY i.InDate DESC, i.StockInId DESC`);
    const rows = r.recordset.map(withBalance);
    res.json(req.query.all === '1' ? rows : rows.filter((x) => x.Balance > 0));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One invoice: its totals, items, returns and payments.
router.get('/invoices/:stockInId', async (req, res) => {
  try {
    const pool = await getPool();
    const id = Number(req.params.stockInId);
    const head = await pool.request().input('id', sql.Int, id)
      .query(`SELECT * FROM (${INVOICES}) i WHERE i.StockInId = @id`);
    if (!head.recordset.length) return res.status(404).json({ error: 'Invoice not found' });
    const items = await pool.request().input('id', sql.Int, id).query(`
      SELECT l.LineId, i.Name AS ItemName, l.BatchNo, l.ExpDate, l.Quantity, l.FreeQty, l.Rate, l.MRP,
             ISNULL(pol.CGSTPercent, 0) + ISNULL(pol.SGSTPercent, 0) AS GSTPercent,
             ROUND(l.Quantity * l.Rate, 2) AS Amount
      FROM StockInItem l
      JOIN PurchaseOrderItem pol ON pol.LineId = l.PoLineId
      JOIN PharmacyItem i ON i.ItemId = l.ItemId
      WHERE l.StockInId = @id ORDER BY l.LineId`);
    const returns = await pool.request().input('id', sql.Int, id).query(`
      SELECT rh.StockReturnId, ${docNoSql('RT', 'rh.StockReturnId')} AS ReturnNo, rh.ReturnDate
      FROM StockReturn rh WHERE rh.StockInId = @id AND rh.IsActive = 1 ORDER BY rh.ReturnDate, rh.StockReturnId`);
    const payments = await pool.request().input('id', sql.Int, id).query(`
      SELECT p.PaymentId, ${VP_NO} AS PaymentNo, p.PayDate, p.Amount, p.PayMode, p.ReferenceNo, p.Notes, p.CreatedBy
      FROM VendorPayment p WHERE p.StockInId = @id AND p.IsActive = 1 ORDER BY p.PayDate, p.PaymentId`);
    res.json({
      ...withBalance(head.recordset[0]),
      items: items.recordset.map((l) => {
        const gst = round2(Number(l.Amount) * Number(l.GSTPercent) / 100);
        return { ...l, GST: gst, LineTotal: round2(Number(l.Amount) + gst) };
      }),
      returns: returns.recordset,
      payments: payments.recordset,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pay: { stockInId, payDate, amount, payMode, referenceNo?, notes? }. The
// amount can't be more than the invoice's balance.
router.post('/', async (req, res) => {
  const b = req.body || {};
  const stockInId = Number(b.stockInId);
  if (!(stockInId > 0)) return res.status(400).json({ error: 'Invoice No is required' });
  const payDate = text(b.payDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) return res.status(400).json({ error: 'Payment Date is required' });
  const amount = round2(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Amount must be more than 0' });
  const payMode = text(b.payMode);
  if (!PAY_MODES.includes(payMode)) return res.status(400).json({ error: `Payment Mode must be one of ${PAY_MODES.join(', ')}` });
  const referenceNo = text(b.referenceNo) || null;
  if (referenceNo && referenceNo.length > 50) return res.status(400).json({ error: 'Reference No must be at most 50 characters' });
  if (payMode !== 'Cash' && !referenceNo) return res.status(400).json({ error: `Reference No is required for ${payMode}` });
  const notes = text(b.notes) || null;
  if (notes && notes.length > 300) return res.status(400).json({ error: 'Notes must be at most 300 characters' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();
    // One payment at a time per invoice, so two can't both use the same balance.
    await new sql.Request(tx).input('res', sql.NVarChar, `vendor-payment-${stockInId}`)
      .query("EXEC sp_getapplock @Resource = @res, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000");
    const r = await new sql.Request(tx).input('id', sql.Int, stockInId)
      .query(`SELECT * FROM (${INVOICES}) i WHERE i.StockInId = @id`);
    const inv = r.recordset[0] && withBalance(r.recordset[0]);
    if (!inv) {
      await tx.rollback();
      return res.status(404).json({ error: 'Invoice not found' });
    }
    if (payDate < new Date(inv.InDate).toISOString().slice(0, 10)) {
      await tx.rollback();
      return res.status(400).json({ error: 'Payment Date can\'t be before the invoice date' });
    }
    if (amount > inv.Balance) {
      await tx.rollback();
      return res.status(400).json({ error: `Amount is more than the balance ${inv.Balance.toFixed(2)}` });
    }
    const ins = await new sql.Request(tx)
      .input('vendorId', sql.Int, inv.VendorId)
      .input('stockInId', sql.Int, stockInId)
      .input('payDate', sql.Date, payDate)
      .input('amount', sql.Decimal(12, 2), amount)
      .input('payMode', sql.NVarChar(20), payMode)
      .input('ref', sql.NVarChar(50), referenceNo)
      .input('notes', sql.NVarChar(300), notes)
      .input('by', sql.NVarChar(100), req.user?.username || null)
      .query(`INSERT INTO VendorPayment (VendorId, StockInId, PayDate, Amount, PayMode, ReferenceNo, Notes, CreatedBy)
              OUTPUT INSERTED.PaymentId
              VALUES (@vendorId, @stockInId, @payDate, @amount, @payMode, @ref, @notes, @by)`);
    await tx.commit();
    const id = ins.recordset[0].PaymentId;
    res.status(201).json({ PaymentId: id, PaymentNo: docNo('VP', id), Balance: round2(inv.Balance - amount) });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.user?.role !== 'Admin') return res.status(403).json({ error: 'Only an Admin can delete a payment' });
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, req.params.id)
      .query('UPDATE VendorPayment SET IsActive = 0 WHERE PaymentId = @id AND IsActive = 1');
    if (!r.rowsAffected[0]) return res.status(404).json({ error: 'Payment not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
