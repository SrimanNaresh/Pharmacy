// Printable sales bill receipt — shared by the Sales Billing entry page (print
// right after Save) and the Sales Billing List page (reprint any past sale).
// Hidden until a print is triggered via window.print(); @media print rules
// elsewhere hide everything else (see index.css's .no-print / aside / header).
//
//   clinic: { Name, ContactNo, Address, PageHeight, PageWidth } from clinicApi.get()
//   bill:   { code, transDate, customerName, lines: [{itemName, batch, qty, rate, disc, amount}],
//             subTotal, discPercent, discountAmount, roundOff?, total }
// The Disc% column and the Sub Total / Discount rows only print when used.
export default function SalesBillReceipt({ clinic, bill }) {
  if (!bill) return null;
  const rowDisc = bill.lines.some((l) => l.disc);
  const span = rowDisc ? 5 : 4;
  return (
    <div className="hidden print:block">
      <div className="print-prescription card">
        <div className="border-b-2 border-brand-600 pb-4">
          <div className="mb-3 h-1.5 w-full rounded-full bg-brand-gradient" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-10 font-semibold uppercase tracking-wider text-teal-600">Sales Bill</p>
              <h1 className="text-xl font-bold leading-tight text-ink-800">{bill.code}</h1>
            </div>
            <div className="max-w-[260px] text-right">
              <p className="text-lg font-bold leading-tight text-brand-700">{clinic?.Name || 'Clinic'}</p>
              <div className="mt-1.5 space-y-1 text-xs text-ink-500">
                {clinic?.ContactNo && <p>{clinic.ContactNo}</p>}
                {clinic?.Address && <p>{clinic.Address}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 border-b border-ink-100 py-4 text-sm sm:grid-cols-2">
          <p><span className="font-semibold">Customer:</span> {bill.customerName || 'Walk-in'}</p>
          <p className="text-right"><span className="font-semibold">Date:</span> {new Date(bill.transDate).toLocaleDateString()}</p>
        </div>

        <div className="py-4">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-ink-200 text-xs uppercase text-ink-400">
                <th className="py-2">Item</th>
                <th className="py-2">Batch</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Rate</th>
                {rowDisc && <th className="py-2 text-right">Disc%</th>}
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l, i) => (
                <tr key={i} className="border-b border-ink-100">
                  <td className="py-2">{l.itemName}</td>
                  <td className="py-2">{l.batch || '-'}</td>
                  <td className="py-2 text-right">{l.qty}</td>
                  <td className="py-2 text-right">{l.rate.toFixed(2)}</td>
                  {rowDisc && <td className="py-2 text-right">{l.disc ? l.disc : '-'}</td>}
                  <td className="py-2 text-right">{l.amount.toFixed(2)}</td>
                </tr>
              ))}
              {bill.discountAmount > 0 && (
                <>
                  <tr className="text-ink-600">
                    <td className="pt-2" colSpan={span}>Sub Total</td>
                    <td className="pt-2 text-right">{bill.subTotal.toFixed(2)}</td>
                  </tr>
                  <tr className="text-ink-600">
                    <td className="py-1" colSpan={span}>Discount ({bill.discPercent}%)</td>
                    <td className="py-1 text-right">- {bill.discountAmount.toFixed(2)}</td>
                  </tr>
                </>
              )}
              {Number(bill.roundOff) !== 0 && !Number.isNaN(Number(bill.roundOff)) && (
                <tr className="text-ink-600">
                  <td className="py-1" colSpan={span}>Round Off</td>
                  <td className="py-1 text-right">{Number(bill.roundOff) > 0 ? '+ ' : '- '}{Math.abs(Number(bill.roundOff)).toFixed(2)}</td>
                </tr>
              )}
              <tr className="text-base font-semibold text-ink-800">
                <td className="py-2" colSpan={span}>Total</td>
                <td className="py-2 text-right">{bill.total.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-8 border-t-2 border-brand-100 pt-4">
          <div className="h-1 w-full rounded-full bg-brand-gradient opacity-70" />
          <p className="mt-2 text-center text-10 uppercase tracking-widest text-ink-300">
            This is a computer-generated bill
          </p>
        </div>
      </div>
    </div>
  );
}
