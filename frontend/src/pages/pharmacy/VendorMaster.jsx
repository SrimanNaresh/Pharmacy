import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Store, Save, Trash2, X } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { vendorApi } from '../../api/client.js';
import { isValidNumeric, isValidEmail } from '../../utils/validators.js';
import { INDIAN_STATES } from '../../utils/indianStates.js';

// contactNo is the Mobile No, alternateNo the Phone No (see routes/vendor.js).
const emptyForm = {
  vendorName: '', contactPerson: '', address: '', email: '',
  state: '', pincode: '', alternateNo: '', contactNo: '', gstNo: '', dlNo: '', dlNo2: '',
  status: 'Active',
};

const rowToForm = (r) => ({
  vendorName: r.VendorName || '', contactPerson: r.ContactPerson || '', address: r.Address || '',
  email: r.Email || '', state: r.State || '', pincode: r.Pincode || '', alternateNo: r.AlternateNo || '',
  contactNo: r.ContactNo || '', gstNo: r.GSTNo || '', dlNo: r.DLNo || '', dlNo2: r.DLNo2 || '',
  status: r.Status || 'Active',
});

// Same checks the server runs; returns the first problem or null.
function validate(f) {
  if (!f.vendorName.trim()) return 'Vendor name is required';
  if (!f.address.trim()) return 'Address is required';
  if (!f.contactNo.trim()) return 'Mobile No is required';
  if (!isValidNumeric(f.contactNo)) return 'Mobile No must contain numbers only';
  if (!isValidNumeric(f.alternateNo)) return 'Phone No must contain numbers only';
  if (f.pincode && !/^\d{6}$/.test(f.pincode)) return 'Pin code must be 6 digits';
  if (f.gstNo && !/^[0-9A-Z]{15}$/.test(f.gstNo)) return 'GSTIN must be 15 letters / digits';
  if (!isValidEmail(f.email)) return 'Enter a valid email address';
  return null;
}

export default function VendorMaster() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [form, setForm] = useState(emptyForm);
  // Set when Vendor List's Edit opened a vendor here; null while adding a new one.
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (location.state?.editVendor) {
      setForm(rowToForm(location.state.editVendor));
      setEditingId(location.state.editVendor.VendorId);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  const update = (key) => (e) => setForm((c) => ({ ...c, [key]: e.target.value }));
  const updateUpper = (key) => (e) => setForm((c) => ({ ...c, [key]: e.target.value.toUpperCase() }));
  const updateDigits = (key, max) => (e) => setForm((c) => ({ ...c, [key]: e.target.value.replace(/\D/g, '').slice(0, max) }));

  // The list shows `flash` as a toast, since this page's own toast goes away with it.
  const backToList = (flash) => navigate('/pharmacy/vendor-list', flash ? { state: { flash } } : undefined);

  const cancel = () => {
    if (editingId) return backToList();
    setForm(emptyForm);
  };

  const save = async (e) => {
    e.preventDefault();
    const problem = validate(form);
    if (problem) return show(problem, 'error');
    setSaving(true);
    try {
      if (editingId) {
        await vendorApi.update(editingId, form);
        backToList('Vendor updated successfully');
      } else {
        await vendorApi.create(form);
        show('Vendor saved successfully', 'success');
        setForm(emptyForm);
      }
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    if (!confirm(`Delete vendor "${form.vendorName}"?`)) return;
    try {
      await vendorApi.remove(editingId);
      backToList('Vendor deleted successfully');
    } catch (err) {
      show(err.response?.data?.error || 'Delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="card">
        <form onSubmit={save}>
          <CardHeader
            icon={Store}
            title={editingId ? 'Edit Vendor' : 'Vendor Master'}
            subtitle={editingId ? 'Update or delete this vendor' : 'Register a new vendor'}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">Vendor name *</label>
              <input className="input" value={form.vendorName} onChange={update('vendorName')} placeholder="e.g. Sri Murugan Medicals" />
            </div>
            <div>
              <label className="label">Contact person</label>
              <input className="input" value={form.contactPerson} onChange={update('contactPerson')} placeholder="Person to contact" />
            </div>
            <div>
              <label className="label">Address *</label>
              <textarea className="input" rows={2} value={form.address} onChange={update('address')} placeholder="Vendor address" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email} onChange={update('email')} placeholder="e.g. orders@vendor.com" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className="col-span-2 sm:col-span-1">
              <label className="label">State</label>
              <select className="input" value={form.state} onChange={update('state')}>
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Pin code</label>
              <input inputMode="numeric" className="input" value={form.pincode} onChange={updateDigits('pincode', 6)} placeholder="6 digits" />
            </div>
            <div>
              <label className="label">Phone No</label>
              <input type="tel" inputMode="numeric" className="input" value={form.alternateNo} onChange={update('alternateNo')} placeholder="Landline" />
            </div>
            <div>
              <label className="label">Mobile No *</label>
              <input type="tel" inputMode="numeric" className="input" value={form.contactNo} onChange={update('contactNo')} placeholder="e.g. 98765 43210" />
            </div>
            <div>
              <label className="label">GSTIN</label>
              <input className="input" maxLength={15} value={form.gstNo} onChange={updateUpper('gstNo')} placeholder="15 characters" />
            </div>
            <div>
              <label className="label">DL No 1</label>
              <input className="input" value={form.dlNo} onChange={updateUpper('dlNo')} placeholder="Drug licence 1" />
            </div>
            <div>
              <label className="label">DL No 2</label>
              <input className="input" value={form.dlNo2} onChange={updateUpper('dlNo2')} placeholder="Drug licence 2" />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={update('status')}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={cancel}>
              <X size={16} /> Cancel
            </button>
            <button type="button" className="btn-danger" onClick={remove} disabled={!editingId} title={editingId ? 'Delete this vendor' : 'Open a vendor from Vendor List to delete it'}>
              <Trash2 size={16} /> Delete
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Save size={16} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>

      <Toast toast={toast} />
    </div>
  );
}
