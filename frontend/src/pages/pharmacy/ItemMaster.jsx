import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Package, Save, X, List, ScanLine } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import { useToast } from '../../hooks/useToast.js';
import { itemMasterApi } from '../../api/client.js';
import { MAX_GST, emptyForm, rowToForm, validate, ItemFields } from './ItemForm.jsx';
import { usePickLists } from './usePickLists.js';
import ScanBillModal from './ScanBillModal.jsx';

// Pharmacy > Item > Master: add or edit an item. Stock comes from Stock In and
// Stock Adjustment; on Edit the current stock is shown read-only.
export default function ItemMaster() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const { handlersFor } = usePickLists((m) => show(m, 'error'));
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null); // { id, code, stock } while editing
  const [saving, setSaving] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    const id = location.state?.editItemId;
    if (!id) return;
    navigate(location.pathname, { replace: true, state: null });
    itemMasterApi.get(id)
      .then((r) => { setForm(rowToForm(r)); setEditing({ id: r.ItemId, code: r.ItemCode, stock: Number(r.Stock || 0) }); })
      .catch(() => show('Failed to load the item', 'error'));
  }, [location.state, location.pathname, navigate, show]);

  const toList = (flash) => navigate('/pharmacy/item-list', flash ? { state: { flash } } : undefined);

  const save = async (e) => {
    e.preventDefault();
    const problem = validate(form);
    if (problem) return show(problem, 'error');
    setSaving(true);
    try {
      if (editing) {
        await itemMasterApi.update(editing.id, form);
        toList(`${form.name} updated`);
      } else {
        const r = await itemMasterApi.create(form);
        show(`Saved ${form.name} (${r.ItemCode})`, 'success');
        setForm(emptyForm);
      }
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const gst = Number(form.cgstPercent || 0) + Number(form.sgstPercent || 0);

  return (
    <div>
      <div className="card">
        <form onSubmit={save}>
          <CardHeader
            icon={Package}
            title={editing ? `Edit Item · ${editing.code}` : 'Item Master'}
            subtitle={editing ? 'Update this item' : 'Add a new item — the code is given on save'}
            actions={
              <>
                {!editing && (
                  <button type="button" className="btn-secondary" onClick={() => setScanOpen(true)} title="Read a supplier's bill and add its new items">
                    <ScanLine size={16} /> Scan Bill
                  </button>
                )}
                <button type="button" className="btn-secondary" onClick={() => toList()}>
                  <List size={16} /> Item List
                </button>
              </>
            }
          />

          <ItemFields form={form} setForm={setForm} editing={editing} handlersFor={handlersFor} />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs ${gst > MAX_GST ? 'text-red-600' : 'text-ink-500'}`}>
              GST for billing: <b>{gst}%</b> (CGST + SGST, max {MAX_GST}%)
              {!editing && ' · Selling price starts at the MRP; Stock In sets it later.'}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => (editing ? toList() : setForm(emptyForm))}>
                <X size={16} /> Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                <Save size={16} /> {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
      <ScanBillModal open={scanOpen} onClose={() => setScanOpen(false)} onAdded={(n) => show(`${n} item${n === 1 ? '' : 's'} added from the bill`, 'success')} />
      <Toast toast={toast} />
    </div>
  );
}
