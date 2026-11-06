import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart, Plus, Trash2, Save, X, List, ChevronRight, ChevronLeft, ListPlus, Search, Pencil, Check, ScanLine } from 'lucide-react';
import { CardHeader, Toast } from '../../components/ui.jsx';
import SearchPick from '../../components/grid/SearchPick.jsx';
import { gridKeys } from '../../components/grid/gridKeys.js';
import { useToast } from '../../hooks/useToast.js';
import { useAuth } from '../../context/AuthContext.jsx';
import ItemFormModal from './ItemFormModal.jsx';
import ScanBillModal from './ScanBillModal.jsx';
import { likeness } from '../../utils/billScan.js';
import { itemMasterApi, purchaseOrderApi, vendorApi } from '../../api/client.js';
import { purchaseLine, purchaseTotal, roundOffOf } from '../../utils/purchaseCalc.js';

const MAX_GST = 28;
const today = () => new Date().toISOString().slice(0, 10);
const money = (n) => (Number(n) || 0).toFixed(2);
const numStr = (v) => (v == null || v === '' ? '' : String(Number(v)));

let nextKey = 1;
const emptyLine = () => ({
  key: nextKey++, lineId: null, itemId: '', generic: '', manufacturer: '', hsn: '', category: '', pack: '', unit: '',
  mrp: '', pRate: '', free: '', disc: '', qty: '', gst: '', cgst: '', sgst: '',
});

// A new line for an item, with its details filled from the item. P.Rate
// starts at the rate it was last ordered at (empty for a first order).
const lineFromItem = (it) => ({
  ...emptyLine(), itemId: String(it.ItemId), generic: it.GenericName || '', manufacturer: it.ManufacturerName || '',
  hsn: it.HSNCode || '', category: it.Category || '', pack: it.Pack || '', unit: it.UnitName || '', mrp: numStr(it.MRP), pRate: numStr(it.LastPRate),
  gst: sumStr(it.CGSTPercent, it.SGSTPercent), cgst: numStr(it.CGSTPercent), sgst: numStr(it.SGSTPercent), qty: '1', free: '', disc: '',
});

// The vendor's address block for the Details box.
function vendorDetails(v) {
  if (!v) return '';
  const statePin = [v.State, v.Pincode].filter(Boolean).join(' – ');
  const phones = [v.ContactNo && `Mobile: ${v.ContactNo}`, v.AlternateNo && `Phone: ${v.AlternateNo}`].filter(Boolean).join(', ');
  const dl = [v.DLNo, v.DLNo2].filter(Boolean).join(', ');
  return [v.Address, statePin, phones, v.Email && `Email: ${v.Email}`, v.GSTNo && `GSTIN: ${v.GSTNo}`, dl && `DL No: ${dl}`]
    .filter(Boolean).join('\n');
}

// GST % as typed text from CGST + SGST ('' when neither is set).
const sumStr = (c, s) => (c == null && s == null ? '' : String(Math.round((Number(c || 0) + Number(s || 0)) * 100) / 100));
// Typing GST % splits it equally into CGST % and SGST %.
const splitGst = (gst) => {
  if (gst === '') return { gst, cgst: '', sgst: '' };
  const half = String(Math.round((Number(gst) / 2) * 100) / 100);
  return { gst, cgst: half, sgst: half };
};

const calcOf = (l) => purchaseLine({ pRate: l.pRate, discPercent: l.disc, quantity: l.qty, cgstPercent: l.cgst, sgstPercent: l.sgst });

// A line's problem on screen (the server checks the same), or null.
function lineProblem(l) {
  if (!l.itemId) return null;
  if (!(Number(l.qty) > 0)) return 'Quantity must be more than 0';
  if (!(Number(l.mrp) > 0)) return 'MRP must be more than 0';
  if (!(Number(l.pRate) > 0)) return 'P.Rate must be more than 0';
  if (Number(l.pRate) > Number(l.mrp)) return `P.Rate can't be above MRP ${money(l.mrp)}`;
  if (!(Number(l.free || 0) >= 0)) return 'Free must be 0 or more';
  const d = Number(l.disc || 0);
  if (!(d >= 0 && d <= 100)) return 'Disc % must be 0–100';
  const c = Number(l.cgst || 0);
  const s = Number(l.sgst || 0);
  if (!(c >= 0 && s >= 0) || c + s > MAX_GST) return `CGST + SGST must be 0–${MAX_GST}%`;
  return null;
}

// Pharmacy > Purchase / Order > Master: an order placed with a vendor. It
// doesn't change stock. Amounts use the same formulas as the server.
export default function PurchaseOrder() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, show } = useToast();
  const [items, setItems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [vendorId, setVendorId] = useState('');
  const [details, setDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [orderDate, setOrderDate] = useState(today());
  const [lines, setLines] = useState([emptyLine()]);
  // Phones: the item being entered (or edited, when its key is already in `lines`)
  // before "Add to list" puts it into `lines`.
  const [draft, setDraft] = useState(emptyLine);
  const draftRef = useRef(null);
  // Phones: which tab shows — the entry form ('new') or the order's items ('items').
  const [poTab, setPoTab] = useState('new');
  const bulkRef = useRef(null);
  // Phones: the page is sized to the screen (between the top bar and the footer
  // bar) so only the New Item / Order Items area scrolls — but only when the
  // fixed parts plus at least MIN_AREA px for that area fit; on a shorter screen
  // the page scrolls normally instead. null = normal page flow.
  const MIN_AREA = 120;
  const pageRef = useRef(null);
  const areaRef = useRef(null);
  const footerRef = useRef(null);
  const [fitHeight, setFitHeight] = useState(null);
  const [screenSize, setScreenSize] = useState(0);
  useEffect(() => {
    const changed = () => setScreenSize((n) => n + 1);
    const phone = window.matchMedia('(max-width: 767px)');
    window.addEventListener('resize', changed);
    phone.addEventListener('change', changed);
    return () => { window.removeEventListener('resize', changed); phone.removeEventListener('change', changed); };
  }, []);
  // Round Off: rounds the Sum of Total to the nearest rupee (on for a new order).
  const [roundOn, setRoundOn] = useState(true);
  const [showOptional, setShowOptional] = useState(false);
  const [editing, setEditing] = useState(null); // { id, no, locked }
  const [saving, setSaving] = useState(false);
  // Inline "+ Add vendor" form: null or { name, address, mobile }.
  const [newVendor, setNewVendor] = useState(null);
  // Bulk add panel: null or { search, category, manufacturer, ticked: Set }.
  const [bulk, setBulk] = useState(null);
  // Old Price: { itemId: last net rate (P.Rate less Disc %) from the chosen vendor }.
  const [lastRates, setLastRates] = useState({});
  // Add / Edit item popup from the Item Name list: null or { name } / { id }, plus the row it came from.
  const [itemForm, setItemForm] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';

  useEffect(() => {
    itemMasterApi.list({ status: 'Active' }).then(setItems).catch(() => show('Failed to load items', 'error'));
    vendorApi.list().then(setVendors).catch(() => show('Failed to load vendors', 'error'));
  }, [show]);

  useEffect(() => {
    if (!vendorId) { setLastRates({}); return; }
    purchaseOrderApi.lastRates(vendorId, editing?.id).then(setLastRates).catch(() => setLastRates({}));
  }, [vendorId, editing?.id]);

  const itemById = useMemo(() => new Map(items.map((i) => [String(i.ItemId), i])), [items]);
  const itemOptions = useMemo(() => items.map((i) => ({ value: String(i.ItemId), label: i.Name })), [items]);
  const vendorOptions = useMemo(
    () => vendors.filter((v) => v.Status !== 'Inactive' || String(v.VendorId) === vendorId)
      .map((v) => ({ value: String(v.VendorId), label: v.VendorName })),
    [vendors, vendorId],
  );

  // An order opened from the list.
  useEffect(() => {
    const id = location.state?.editOrderId;
    if (!id) return;
    navigate(location.pathname, { replace: true, state: null });
    purchaseOrderApi.get(id).then((o) => {
      setEditing({ id: o.PurchaseOrderId, no: o.OrderNo, locked: o.locked });
      setVendorId(String(o.VendorId));
      setDetails(o.VendorDetails || '');
      setOrderDate(String(o.OrderDate).slice(0, 10));
      setRoundOn(Number(o.RoundOff) !== 0);
      setDraft(emptyLine());
      setPoTab('items');
      setLines(o.lines.map((l) => ({
        ...emptyLine(), lineId: l.LineId, itemId: String(l.ItemId), generic: l.GenericName || '', manufacturer: l.Manufacturer || '',
        hsn: l.HSNCode || '', category: l.Category || '', pack: l.Pack || '', unit: l.Unit || '', mrp: numStr(l.MRP), pRate: numStr(l.PRate),
        free: Number(l.FreeQty) ? numStr(l.FreeQty) : '', disc: numStr(l.DiscPercent),
        qty: numStr(l.Quantity), gst: sumStr(l.CGSTPercent, l.SGSTPercent), cgst: numStr(l.CGSTPercent), sgst: numStr(l.SGSTPercent),
      })));
    }).catch(() => show('Failed to load the order', 'error'));
  }, [location.state, location.pathname, navigate, show]);

  const pickVendor = (id) => {
    setVendorId(id);
    setDetails(vendorDetails(vendors.find((v) => String(v.VendorId) === id)));
  };

  const saveNewVendor = async () => {
    const { name, address, mobile, gstNo, email } = newVendor;
    if (!name.trim() || !address.trim() || !mobile.trim()) return show('Vendor name, Address and Mobile are all required', 'error');
    try {
      // GSTIN / email come only from a scanned bill (not typed here).
      const v = await vendorApi.create({ vendorName: name, address, contactNo: mobile, ...(gstNo ? { gstNo } : {}), ...(email ? { email } : {}) });
      setVendors((all) => [v, ...all]);
      setVendorId(String(v.VendorId));
      setDetails(vendorDetails(v));
      setNewVendor(null);
      show(`Added vendor ${v.VendorName}`, 'success');
    } catch (err) {
      show(err.response?.data?.error || 'Could not add the vendor', 'error');
    }
  };

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLineAfter = (key) => setLines((ls) => {
    const i = ls.findIndex((l) => l.key === key);
    return [...ls.slice(0, i + 1), emptyLine(), ...ls.slice(i + 1)];
  });
  const removeLine = (key) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [emptyLine()]));

  // Phones: the entry form adds its item to the list (or updates the one being
  // edited) and clears for the next item; the list's Edit loads a line back.
  const draftEditing = draft.itemId && lines.some((l) => l.key === draft.key);
  const pickDraft = (itemId) => {
    const it = itemById.get(itemId);
    if (it) setDraft((d) => ({ ...lineFromItem(it), key: d.key, lineId: d.itemId === itemId ? d.lineId : null }));
  };
  const addDraft = () => {
    if (!draft.itemId) return show('Pick an item first', 'error');
    const problem = lineProblem(draft);
    if (problem) return show(problem, 'error');
    if (lines.some((l) => l.itemId === draft.itemId && l.key !== draft.key)) return show('This item is already in the list — edit it there', 'error');
    setLines((ls) => (draftEditing
      ? ls.map((l) => (l.key === draft.key ? draft : l))
      : [...ls.filter((l) => l.itemId), draft]));
    show(draftEditing ? 'Item updated' : `Item added — ${filled.length + 1} in the order`, 'success');
    setDraft(emptyLine());
    // After an edit go back to the list; after adding stay on New Item for the next one.
    if (draftEditing) setPoTab('items');
    else setTimeout(() => draftRef.current?.querySelector('input')?.focus(), 50);
  };
  const editLine = (l) => {
    setDraft({ ...l });
    setPoTab('new');
  };
  const deleteLine = (l) => {
    if (!confirm(`Remove ${itemById.get(l.itemId)?.Name || 'this item'} from the order?`)) return;
    removeLine(l.key);
    if (draft.key === l.key) setDraft(emptyLine());
  };
  const pickItem = (key, itemId) => {
    const it = itemById.get(itemId);
    if (it) setLines((ls) => ls.map((l) => (l.key === key ? { ...lineFromItem(it), key, lineId: null } : l)));
  };

  // New / Edit / Delete from a row's Item Name list.
  const focusItemBox = (rowKey, c = 0) => setTimeout(() => {
    const r = lines.findIndex((l) => l.key === rowKey);
    document.querySelector(`[data-r="${r}"][data-c="${c}"]`)?.focus();
  }, 50);
  const itemSaved = (it, isNew) => {
    const id = String(it.ItemId);
    setItems((all) => (isNew ? [...all, it] : all.map((i) => (String(i.ItemId) === id ? it : i))));
    if (isNew) {
      setLines((ls) => ls.map((l) => (l.key === itemForm.rowKey ? { ...lineFromItem(it), key: l.key, lineId: null } : l)));
      setDraft((d) => (d.key === itemForm.rowKey ? { ...lineFromItem(it), key: d.key, lineId: d.lineId } : d));
      show(`Added item ${it.Name} (${it.ItemCode})`, 'success');
      focusItemBox(itemForm.rowKey, 1);
    } else {
      // Rows already holding the item take its new details; their prices and quantities stay.
      const withDetails = (l) => (l.itemId !== id ? l : {
        ...l, generic: it.GenericName || '', manufacturer: it.ManufacturerName || '', hsn: it.HSNCode || '',
        category: it.Category || '', pack: it.Pack || '', unit: it.UnitName || '',
      });
      setLines((ls) => ls.map(withDetails));
      setDraft(withDetails);
      show(`${it.Name} updated`, 'success');
      focusItemBox(itemForm.rowKey);
    }
    setItemForm(null);
  };
  const deleteItem = async (opt, rowKey) => {
    if (!confirm(`Delete item "${opt.label}"? This can't be undone.`)) return focusItemBox(rowKey);
    try {
      await itemMasterApi.remove(opt.value);
      setItems((all) => all.filter((i) => String(i.ItemId) !== String(opt.value)));
      setLines((ls) => ls.map((l) => (l.itemId === String(opt.value) ? { ...emptyLine(), key: l.key } : l)));
      setDraft((d) => (d.itemId === String(opt.value) ? { ...emptyLine(), key: d.key } : d));
      show(`Deleted ${opt.label}`, 'success');
    } catch (err) {
      show(err.response?.data?.error || 'Could not delete the item', 'error');
    }
    focusItemBox(rowKey);
  };
  const itemActions = (rowKey) => ({
    onNew: (typed) => setItemForm({ name: typed, rowKey }),
    onEdit: (opt) => setItemForm({ id: opt.value, rowKey }),
    onDelete: isAdmin ? (opt) => deleteItem(opt, rowKey) : undefined,
  });

  // Bulk add panel.
  const toggleBulk = () => {
    setBulk((b) => (b ? null : { search: '', category: '', manufacturer: '', ticked: new Set() }));
    setTimeout(() => bulkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const inTable = useMemo(() => new Set(lines.map((l) => l.itemId).filter(Boolean)), [lines]);
  const bulkCategories = useMemo(() => [...new Set(items.map((i) => i.Category).filter(Boolean))].sort(), [items]);
  const bulkManufacturers = useMemo(() => [...new Set(items.map((i) => i.ManufacturerName).filter(Boolean))].sort(), [items]);
  const bulkShown = useMemo(() => {
    if (!bulk) return [];
    const q = bulk.search.trim().toLowerCase();
    return items.filter((i) => (!bulk.category || i.Category === bulk.category)
      && (!bulk.manufacturer || i.ManufacturerName === bulk.manufacturer)
      && (!q || i.Name.toLowerCase().includes(q) || (i.GenericName || '').toLowerCase().includes(q)));
  }, [items, bulk]);
  const bulkPickable = bulkShown.filter((i) => !inTable.has(String(i.ItemId)));
  const toggleTick = (id) => setBulk((b) => {
    const ticked = new Set(b.ticked);
    if (ticked.has(id)) ticked.delete(id); else ticked.add(id);
    return { ...b, ticked };
  });
  const allTicked = bulkPickable.length > 0 && bulkPickable.every((i) => bulk.ticked.has(String(i.ItemId)));
  const tickAll = () => setBulk((b) => {
    const ticked = new Set(b.ticked);
    for (const i of bulkPickable) { if (allTicked) ticked.delete(String(i.ItemId)); else ticked.add(String(i.ItemId)); }
    return { ...b, ticked };
  });
  // Scan Bill: the bill's items (new ones already added to Item Master) go on
  // the order with the bill's Qty and MRP. An item already on the order is
  // left as it is.
  // The bill's supplier and date: an existing vendor of (nearly) the same
  // name is picked; a new one opens the Add vendor box filled in, to check
  // and save. Only when no vendor is picked yet — a chosen one is kept.
  const fillSupplier = (s) => {
    if (!s) return '';
    const notes = [];
    if (s.billDate) { setOrderDate(s.billDate); notes.push('bill date'); }
    if (!s.vendorName || vendorId) return notes.join(', ');
    const best = vendors
      .filter((v) => v.Status !== 'Inactive')
      .map((v) => ({ v, score: likeness(v.VendorName, s.vendorName) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 0.85) {
      pickVendor(String(best.v.VendorId));
      notes.push(`vendor ${best.v.VendorName}`);
    } else {
      setNewVendor({ name: s.vendorName, address: s.address, mobile: s.mobile, gstNo: s.gstNo, email: s.email });
      setDetails([s.address, s.mobile && `Mobile: ${s.mobile}`, s.email && `Email: ${s.email}`, s.gstNo && `GSTIN: ${s.gstNo}`].filter(Boolean).join('\n'));
      setShowDetails(true);
      notes.push('new vendor — check it and press Add vendor');
    }
    return notes.join(', ');
  };

  const addScanned = async (scanned, { added, inactive, supplier }) => {
    let list = items;
    try {
      list = await itemMasterApi.list({ status: 'Active' });
      setItems(list);
    } catch {
      show('Failed to reload items', 'error');
    }
    const byId = new Map(list.map((i) => [String(i.ItemId), i]));
    const have = new Set(lines.map((l) => l.itemId).filter(Boolean));
    if (draft.itemId) have.add(draft.itemId);
    const fresh = [];
    let already = 0;
    for (const s of scanned) {
      const it = byId.get(String(s.itemId));
      if (!it) continue;
      if (have.has(String(it.ItemId))) { already += 1; continue; }
      have.add(String(it.ItemId));
      const line = lineFromItem(it);
      if (Number(s.qty) > 0) line.qty = s.qty;
      if (s.mrp !== '' && Number(s.mrp) >= 0) line.mrp = numStr(s.mrp);
      fresh.push(line);
    }
    if (fresh.length) setLines((ls) => [...ls.filter((l) => l.itemId), ...fresh]);
    setScanOpen(false);
    setPoTab('items');
    const filledIn = fillSupplier(supplier);
    const notes = [
      filledIn && `filled in: ${filledIn}`,
      added ? `${added} new to Item Master` : '',
      already ? `${already} already on the order` : '',
      inactive ? `${inactive} inactive left out` : '',
    ].filter(Boolean).join(' · ');
    show(`Added ${fresh.length} item${fresh.length === 1 ? '' : 's'} from the bill${notes ? ` (${notes})` : ''} — enter the P.Rate for each`, 'success');
  };

  const addTicked = () => {
    const toAdd = items.filter((i) => bulk.ticked.has(String(i.ItemId)) && !inTable.has(String(i.ItemId)));
    setLines((ls) => [...ls.filter((l) => l.itemId), ...toAdd.map(lineFromItem)]);
    show(`Added ${toAdd.length} item(s)`, 'success');
    setBulk(null);
  };

  const filled = lines.filter((l) => l.itemId);
  useLayoutEffect(() => {
    const page = pageRef.current;
    const main = page?.closest('main');
    if (!page || !main || !window.matchMedia('(max-width: 767px)').matches) return setFitHeight(null);
    const top = main.getBoundingClientRect().top + parseFloat(getComputedStyle(main).paddingTop);
    const footer = footerRef.current?.getBoundingClientRect().height || 0;
    const available = Math.floor(window.innerHeight - top - footer - 8);
    const fixedParts = page.scrollHeight - (areaRef.current?.offsetHeight || 0);
    setFitHeight(fixedParts + MIN_AREA <= available ? available : null);
  }, [screenSize, poTab, bulk, showDetails, newVendor, editing, filled.length, draft.itemId]);
  const problems = new Map(filled.map((l) => [l.key, lineProblem(l)]).filter(([, p]) => p));
  const total = purchaseTotal(filled.map((l) => ({ pRate: l.pRate, discPercent: l.disc, quantity: l.qty, cgstPercent: l.cgst, sgstPercent: l.sgst })));
  const roundOff = roundOn ? roundOffOf(total) : 0;
  const netAmount = total + roundOff;

  const reset = () => {
    setEditing(null); setVendorId(''); setDetails(''); setShowDetails(false); setOrderDate(today()); setLines([emptyLine()]); setDraft(emptyLine()); setPoTab('new'); setRoundOn(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!vendorId) return show('Vendor Name is required', 'error');
    if (!orderDate) return show('Date is required', 'error');
    if (draft.itemId) return show(draftEditing ? 'Tap "Update item" (or Cancel) for the item being edited first' : 'Tap "Add to list" for the item you are entering, or clear it', 'error');
    if (!filled.length) return show('Add at least one item', 'error');
    if (problems.size) return show('Fix the rows marked in red first', 'error');
    setSaving(true);
    try {
      const body = {
        vendorId: Number(vendorId), orderDate, vendorDetails: details, roundOff: roundOn,
        lines: filled.map((l) => ({
          lineId: l.lineId, itemId: Number(l.itemId), mrp: l.mrp, pRate: l.pRate, freeQty: l.free, discPercent: l.disc,
          quantity: l.qty, cgstPercent: l.cgst, sgstPercent: l.sgst,
        })),
      };
      if (editing) {
        await purchaseOrderApi.update(editing.id, body);
        navigate('/pharmacy/purchase-order-list', { state: { flash: `Order ${editing.no} updated` } });
      } else {
        const r = await purchaseOrderApi.create(body);
        show(`Saved order ${r.OrderNo} · ₹${money(r.TotalAmount)}`, 'success');
        reset();
      }
    } catch (err) {
      show(err.response?.data?.error || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const cell = 'border border-ink-200 px-1 py-0.5 break-words';
  // Headings centred both ways (Item Name stays left); one line on wide
  // screens, smaller and allowed to wrap on narrower ones.
  const hd = 'border border-ink-200 px-0.5 py-1.5 text-center align-middle text-10 xl:text-11 xl:whitespace-nowrap';
  const box = 'w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-12 focus:border-brand-400 focus:bg-white focus:outline-none';
  const numBox = `${box} no-spin text-right`;
  const opt = 'bg-amber-50 text-amber-900';
  // The › arrow swaps the four GST columns for the three item-detail columns.
  const optCols = showOptional ? 3 - 4 : 0;

  return (
    <div ref={pageRef} className={fitHeight ? 'flex flex-col' : ''} style={fitHeight ? { height: fitHeight } : undefined}>
      <div className={`card max-md:!px-3 ${fitHeight ? 'flex min-h-0 flex-1 flex-col !pb-3' : ''}`}>
        <form onSubmit={save} className={fitHeight ? 'flex min-h-0 flex-1 flex-col' : ''}>
          <CardHeader
            icon={ShoppingCart}
            title={editing ? `Edit Order · ${editing.no}` : 'Purchase / Order'}
            subtitle={<span className="hidden md:inline">{editing ? 'Update this order' : 'Order items from a vendor — this does not change stock'}</span>}
            actions={
              <>
                {!editing?.locked && (
                  <button type="button" className="btn-secondary max-md:px-2 max-md:py-1 max-md:text-xs" onClick={() => setScanOpen(true)} title="Read a supplier's bill and put its items on this order">
                    <ScanLine size={16} /> Scan Bill
                  </button>
                )}
                <button type="button" className="btn-secondary hidden md:inline-flex" onClick={() => navigate('/pharmacy/purchase-order-list')}>
                  <List size={16} /> View List
                </button>
              </>
            }
          />

          {editing?.locked && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">{editing.locked}</div>
          )}

          <div className="grid grid-cols-[1fr_7rem] items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <div className="min-w-0 sm:w-80">
              <label className="label">Vendor Name *</label>
              <div className="flex gap-1">
                <div className="flex-1">
                  <SearchPick
                    className="input" placeholder="Search vendor..." options={vendorOptions} value={vendorId}
                    onChange={(v) => pickVendor(v)}
                    footer={{ label: '+ Add vendor', onClick: (typed) => setNewVendor({ name: typed, address: '', mobile: '' }) }}
                  />
                </div>
                <button
                  type="button" className="btn-secondary px-2" title={showDetails ? 'Hide details' : 'Show vendor details'}
                  onClick={() => setShowDetails((s) => !s)}
                >
                  {showDetails ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
                </button>
              </div>
            </div>
            <div className="min-w-0 sm:w-auto">
              <label className="label">Date *</label>
              <input type="date" className="input max-md:!px-1.5" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
          </div>

          {newVendor && (
            <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-brand-100 bg-brand-50/50 p-2">
              <div className="w-48"><label className="label">Vendor name *</label><input autoFocus className="input" value={newVendor.name} onChange={(e) => setNewVendor((v) => ({ ...v, name: e.target.value }))} /></div>
              <div className="min-w-[14rem] flex-1"><label className="label">Address *</label><input className="input" value={newVendor.address} onChange={(e) => setNewVendor((v) => ({ ...v, address: e.target.value }))} /></div>
              <div className="w-40"><label className="label">Mobile *</label><input type="tel" className="input" value={newVendor.mobile} onChange={(e) => setNewVendor((v) => ({ ...v, mobile: e.target.value }))} /></div>
              <button type="button" className="btn-primary" onClick={saveNewVendor}><Save size={15} /> Add vendor</button>
              <button type="button" className="btn-secondary" onClick={() => setNewVendor(null)}><X size={15} /></button>
            </div>
          )}

          {showDetails && (
            <div className="mt-2 sm:w-[28rem]">
              <label className="label">Details</label>
              <textarea className="input text-xs" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Pick a vendor to fill this in" />
            </div>
          )}

          <div className="mt-3 hidden items-center justify-between md:flex">
            <button type="button" className="btn-secondary whitespace-nowrap py-1" onClick={toggleBulk}>
              <ListPlus size={15} /> Bulk add items
            </button>
            <span className="hidden text-xs text-ink-400 md:inline">← → move between boxes · ↑ ↓ move between rows</span>
          </div>

          {bulk && (
            <div ref={bulkRef} className="mt-2 scroll-mt-4 rounded-lg border border-ink-200 bg-ink-50/50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-56">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                  <input autoFocus className="input py-1 pl-8" placeholder="Search items..." value={bulk.search} onChange={(e) => setBulk((b) => ({ ...b, search: e.target.value }))} />
                </div>
                <select className="input w-auto py-1" value={bulk.category} onChange={(e) => setBulk((b) => ({ ...b, category: e.target.value }))}>
                  <option value="">All categories</option>
                  {bulkCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="input w-auto py-1" value={bulk.manufacturer} onChange={(e) => setBulk((b) => ({ ...b, manufacturer: e.target.value }))}>
                  <option value="">All manufacturers</option>
                  {bulkManufacturers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-sm text-ink-600">
                  <input type="checkbox" checked={allTicked} onChange={tickAll} disabled={!bulkPickable.length} /> Select all ({bulkPickable.length})
                </label>
                <div className="ml-auto flex gap-2">
                  <button type="button" className="btn-primary py-1" disabled={!bulk.ticked.size} onClick={addTicked}>Add {bulk.ticked.size} item(s)</button>
                  <button type="button" className="btn-secondary py-1" onClick={() => setBulk(null)}><X size={15} /></button>
                </div>
              </div>
              <div className="mt-2 grid max-h-56 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {bulkShown.slice(0, 300).map((i) => {
                  const added = inTable.has(String(i.ItemId));
                  return (
                    <label key={i.ItemId} className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-sm ${added ? 'text-ink-400' : 'cursor-pointer text-ink-700 hover:bg-white'}`}>
                      <input type="checkbox" checked={added || bulk.ticked.has(String(i.ItemId))} disabled={added} onChange={() => toggleTick(String(i.ItemId))} />
                      <span className="truncate">{i.Name}</span>
                      {added && <span className="text-11 italic">already added</span>}
                    </label>
                  );
                })}
                {bulkShown.length > 300 && <p className="col-span-full px-1.5 py-1 text-xs text-ink-400">Showing the first 300 — narrow the search to see more.</p>}
                {!bulkShown.length && <p className="col-span-full px-1.5 py-1 text-xs text-ink-400">No items match.</p>}
              </div>
            </div>
          )}

          {/* Phones: two tabs — New Item (the entry form; "Add to list" moves the item
              into the order and clears the form) and Order Items (the list with Edit /
              Delete) — then the totals. */}
          <div className={`mt-3 flex flex-col gap-2.5 md:hidden ${fitHeight ? 'min-h-0 flex-1' : ''}`}>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink-100 p-1">
              <button
                type="button" onClick={() => setPoTab('new')}
                className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-13 font-semibold transition-colors ${poTab === 'new' ? (draftEditing ? 'bg-amber-500 text-white shadow-sm' : 'bg-white text-brand-700 shadow-sm') : 'text-ink-500'}`}
              >
                {draftEditing ? <Pencil size={14} /> : <Plus size={14} />} {draftEditing ? 'Edit Item' : 'New Item'}
              </button>
              <button
                type="button" onClick={() => setPoTab('items')}
                className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-13 font-semibold transition-colors ${poTab === 'items' ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500'}`}
              >
                <List size={14} /> Order Items
                <span className={`rounded-full px-1.5 text-11 ${filled.length ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-500'}`}>{filled.length}</span>
              </button>
            </div>

            {/* The only part that scrolls on a phone. */}
            <div ref={areaRef} className={`space-y-2.5 ${fitHeight ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl' : ''}`}>
            <div className={poTab === 'new' ? '' : 'hidden'}>
            {(() => {
              const l = draft;
              const c = calcOf(l);
              const bad = l.itemId ? lineProblem(l) : null;
              const setD = (patch) => setDraft((d) => ({ ...d, ...patch }));
              // Three rows of five, in the order table's column order, lined up as columns:
              // Category · Pack · Unit · MRP · Old Price / P.Rate · Free · Disc % · Qty · Amount /
              // GST % · CGST % · SGST % · GST Amt · Total. Boxes are editable; the shaded ones are shown only.
              const fit = (v) => {
                const n = String(v ?? '').length;
                return n >= 9 ? '!text-9 tracking-tighter' : n >= 7 ? '!text-10.5 tracking-tight' : '!text-12';
              };
              const head = (label) => <span className="mb-0.5 block truncate text-center text-10 font-semibold text-ink-500">{label}</span>;
              const num = (label, key, { onChange, className = '' } = {}) => (
                <label className="block min-w-0">
                  {head(label)}
                  <input
                    type="number" inputMode="decimal" min="0" step="any" className={`input no-spin !min-h-[30px] !px-0.5 !py-0.5 text-center tabular-nums ${fit(l[key])} ${className}`}
                    value={l[key]} disabled={!l.itemId} onChange={(e) => setD(onChange ? onChange(e.target.value) : { [key]: e.target.value })}
                  />
                </label>
              );
              const show = (label, value, className = '') => (
                <div className="min-w-0">
                  {head(label)}
                  <div title={value} className={`flex min-h-[30px] items-center justify-center truncate rounded-lg bg-ink-50 px-0.5 text-center tabular-nums text-ink-600 ${fit(value)} ${className}`}>{value || '—'}</div>
                </div>
              );
              return (
                <div ref={draftRef} className={`scroll-mt-16 overflow-hidden rounded-xl border bg-white shadow-sm ${draftEditing ? 'border-amber-300' : 'border-brand-200'}`}>
                  <div className={`flex items-center gap-2 border-b px-2.5 py-2 ${draftEditing ? 'border-amber-100 bg-amber-50' : 'border-ink-100 bg-brand-50/60'}`}>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-10 font-bold uppercase text-white ${draftEditing ? 'bg-amber-500' : 'bg-brand-600'}`}>
                      {draftEditing ? `Edit #${lines.findIndex((x) => x.key === l.key) + 1}` : 'New item'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <SearchPick className="input" placeholder="Search item..." options={itemOptions} value={l.itemId} onChange={pickDraft} actions={itemActions(l.key)} />
                    </div>
                    {l.itemId && (
                      <button type="button" className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" title={draftEditing ? 'Cancel edit' : 'Clear'} onClick={() => setDraft(emptyLine())}><X size={16} /></button>
                    )}
                  </div>
                  {l.itemId ? (
                    <div className="space-y-2 p-2">
                      <div className="grid grid-cols-5 gap-x-1.5 gap-y-2">
                        {show('Category', l.category)}
                        {show('Pack', l.pack)}
                        {show('Unit', l.unit)}
                        {num('MRP', 'mrp')}
                        {show('Old Price', money(lastRates[l.itemId] ?? 0), '!bg-amber-50 text-amber-800')}
                        {num('P.Rate', 'pRate', { className: Number(l.pRate) > Number(l.mrp) ? '!border-red-400 bg-red-50 text-red-700' : '' })}
                        {num('Free', 'free')}
                        {num('Disc %', 'disc')}
                        {num('Qty', 'qty')}
                        {show('Amount', money(c.amount))}
                        {num('GST %', 'gst', { onChange: splitGst })}
                        {num('CGST %', 'cgst', { onChange: (v) => ({ cgst: v, gst: sumStr(v || null, l.sgst || null) }) })}
                        {num('SGST %', 'sgst', { onChange: (v) => ({ sgst: v, gst: sumStr(l.cgst || null, v || null) }) })}
                        {show('GST Amt', money(c.gstAmount))}
                        {show('Total', money(c.total), '!bg-brand-50 font-bold text-brand-800')}
                      </div>
                      {bad && <p className="rounded-md bg-red-50 px-2 py-1 text-12 text-red-600">{bad}</p>}
                      <div className="flex gap-2">
                        {draftEditing && (
                          <button type="button" className="btn-secondary flex-1" onClick={() => setDraft(emptyLine())}><X size={16} /> Cancel</button>
                        )}
                        <button type="button" className="btn-primary flex-[2]" onClick={addDraft}>
                          {draftEditing ? <><Check size={16} /> Update item</> : <><Plus size={16} /> Add to list</>}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="px-3 py-2.5 text-12 text-ink-400">Search and pick an item, fill in its rate and quantity, then tap <span className="font-semibold text-brand-700">Add to list</span>.</p>
                  )}
                </div>
              );
            })()}
            </div>

            <div className={`overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm ${poTab === 'items' ? '' : 'hidden'}`}>
              {filled.length === 0 && (
                <p className="px-3 py-5 text-center text-12 text-ink-400">
                  No items yet — add them on the <button type="button" className="font-semibold text-brand-700" onClick={() => setPoTab('new')}>New Item</button> tab.
                </p>
              )}
              {filled.map((l, i) => {
                const c = calcOf(l);
                const bad = problems.get(l.key);
                const gst = Number(l.cgst || 0) + Number(l.sgst || 0);
                const active = draftEditing && draft.key === l.key;
                return (
                  <div key={l.key} className={`flex items-start gap-2 border-t border-ink-100 px-3 py-2 first:border-t-0 ${active ? 'bg-amber-50' : bad ? 'bg-red-50' : ''}`}>
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-10 font-bold text-ink-600">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-13 font-medium leading-snug text-ink-800">{itemById.get(l.itemId)?.Name || 'Item'}</p>
                      <p className="text-11 leading-snug text-ink-500">
                        Qty {Number(l.qty) || 0}{Number(l.free) ? ` + ${Number(l.free)} free` : ''} × ₹{money(l.pRate)}
                        {Number(l.disc) ? ` · Disc ${Number(l.disc)}%` : ''} · GST {gst}%
                      </p>
                      {bad && <p className="text-11 text-red-600">{bad}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <span className="text-13 font-bold tabular-nums text-brand-800">₹{money(c.total)}</span>
                      <div className="mt-0.5 flex gap-1">
                        <button type="button" className="rounded-lg border border-brand-100 p-1 text-brand-600 hover:bg-brand-50" title="Edit" onClick={() => editLine(l)}><Pencil size={14} /></button>
                        <button type="button" className="rounded-lg border border-red-100 p-1 text-red-500 hover:bg-red-50" title="Delete" onClick={() => deleteLine(l)}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            </div>

            <div className="shrink-0 rounded-xl border border-ink-200 bg-white text-sm shadow-sm">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-13">
                <span className="text-ink-600">Sum of Total <b className="tabular-nums text-ink-900">{money(total)}</b></span>
                <label className="inline-flex items-center gap-1.5 text-ink-600">
                  <input type="checkbox" checked={roundOn} onChange={(e) => setRoundOn(e.target.checked)} /> Round Off
                  <span className={`tabular-nums ${roundOff < 0 ? 'text-red-600' : 'text-ink-700'}`}>{roundOff > 0 ? '+' : ''}{money(roundOff)}</span>
                </label>
              </div>
              <div className="flex items-center justify-between rounded-b-xl bg-brand-600 px-3 py-1 text-white">
                <span className="text-13 font-semibold">Net Amount</span>
                <span className="text-15 font-bold tabular-nums">₹{money(netAmount)}</span>
              </div>
            </div>
          </div>

          <div className="mt-2 hidden overflow-x-auto md:block">
            {/* Fixed layout: each column has a share of the width, so the table fits the
                screen without scrolling; opening the optional columns lets it scroll. */}
            <table className={`w-full table-fixed border-collapse text-left text-12 `} {...gridKeys}>
              <thead>
                <tr className="bg-brand-50 text-11 font-bold leading-tight text-brand-700">
                  <th className={`${hd} w-[2.5%]`}>#</th>
                  <th className={`${hd} w-[17%] !text-left`}>
                    <div className="flex items-center justify-between">
                      Item Name
                      <button type="button" className="rounded px-1 text-brand-600 hover:bg-white" title={showOptional ? 'Show the GST columns again' : 'Show Generic, Manufacturer, HSN in place of the GST columns'} onClick={() => setShowOptional((s) => !s)}>
                        {showOptional ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                  </th>
                  {showOptional && [['Generic', 'w-[6%]'], ['Manufacturer', 'w-[7.5%]'], ['HSN', 'w-[4%]']].map(([h, w]) => <th key={h} className={`${hd} ${w} ${opt}`}>{h}</th>)}
                  <th className={`${hd} w-[7%]`} title="Category from Item Master">Category</th>
                  <th className={`${hd} w-[4.5%]`}>Pack</th>
                  <th className={`${hd} w-[4.5%]`} title="Type / Unit from Item Master">Unit</th>
                  <th className={`${hd} w-[5.5%]`}>MRP</th>
                  <th className={`${hd} w-[5.5%]`} title="Last rate from this vendor, after its discount (P.Rate less Disc %); 0 if never ordered from them">Old Price</th>
                  <th className={`${hd} w-[5.5%]`} title="Purchase rate — Disc % applies to it">P.Rate</th>
                  <th className={`${hd} w-[4%]`} title="Free units — not charged, received with the rest">Free</th>
                  <th className={`${hd} w-[4%]`}>Disc%</th>
                  <th className={`${hd} w-[5%]`}>Qty</th>
                  <th className={`${hd} w-[6%]`}>Amount</th>
                  {!showOptional && (
                    <>
                      <th className={`${hd} w-[4%]`}>GST%</th>
                      <th className={`${hd} w-[4.5%]`}>CGST%</th>
                      <th className={`${hd} w-[4.5%]`}>SGST%</th>
                      <th className={`${hd} w-[5.5%]`}>GST Amt</th>
                    </>
                  )}
                  <th className={`${hd} w-[6.5%]`}>Total</th>
                  <th className={`${hd} w-[4%]`} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, r) => {
                  const c = calcOf(l);
                  const bad = problems.get(l.key);
                  const ro = 'px-1.5 text-right text-ink-600';
                  return (
                    <tr key={l.key} className={bad ? 'bg-red-50' : ''} title={bad || ''}>
                      <td className={`${cell} text-center text-ink-400`}>{r + 1}</td>
                      <td className={cell}>
                        <SearchPick className={box} data-r={r} data-c={0} placeholder="Search item..." options={itemOptions} value={l.itemId} onChange={(v) => pickItem(l.key, v)} actions={itemActions(l.key)} />
                        {bad && <p className="px-1.5 text-11 text-red-600">{bad}</p>}
                      </td>
                      {showOptional && [l.generic, l.manufacturer, l.hsn].map((v, i) => <td key={i} className={`${cell} ${opt} px-1.5`}>{v}</td>)}
                      <td className={`${cell} px-1.5`}>{l.category}</td>
                      <td className={`${cell} px-1.5`}>{l.pack}</td>
                      <td className={`${cell} px-1.5`}>{l.unit}</td>
                      <td className={cell}><input type="number" min="0" step="0.01" data-r={r} data-c={1} className={numBox} value={l.mrp} disabled={!l.itemId} onChange={(e) => setLine(l.key, { mrp: e.target.value })} /></td>
                      <td className={`${cell} ${ro}`}>{l.itemId ? money(lastRates[l.itemId] ?? 0) : ''}</td>
                      <td className={cell}><input type="number" min="0" step="0.01" data-r={r} data-c={2} className={`${numBox} ${Number(l.pRate) > Number(l.mrp) ? 'border-red-400 bg-red-50 text-red-700' : ''}`} value={l.pRate} disabled={!l.itemId} onChange={(e) => setLine(l.key, { pRate: e.target.value })} /></td>
                      <td className={cell}><input type="number" min="0" step="any" data-r={r} data-c={3} className={numBox} value={l.free} disabled={!l.itemId} onChange={(e) => setLine(l.key, { free: e.target.value })} /></td>
                      <td className={cell}><input type="number" min="0" max="100" step="0.01" data-r={r} data-c={4} className={numBox} value={l.disc} disabled={!l.itemId} onChange={(e) => setLine(l.key, { disc: e.target.value })} /></td>
                      <td className={cell}><input type="number" min="0" step="any" data-r={r} data-c={5} className={numBox} value={l.qty} disabled={!l.itemId} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
                      <td className={`${cell} ${ro}`}>{l.itemId ? money(c.amount) : ''}</td>
                      {!showOptional && (
                        <>
                          <td className={cell}><input type="number" min="0" max={MAX_GST} step="0.01" data-r={r} data-c={6} className={numBox} value={l.gst} disabled={!l.itemId} title="Splits equally into CGST % and SGST %" onChange={(e) => setLine(l.key, splitGst(e.target.value))} /></td>
                          <td className={cell}><input type="number" min="0" max={MAX_GST} step="0.01" data-r={r} data-c={7} className={numBox} value={l.cgst} disabled={!l.itemId} onChange={(e) => setLine(l.key, { cgst: e.target.value, gst: sumStr(e.target.value || null, l.sgst || null) })} /></td>
                          <td className={cell}><input type="number" min="0" max={MAX_GST} step="0.01" data-r={r} data-c={8} className={numBox} value={l.sgst} disabled={!l.itemId} onChange={(e) => setLine(l.key, { sgst: e.target.value, gst: sumStr(l.cgst || null, e.target.value || null) })} /></td>
                          <td className={`${cell} ${ro}`}>{l.itemId ? money(c.gstAmount) : ''}</td>
                        </>
                      )}
                      <td className={`${cell} ${ro} font-semibold text-ink-800`}>{l.itemId ? money(c.total) : ''}</td>
                      <td className={cell}>
                        <div className="flex justify-center">
                          <button type="button" className="rounded p-0.5 text-brand-600 hover:bg-brand-50" title="Add a row below" onClick={() => addLineAfter(l.key)}><Plus size={13} /></button>
                          <button type="button" className="rounded p-0.5 text-red-500 hover:bg-red-50" title="Delete row" onClick={() => removeLine(l.key)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-ink-50 font-semibold">
                  <td className={`${cell} px-2 text-right`} colSpan={16 + optCols}>Sum of Total</td>
                  <td className={`${cell} px-1.5 text-right text-ink-900`}>{money(total)}</td>
                  <td className={cell} />
                </tr>
                <tr className="bg-ink-50">
                  <td className={`${cell} px-2 text-right`} colSpan={16 + optCols}>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink-600" title="Round the Sum of Total to the nearest rupee">
                      <input type="checkbox" checked={roundOn} onChange={(e) => setRoundOn(e.target.checked)} /> Round Off
                    </label>
                  </td>
                  <td className={`${cell} px-1.5 text-right tabular-nums ${roundOff < 0 ? 'text-red-600' : 'text-ink-700'}`}>
                    {roundOff > 0 ? '+' : ''}{money(roundOff)}
                  </td>
                  <td className={cell} />
                </tr>
                <tr className="bg-brand-50 font-bold">
                  <td className={`${cell} px-2 text-right text-brand-800`} colSpan={16 + optCols}>Net Amount</td>
                  <td className={`${cell} px-1.5 text-right text-13 text-brand-800`}>{money(netAmount)}</td>
                  <td className={cell} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <button type="button" className="btn-secondary" onClick={() => (editing ? navigate('/pharmacy/purchase-order-list') : reset())}>
              <X size={16} /> Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving || !!editing?.locked}>
              <Save size={16} /> {saving ? 'Saving...' : editing ? 'Update' : 'Save'}
            </button>
          </div>
        </form>
      </div>
      {/* Phones: Bulk add items and View List stay in a bar fixed to the bottom
          edge of the screen while the page scrolls above it. Portaled to <body>, as the
          page's fade-in wrapper would otherwise pin it to the page, not the screen. */}
      {createPortal(
        <div ref={footerRef} data-phone-footer className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 gap-2 border-t border-ink-200 bg-white/95 pl-4 pr-[4.25rem] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_12px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
          <button type="button" className={`${bulk ? 'btn-primary' : 'btn-secondary'} whitespace-nowrap px-2`} onClick={toggleBulk}>
            <ListPlus size={16} /> {bulk ? 'Close bulk add' : 'Bulk add items'}
          </button>
          <button type="button" className="btn-secondary whitespace-nowrap px-2" onClick={() => navigate('/pharmacy/purchase-order-list')}>
            <List size={16} /> View List
          </button>
        </div>,
        document.body,
      )}
      <ItemFormModal target={itemForm} onClose={() => { focusItemBox(itemForm.rowKey); setItemForm(null); }} onSaved={itemSaved} />
      <ScanBillModal open={scanOpen} onClose={() => setScanOpen(false)} forOrder onLines={addScanned} />
      <Toast toast={toast} />
    </div>
  );
}
