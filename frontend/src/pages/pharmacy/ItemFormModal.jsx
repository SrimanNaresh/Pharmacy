import { useEffect, useState } from 'react';
import { Save, X } from 'lucide-react';
import { Modal, Spinner } from '../../components/ui.jsx';
import { itemMasterApi } from '../../api/client.js';
import { MAX_GST, emptyForm, rowToForm, validate, ItemFields } from './ItemForm.jsx';
import { usePickLists } from './usePickLists.js';

// Add or edit an item in a popup, without leaving the screen that opened it.
//  - target: null (closed), { name } to add (the name typed so far) or { id } to edit
//  - onSaved(itemRow, isNew): the saved item as the Item List returns it
export default function ItemFormModal({ target, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null); // { id, code, stock }
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { handlersFor } = usePickLists(setError);

  useEffect(() => {
    setError('');
    setEditing(null);
    if (!target) return;
    if (!target.id) { setForm({ ...emptyForm, name: target.name || '' }); return; }
    setLoading(true);
    itemMasterApi.get(target.id)
      .then((r) => { setForm(rowToForm(r)); setEditing({ id: r.ItemId, code: r.ItemCode, stock: Number(r.Stock || 0) }); })
      .catch(() => setError('Failed to load the item'))
      .finally(() => setLoading(false));
  }, [target]);

  const save = async (e) => {
    e.preventDefault();
    e.stopPropagation(); // the popup's form sits inside the page's form
    const problem = validate(form);
    if (problem) return setError(problem);
    setSaving(true);
    setError('');
    try {
      let id;
      if (editing) {
        await itemMasterApi.update(editing.id, form);
        id = editing.id;
      } else {
        id = (await itemMasterApi.create(form)).ItemId;
      }
      onSaved(await itemMasterApi.get(id), !editing);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const gst = Number(form.cgstPercent || 0) + Number(form.sgstPercent || 0);
  const isEdit = Boolean(target?.id);
  return (
    <Modal open={Boolean(target)} onClose={onClose} size="xl" title={isEdit ? `Edit Item${editing ? ` · ${editing.code}` : ''}` : 'Add New Item'}>
      {loading ? <Spinner /> : (
        <form onSubmit={save} onKeyDown={(e) => e.stopPropagation()}>
          <ItemFields form={form} setForm={setForm} editing={editing} handlersFor={handlersFor} narrow autoFocus />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className={`text-xs ${gst > MAX_GST ? 'text-red-600' : 'text-ink-500'}`}>
              GST for billing: <b>{gst}%</b> (CGST + SGST, max {MAX_GST}%)
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={onClose}><X size={16} /> Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>
                <Save size={16} /> {saving ? 'Saving...' : isEdit ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
