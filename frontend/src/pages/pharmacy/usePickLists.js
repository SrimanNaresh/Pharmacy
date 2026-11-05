import { useCallback, useEffect, useState } from 'react';
import { itemMasterApi } from '../../api/client.js';

const EMPTY = { unit: [], generic: [], manufacturer: [], category: [], potency: [], pack: [] };

// The Item pick-lists (Type / Unit, Generic Name, Manufacturer, Category,
// Potency) and CellCombo props for each: + New adds a value, Edit renames it,
// Delete hides it. `handlersFor(field)` gives { options, createFn, onCreated,
// onRename, onDelete, addLabel }.
export function usePickLists(onError) {
  const [lists, setLists] = useState(EMPTY);

  const reload = useCallback(() => itemMasterApi.lists().then(setLists).catch(() => onError?.('Failed to load the pick-lists')), [onError]);
  useEffect(() => { reload(); }, [reload]);

  const handlersFor = (field) => ({
    options: lists[field],
    addLabel: 'to the list',
    createFn: (name) => itemMasterApi.addListValue(field, name),
    onCreated: (row) => setLists((l) => (l[field].some((o) => o.id === row.id) ? l : { ...l, [field]: [...l[field], row] })),
    onRename: async (opt, name) => {
      await itemMasterApi.renameListValue(field, opt.id, name);
      setLists((l) => ({ ...l, [field]: l[field].map((o) => (o.id === opt.id ? { ...o, name } : o)) }));
    },
    onDelete: async (opt) => {
      if (!confirm(`Remove "${opt.name}" from the list? Items already saved keep it.`)) return false;
      await itemMasterApi.removeListValue(field, opt.id);
      setLists((l) => ({ ...l, [field]: l[field].filter((o) => o.id !== opt.id) }));
      return true;
    },
  });

  return { lists, handlersFor, reload };
}
