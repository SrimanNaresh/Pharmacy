import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Wallet, Save, X, Trash2, BarChart3 } from 'lucide-react';
import { CardHeader, Spinner, Toast } from '../../components/ui.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { useToast } from '../../hooks/useToast.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { vendorApi, vendorBillPaymentApi } from '../../api/client.js';

const PAY_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card'];
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '');
const mmyy = (iso) => (iso ? `${String(new Date(iso).getMonth() + 1).padStart(2, '0')}/${String(new Date(iso).getFullYear()).slice(2)}` : '');
const num = (v) => String(Number(v));
const emptyPay = () => ({ payDate: today(), amount: '', payMode: 'Cash', referenceNo: '', notes: '' });

// Pharmacy > Vendor > Payments: pick an invoice (a Stock In, by its number),
// see its items and what's still owed, and record a payment against it.
// Balance = Total - Returns - Paid; the server checks it again on save.
export default function VendorPaymentEntry() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [showPaid, setShowPaid] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [inv, setInv] = useState(null); // the chosen invoice with items, returns, payments
  const [loading, setLoading] = useState(false);
  const [pay, setPay] = useState(emptyPay());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    vendorApi.list().then(setVendors).catch(() => show('Failed to load vendors', 'error'));
  }, [show]);

  const loadInvoices = useCallback(() => vendorBillPaymentApi.invoices({ vendorId: vendorId || undefined, all: showPaid ? '1' : undefined })
    .then(setInvoices).catch(() => show('Failed to load invoices', 'error')), [vendorId, showPaid, show]);
  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const loadInvoice = useCallback((id) => {
    if (!id) { setInv(null); return; }
    setLoading(true);
    vendorBillPaymentApi.invoice(id)
      .then((r) => { setInv(r); setPay({ ...emptyPay(), amount: r.Balance > 0 ? num(r.Balance) : '' }); })
      .catch(() => { setInv(null); show('Failed to load the invoice', 'error'); })
      .finally(() => setLoading(false));
  }, [show]);
  useEffect(() => { loadInvoice(invoiceId); }, [invoiceId, loadInvoice]);

  // Opened with an invoice from elsewhere: { state: { stockInId } }.
  useEffect(() => {
    const id = location.state?.stockInId;
    if (!id) return;
    navigate(location.pathname, { replace: true, state: null });
    setShowPaid(true);
    setInvoiceId(String(id));
  }, [location.state, location.pathname, navigate]);

  const vendorOptions = useMemo(() => vendors.map((v) => ({ value: String(v.VendorId), label: v.VendorName })), [vendors]);
  const invoiceOptions = useMemo(() => {
    const opts = invoices.map((i) => ({
      value: String(i.StockInId), label: i.InvoiceNo,
      hint: `${dateLabel(i.InDate)}${vendorId ? '' : ` · ${i.VendorName}`} · ${i.Balance > 0 ? `Bal ₹${money(i.Balance)}` : 'Paid'}`,
    }));
    // Keep the chosen invoice pickable even once it's fully paid and drops off the list.
    if (inv && !opts.some((o) => o.value === String(inv.StockInId))) opts.push({ value: String(inv.StockInId), label: inv.InvoiceNo, hint: 'Paid' });
    return opts;
  }, [invoices, vendorId, inv]);

  const pickVendor = (id) => {
    setVendorId(id);
    if (inv && String(inv.VendorId) !== id) setInvoiceId('');
  };
  const pickInvoice = (id) => {
    setInvoiceId(id);
    const i = invoices.find((x) => String(x.StockInId) === id);
    if (i && !vendorId) setVendorId(String(i.VendorId));
  };

  const amountBad = inv && pay.amount !== '' && !(Number(pay.amount) > 0 && Number(pay.amount) <= inv.Balance + 0.001);
  const refNeeded = pay.payMode !== 'Cash';
  const set = (k) => (e) => setPay((p) => ({ ...p, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (!inv) return show('Pick an Invoice No', 'error');
    if (!(Number(pay.amount) > 0)) return show('Enter the Amount', 'error');
    if (amountBad) return show(`Amount can't be more than the balance ₹${money(inv.Balance)}`, 'error');
    if (refNeeded && !pay.referenceNo.trim()) return show(`Reference No is required for ${pay.payMode}`, 'error');
    setSaving(true);
    try {
      const r = await vendorBillPaymentApi.create({ stockInId: inv.StockInId, ...pay });
      show(`Saved payment ${r.PaymentNo} · ₹${money(pay.amount)}${r.Balance > 0 ? ` · Balance ₹${money(r.Balance)}` : ' · Invoice fully paid'}`, 'success');
      loadInvoice(inv.StockInId);
      loadInvoices();
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removePayment = async (p) => {
    if (!confirm(`Delete payment ${p.PaymentNo} (₹${money(p.Amount)})?`)) return;
    try {
      await vendorBillPaymentApi.remove(p.PaymentId);
      show(`Deleted ${p.PaymentNo}`, 'success');
      loadInvoice(inv.StockInId);
      loadInvoices();
    } catch (err) {
      show(err.response?.data?.error || 'Could not delete the payment', 'error');
    }
  };

  const th = 'border border-ink-200 px-1.5 py-1 text-center text-[11px] font-semibold whitespace-nowrap';
  const td = 'border border-ink-200 px-1.5 py-0.5';
  const tdNum = `${td} text-right tabular-nums`;
  const sumRow = (label, value, cls = '') => (
    <div className={`flex items-center justify-between gap-4 px-3 py-1.5 ${cls}`}><span className="whitespace-nowrap">{label}</span><span className="whitespace-nowrap tabular-nums">{value}</span></div>
  );
  const totals = inv && inv.items.reduce((s, l) => ({ amount: s.amount + Number(l.Amount), gst: s.gst + Number(l.GST) }), { amount: 0, gst: 0 });

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={Wallet}
          title="Vendor Payments"
          subtitle="Pay a vendor against an invoice (Stock In No)"
          actions={(
            <button type="button" className="btn-secondary" onClick={() => navigate('/pharmacy/vendor-payments')}>
              <BarChart3 size={16} /> Payments Report
            </button>
          )}
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <label className="label">Vendor Name</label>
            <SearchPick className="input" placeholder="All vendors — search..." options={vendorOptions} value={vendorId} onChange={pickVendor} />
          </div>
          <div className="w-80">
            <label className="label">Invoice No *</label>
            <SearchPick className="input" placeholder={invoices.length ? 'Search invoice no...' : 'No unpaid invoices'} options={invoiceOptions} keepOrder value={invoiceId} onChange={pickInvoice} />
          </div>
          <label className="mb-2 flex items-center gap-1.5 text-sm text-ink-600">
            <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> Show paid invoices
          </label>
          {(vendorId || invoiceId) && (
            <button type="button" className="btn-secondary mb-0.5" onClick={() => { setVendorId(''); setInvoiceId(''); }}>
              <X size={15} /> Clear
            </button>
          )}
        </div>

        {loading && <Spinner />}
        {!loading && !inv && (
          <p className="mt-4 rounded-lg border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-400">
            Pick an Invoice No to see its items and pay it. {invoices.length} unpaid invoice{invoices.length === 1 ? '' : 's'}
            {vendorId ? ' for this vendor' : ''}{showPaid ? ' (paid ones included)' : ''}.
          </p>
        )}

        {!loading && inv && (
          <>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-ink-50 px-3 py-2 text-sm">
              <span><span className="text-ink-500">Invoice No:</span> <b className="text-brand-700">{inv.InvoiceNo}</b></span>
              <span><span className="text-ink-500">Date:</span> {dateLabel(inv.InDate)}</span>
              <span><span className="text-ink-500">Vendor:</span> <b>{inv.VendorName}</b></span>
              <span><span className="text-ink-500">Purchase No:</span> {inv.OrderNo}</span>
              {inv.returns.length > 0 && <span><span className="text-ink-500">Returns:</span> {inv.returns.map((r) => r.ReturnNo).join(', ')}</span>}
              <span className={`ml-auto rounded px-2 font-semibold ${inv.Balance > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                {inv.Balance > 0 ? (inv.Paid > 0 ? 'Part paid' : 'Unpaid') : 'Paid'}
              </span>
            </div>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[12px]">
                <thead className="bg-brand-50 text-brand-800">
                  <tr>
                    <th className={th}>#</th>
                    <th className={`${th} text-left`}>Item Name</th>
                    <th className={th}>Batch</th>
                    <th className={th}>Exp</th>
                    <th className={th}>Qty</th>
                    <th className={th} title="Free units aren't charged">Free</th>
                    <th className={th}>MRP</th>
                    <th className={th}>Rate</th>
                    <th className={th}>Amount</th>
                    <th className={th}>GST%</th>
                    <th className={th}>GST Amt</th>
                    <th className={th}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((l, i) => (
                    <tr key={l.LineId} className="hover:bg-ink-50">
                      <td className={`${td} text-center text-ink-400`}>{i + 1}</td>
                      <td className={td}>{l.ItemName}</td>
                      <td className={td}>{l.BatchNo}</td>
                      <td className={`${td} text-center`}>{mmyy(l.ExpDate)}</td>
                      <td className={tdNum}>{num(l.Quantity)}</td>
                      <td className={tdNum}>{Number(l.FreeQty) ? num(l.FreeQty) : ''}</td>
                      <td className={tdNum}>{money(l.MRP)}</td>
                      <td className={tdNum}>{money(l.Rate)}</td>
                      <td className={tdNum}>{money(l.Amount)}</td>
                      <td className={tdNum}>{num(l.GSTPercent)}</td>
                      <td className={tdNum}>{money(l.GST)}</td>
                      <td className={`${tdNum} font-semibold`}>{money(l.LineTotal)}</td>
                    </tr>
                  ))}
                  <tr className="bg-ink-50 font-semibold">
                    <td className={`${td} text-right`} colSpan={8}>Total</td>
                    <td className={tdNum}>{money(totals.amount)}</td>
                    <td className={td} />
                    <td className={tdNum}>{money(totals.gst)}</td>
                    <td className={tdNum}>{money(inv.Total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <form onSubmit={save} className="min-w-0 rounded-lg border border-ink-200 p-3">
                <h4 className="mb-2 text-sm font-bold text-ink-800">Payment</h4>
                {inv.Balance > 0 ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto] lg:items-end">
                    <div><label className="label">Date *</label><input type="date" className="input" value={pay.payDate} onChange={set('payDate')} /></div>
                    <div>
                      <label className="label">Amount *</label>
                      <input
                        type="number" min="0" step="0.01" className={`input no-spin text-right ${amountBad ? 'border-red-400 bg-red-50 text-red-700' : ''}`}
                        value={pay.amount} onChange={set('amount')} title={`Up to the balance ₹${money(inv.Balance)}`}
                      />
                    </div>
                    <div>
                      <label className="label">Payment Mode *</label>
                      <select className="input" value={pay.payMode} onChange={set('payMode')}>
                        {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">{pay.payMode === 'Cheque' ? 'Cheque No' : 'Reference No'}{refNeeded ? ' *' : ''}</label>
                      <input className="input" value={pay.referenceNo} onChange={set('referenceNo')} maxLength={50} placeholder={pay.payMode === 'UPI' || pay.payMode === 'Bank Transfer' ? 'UTR / Txn ID' : ''} />
                    </div>
                    <div><label className="label">Notes</label><input className="input" value={pay.notes} onChange={set('notes')} maxLength={300} /></div>
                    <button type="submit" className="btn-primary justify-center" disabled={saving || amountBad}>
                      <Save size={16} /> {saving ? 'Saving...' : 'Pay'}
                    </button>
                    {amountBad && <p className="col-span-full text-xs text-red-600">Amount must be more than 0 and not more than the balance ₹{money(inv.Balance)}.</p>}
                  </div>
                ) : (
                  <p className="text-sm text-emerald-700">This invoice is fully paid.</p>
                )}

                <h4 className="mb-1 mt-3 text-sm font-bold text-ink-800">Payments made</h4>
                {inv.payments.length ? (
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="bg-ink-50 text-ink-600">
                      <tr>
                        <th className={th}>Payment No</th>
                        <th className={th}>Date</th>
                        <th className={th}>Mode</th>
                        <th className={th}>Reference No</th>
                        <th className={`${th} text-left`}>Notes</th>
                        <th className={th}>By</th>
                        <th className={th}>Amount</th>
                        {isAdmin && <th className={th} />}
                      </tr>
                    </thead>
                    <tbody>
                      {inv.payments.map((p) => (
                        <tr key={p.PaymentId}>
                          <td className={`${td} font-medium text-brand-700`}>{p.PaymentNo}</td>
                          <td className={`${td} text-center`}>{dateLabel(p.PayDate)}</td>
                          <td className={td}>{p.PayMode}</td>
                          <td className={td}>{p.ReferenceNo}</td>
                          <td className={td}>{p.Notes}</td>
                          <td className={td}>{p.CreatedBy}</td>
                          <td className={tdNum}>{money(p.Amount)}</td>
                          {isAdmin && (
                            <td className={`${td} text-center`}>
                              <button type="button" className="rounded p-0.5 text-red-500 hover:bg-red-50" title="Delete payment" onClick={() => removePayment(p)}><Trash2 size={13} /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="text-xs text-ink-400">No payments yet.</p>}
              </form>

              <div className="rounded-lg border border-ink-200 py-1 text-sm">
                {sumRow('Invoice Total', `₹${money(inv.Total)}`)}
                {sumRow('Less Returns', `− ₹${money(inv.Returns)}`, 'text-red-600')}
                {sumRow('Net Payable', `₹${money(inv.NetPayable)}`, 'border-t border-ink-100 font-semibold')}
                {sumRow('Paid', `− ₹${money(inv.Paid)}`, 'text-emerald-700')}
                {sumRow('Balance', `₹${money(inv.Balance)}`, `border-t border-ink-100 text-base font-bold ${inv.Balance > 0 ? 'text-amber-700' : 'text-emerald-700'}`)}
              </div>
            </div>
          </>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
