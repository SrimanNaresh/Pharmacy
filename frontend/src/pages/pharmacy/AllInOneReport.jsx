import { useEffect, useMemo, useState } from 'react';
import { LayoutList, Printer, Search } from 'lucide-react';
import { CardHeader, Spinner, EmptyState, Toast } from '../../components/ui.jsx';
import MultiSelect from '../../components/MultiSelect.jsx';
import { useToast } from '../../hooks/useToast.js';
import { pharmacyReportApi } from '../../api/client.js';

const dateLabel = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '');
const FORMAT = {
  date: dateLabel,
  money: (n) => (n == null ? '' : Number(n).toFixed(2)),
  qty: (n) => (n == null ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })),
  percent: (n) => (n == null ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })),
  text: (v) => (v == null ? '' : String(v)),
};
const NUMERIC = ['money', 'qty', 'percent'];
const BLANK = '(Blank)'; // how a blank value shows in a filter
const toLabel = (v) => (v === '' ? BLANK : v);
const fromLabel = (v) => (v === BLANK ? '' : v);

// Same height for every control on the filter rows (MultiSelect's own minimum).
const CONTROL_H = 'min-h-[42px]';

// A labelled field. Every label row has the same height, with room on the
// right for links (extra), so the controls below line up.
function Field({ label, extra, className = '', children }) {
  return (
    <div className={className}>
      <div className="mb-0.5 flex h-5 items-end justify-between gap-2">
        <label className="label mb-0 truncate">{label}</label>
        {extra}
      </div>
      {children}
    </div>
  );
}

// Pharmacy > Report > All in One: pick a screen, then its columns (and a date
// range for screens with dates); Show Report builds the table, which can be
// printed. Line columns (an item's details) give one row per item line. A
// picked dropdown-type column (Schedule, Status, Vendor...) also gets a filter
// of its values; none picked = all values.
export default function AllInOneReport() {
  const { toast, show } = useToast();
  const [screens, setScreens] = useState([]);
  const [screenKey, setScreenKey] = useState('');
  const [picked, setPicked] = useState([]); // column labels, as MultiSelect works in strings
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState(null); // { title, period, filterNote, columns, grain, rows }
  const [values, setValues] = useState({}); // column key -> its values (null while loading)
  const [filters, setFilters] = useState({}); // column key -> picked values (labels)
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    pharmacyReportApi.allInOneScreens().then(setScreens).catch(() => show('Failed to load the screens', 'error'));
  }, [show]);

  const screen = screens.find((s) => s.key === screenKey);
  // Picked columns that have a value filter, in the screen's order.
  const filterColumns = useMemo(
    () => (screen ? screen.columns.filter((c) => c.filter && picked.includes(c.label)) : []),
    [screen, picked],
  );

  useEffect(() => {
    for (const c of filterColumns) {
      if (c.key in values) continue;
      setValues((v) => ({ ...v, [c.key]: null })); // loading
      pharmacyReportApi.allInOneValues(screenKey, c.key)
        .then((list) => setValues((v) => ({ ...v, [c.key]: list.map(toLabel) })))
        .catch(() => show(`Failed to load the ${c.label} values`, 'error'));
    }
  }, [filterColumns, values, screenKey, show]);

  const pickScreen = (key) => {
    setScreenKey(key);
    setPicked([]);
    setValues({});
    setFilters({});
    setReport(null);
  };

  const run = async () => {
    if (!screen) return show('Pick a screen', 'error');
    // Columns show in the screen's own order, whatever order they were picked in.
    const columns = screen.columns.filter((c) => picked.includes(c.label));
    if (!columns.length) return show('Pick at least one column', 'error');
    if (from && to && from > to) return show('From date is after To date', 'error');
    setLoading(true);
    try {
      // Only filters of columns still picked, and only those with values chosen.
      const active = filterColumns.filter((c) => filters[c.key]?.length);
      const r = await pharmacyReportApi.allInOne({
        screen: screen.key, columns: columns.map((c) => c.key).join(','), from: screen.hasDate ? from : '', to: screen.hasDate ? to : '',
        filters: JSON.stringify(Object.fromEntries(active.map((c) => [c.key, filters[c.key].map(fromLabel)]))),
      });
      const period = !screen.hasDate || (!from && !to) ? '' : `${from ? dateLabel(from) : 'Start'} to ${to ? dateLabel(to) : 'Today'}`;
      const filterNote = active.map((c) => `${c.label}: ${filters[c.key].join(', ')}`).join(' · ');
      setReport({ title: screen.label, period, filterNote, columns, ...r });
    } catch (err) {
      show(err.response?.data?.error || 'Failed to load the report', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Totals for quantities and amounts. A document's own amounts repeat on each
  // of its lines, so they're only added up when the report is one row per document.
  const totals = useMemo(() => {
    if (!report) return null;
    const t = {};
    for (const c of report.columns) {
      if (c.type !== 'money' && c.type !== 'qty') continue;
      if (!c.line && report.grain === 'line') continue;
      t[c.key] = report.rows.reduce((sum, r) => sum + Number(r[c.key] || 0), 0);
    }
    return Object.keys(t).length ? t : null;
  }, [report]);

  const th = 'px-2 py-2';
  const td = 'px-2 py-1.5';

  return (
    <div>
      <div className="card">
        <CardHeader
          icon={LayoutList}
          title="All in One"
          subtitle="Pick a screen and the columns to see"
          actions={report && (
            <button type="button" className="btn-secondary no-print" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </button>
          )}
        />

        {/* Both rows share one 4-column grid, so the fields line up. */}
        <div className="no-print grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Screen Name">
            <select className={`input ${CONTROL_H}`} value={screenKey} onChange={(e) => pickScreen(e.target.value)}>
              <option value="">Select screen...</option>
              {screens.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field
            label="Column Name"
            className="sm:col-span-2"
            extra={screen && (
              <span className="flex gap-3 text-xs">
                <button type="button" className="text-brand-600 hover:underline" onClick={() => setPicked(screen.columns.map((c) => c.label))}>Select all</button>
                <button type="button" className="text-ink-500 hover:underline" onClick={() => setPicked([])}>Clear</button>
              </span>
            )}
          >
            {screen ? (
              <MultiSelect options={screen.columns.map((c) => c.label)} value={picked} onChange={setPicked} placeholder="Select columns..." />
            ) : (
              <div className={`input ${CONTROL_H} flex items-center text-ink-400`}>Select a screen first</div>
            )}
          </Field>
          <Field label={' '} className="sm:col-span-2 lg:col-span-1">
            <button type="button" className={`btn-primary ${CONTROL_H} w-full justify-center`} onClick={run} disabled={loading}>
              <Search size={16} /> {loading ? 'Loading...' : 'Show Report'}
            </button>
          </Field>

          {screen?.hasDate && (
            <>
              <Field label="From">
                <input type="date" className={`input ${CONTROL_H}`} value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input type="date" className={`input ${CONTROL_H}`} value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </>
          )}
          {filterColumns.map((c) => (
            <Field key={c.key} label={<>{c.label} <span className="font-normal text-ink-400">(filter)</span></>}>
              <MultiSelect
                options={values[c.key] || []}
                value={filters[c.key] || []}
                onChange={(v) => setFilters((f) => ({ ...f, [c.key]: v }))}
                placeholder={values[c.key] ? 'All' : 'Loading...'}
              />
            </Field>
          ))}
        </div>
        {screen?.columns.some((c) => c.line) && (
          <p className="no-print mt-2 text-xs text-ink-500">
            Picking an item column (Item Name, Batch, Quantity…) lists each item line; otherwise one row per {screen.label} entry.
          </p>
        )}

        {loading ? (
          <Spinner />
        ) : report && (
          <div className="mt-4">
            <style>{'@media print { @page { size: landscape; } }'}</style>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-ink-800">{report.title} Report</h2>
                {report.filterNote && <p className="text-xs text-ink-500">{report.filterNote}</p>}
              </div>
              <p className="text-xs text-ink-500">
                {report.period && <>{report.period} · </>}{report.rows.length} {report.grain === 'line' ? 'lines' : 'rows'} · Printed {new Date().toLocaleString('en-GB')}
              </p>
            </div>
            {report.rows.length === 0 ? (
              <EmptyState message="Nothing to show for this selection." />
            ) : (
              <div className="overflow-x-auto print:overflow-visible">
                <table className="w-full text-left text-sm print:text-xs">
                  <thead>
                    <tr className="table-head">
                      <th className={`${th} rounded-l-lg text-right`}>#</th>
                      {report.columns.map((c, i) => (
                        <th key={c.key} className={`${th} ${NUMERIC.includes(c.type) ? 'text-right' : ''} ${i === report.columns.length - 1 ? 'rounded-r-lg' : ''}`}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r, n) => (
                      <tr key={n} className="border-b border-ink-100 break-inside-avoid">
                        <td className={`${td} text-right text-ink-400`}>{n + 1}</td>
                        {report.columns.map((c) => (
                          <td key={c.key} className={`${td} ${NUMERIC.includes(c.type) ? 'whitespace-nowrap text-right' : ''} ${c.type === 'date' ? 'whitespace-nowrap' : ''}`}>
                            {FORMAT[c.type](r[c.key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {totals && (
                    <tfoot>
                      <tr className="bg-ink-800 font-semibold text-white print:bg-white print:text-ink-900">
                        <td className={td}>Total</td>
                        {report.columns.map((c) => (
                          <td key={c.key} className={`${td} whitespace-nowrap text-right`}>
                            {c.key in totals ? FORMAT[c.type](totals[c.key]) : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
