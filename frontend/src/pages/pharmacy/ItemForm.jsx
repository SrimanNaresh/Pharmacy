import CellCombo from './CellCombo.jsx';

// The Item form's fields, shared by Item Master and the Add / Edit item
// popup on Purchase / Order.

export const MAX_GST = 28;

export const emptyForm = {
  name: '', unit: '', hsnCode: '', pack: '', mrp: '', cgstPercent: '', sgstPercent: '', rack: '', boxNo: '',
  generic: '', manufacturer: '', category: '', potency: '', schedule: 'None', status: 'Active',
};

const str = (v) => (v == null ? '' : String(v));
const numStr = (v) => (v == null ? '' : String(Number(v)));

export const rowToForm = (r) => ({
  name: str(r.Name), unit: str(r.UnitName), hsnCode: str(r.HSNCode), pack: str(r.Pack),
  mrp: numStr(r.MRP), cgstPercent: numStr(r.CGSTPercent), sgstPercent: numStr(r.SGSTPercent),
  rack: str(r.Rack), boxNo: str(r.BoxNo), generic: str(r.GenericName), manufacturer: str(r.ManufacturerName),
  category: str(r.Category), potency: str(r.Potency), schedule: r.Schedule || 'None', status: r.Status || 'Active',
});

// Same checks the server runs; returns the first problem or null.
export function validate(f) {
  if (!f.name.trim()) return 'Item Name is required';
  if (f.mrp !== '' && !(Number(f.mrp) >= 0)) return 'MRP must be 0 or more';
  const c = Number(f.cgstPercent || 0);
  const s = Number(f.sgstPercent || 0);
  if (!(c >= 0 && c <= MAX_GST) || !(s >= 0 && s <= MAX_GST)) return `CGST % and SGST % must be between 0 and ${MAX_GST}`;
  if (c + s > MAX_GST) return `CGST % + SGST % can't be more than ${MAX_GST}`;
  return null;
}

// The two rows of fields. `narrow` lays them out for a popup instead of the
// full page width. Stock isn't edited here: on Edit it's shown read-only
// (editing.stock) — Stock In and Stock Adjustment change it.
export function ItemFields({ form, setForm, editing, handlersFor, narrow = false, autoFocus = false }) {
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const onInput = (key) => (e) => set(key)(e.target.value);
  const inp = 'input';
  const combo = inp;
  const field = (label, child, extra = '') => (
    <div className={extra}>
      <label className="label truncate whitespace-nowrap" title={label}>{label}</label>
      {child}
    </div>
  );

  return (
    <>
      <div className={`grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 ${narrow ? 'lg:grid-cols-5' : editing ? 'lg:grid-cols-[2.4fr_1fr_1.6fr_repeat(7,minmax(0,1fr))]' : 'lg:grid-cols-[2.4fr_1fr_1.6fr_repeat(6,minmax(0,1fr))]'}`}>
        {field('Item Name *', <input autoFocus={autoFocus} className={inp} value={form.name} onChange={onInput('name')} placeholder="e.g. Arnica Montana" />, narrow ? 'col-span-2' : 'col-span-2 sm:col-span-2 lg:col-span-1')}
        {field('Pack', <input className={inp} value={form.pack} onChange={onInput('pack')} placeholder="10's" />)}
        {field('Type / Unit', <CellCombo className={combo} value={form.unit} onChange={set('unit')} placeholder="Pick or add" {...handlersFor('unit')} />)}
        {field('HSN', <input className={inp} value={form.hsnCode} onChange={onInput('hsnCode')} />)}
        {editing && field('Stock', (
          <input className={`${inp} bg-ink-50 text-ink-500`} value={editing.stock} readOnly tabIndex={-1} title="Change stock through Stock In or Stock Adjustment" />
        ))}
        {field('MRP', <input type="number" min="0" step="0.01" className={inp} value={form.mrp} onChange={onInput('mrp')} />)}
        {field('CGST %', <input type="number" min="0" max={MAX_GST} step="0.01" className={inp} value={form.cgstPercent} onChange={onInput('cgstPercent')} />)}
        {field('SGST %', <input type="number" min="0" max={MAX_GST} step="0.01" className={inp} value={form.sgstPercent} onChange={onInput('sgstPercent')} />)}
        {field('Rack', <input className={inp} value={form.rack} onChange={onInput('rack')} />)}
        {field('Box', <input className={inp} value={form.boxNo} onChange={onInput('boxNo')} />)}
      </div>

      <div className={`mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 ${narrow ? 'lg:grid-cols-3' : 'lg:grid-cols-6'}`}>
        {field('Generic Name', <CellCombo className={combo} value={form.generic} onChange={set('generic')} placeholder="Pick or add" {...handlersFor('generic')} />)}
        {field('Manufacturer', <CellCombo className={combo} value={form.manufacturer} onChange={set('manufacturer')} placeholder="Pick or add" {...handlersFor('manufacturer')} />)}
        {field('Category', <CellCombo className={combo} value={form.category} onChange={set('category')} placeholder="Pick or add" {...handlersFor('category')} />)}
        {field('Potency', <CellCombo className={combo} value={form.potency} onChange={set('potency')} placeholder="Pick or add" {...handlersFor('potency')} />)}
        {field('Schedule', (
          <select className={inp} value={form.schedule} onChange={onInput('schedule')}>
            <option value="None">None</option>
            <option value="H">H</option>
            <option value="H1">H1</option>
          </select>
        ))}
        {field('Status', (
          <select className={inp} value={form.status} onChange={onInput('status')}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        ))}
      </div>
    </>
  );
}
