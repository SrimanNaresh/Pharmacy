import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

export function setAuthToken(token) {
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete api.defaults.headers.common.Authorization;
}

// Let AuthContext react to an expired/invalid session from anywhere API calls happen.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) window.dispatchEvent(new Event('auth:unauthorized'));
    return Promise.reject(err);
  }
);

export const authApi = {
  login: (username, password) => api.post('/auth/login', { username, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

export const userApi = {
  list: (search = '') => api.get('/users', { params: { search } }).then((r) => r.data),
  create: (data) => api.post('/users', data).then((r) => r.data),
  update: (id, data) => api.put(`/users/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/users/${id}`).then((r) => r.data),
};

export const menuAccessApi = {
  get: (userId) => api.get(`/menu-access/${userId}`).then((r) => r.data),
  save: (userId, items) => api.put(`/menu-access/${userId}`, { items }).then((r) => r.data),
};

export const clinicApi = {
  get: () => api.get('/clinic').then((r) => r.data),
  save: (data) => api.put('/clinic', data).then((r) => r.data),
  remove: () => api.delete('/clinic').then((r) => r.data),
};

export const vendorApi = {
  list: (search = '') => api.get('/vendors', { params: { search } }).then((r) => r.data),
  create: (data) => api.post('/vendors', data).then((r) => r.data),
  update: (id, data) => api.put(`/vendors/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/vendors/${id}`).then((r) => r.data),
};

export const pharmacyItemApi = {
  list: (search = '') => api.get('/pharmacy-items', { params: { search } }).then((r) => r.data),
};

function transactionApi(basePath) {
  return {
    list: (search = '') => api.get(`/${basePath}`, { params: { search } }).then((r) => r.data),
    items: (id) => api.get(`/${basePath}/${id}/items`).then((r) => r.data),
    create: (data) => api.post(`/${basePath}`, data).then((r) => r.data),
    update: (id, data) => api.put(`/${basePath}/${id}`, data).then((r) => r.data),
    remove: (id) => api.delete(`/${basePath}/${id}`).then((r) => r.data),
  };
}
export const itemMasterApi = {
  // params: { status: 'Active' } to leave out inactive items
  list: (params) => api.get('/item-master', { params }).then((r) => r.data),
  get: (id) => api.get(`/item-master/${id}`).then((r) => r.data),
  create: (data) => api.post('/item-master', data).then((r) => r.data),
  update: (id, data) => api.put(`/item-master/${id}`, data).then((r) => r.data),
  // Admin only; refused for an item used in any document or with stock
  remove: (id) => api.delete(`/item-master/${id}`).then((r) => r.data),
  // rows: [{ itemId, ...changed fields }]; all saved or none
  bulkUpdate: (rows) => api.post('/item-master/bulk-update', { rows }).then((r) => r.data),
  // Pick-lists: { unit, generic, manufacturer, category, potency: [{ id, name }], pack: [name] }
  lists: () => api.get('/item-master/lists').then((r) => r.data),
  addListValue: (field, name) => api.post(`/item-master/lists/${field}`, { name }).then((r) => r.data),
  renameListValue: (field, id, name) => api.put(`/item-master/lists/${field}/${id}`, { name }).then((r) => r.data),
  removeListValue: (field, id) => api.delete(`/item-master/lists/${field}/${id}`).then((r) => r.data),
};

export const purchaseOrderApi = {
  list: (search = '') => api.get('/purchase-orders', { params: { search } }).then((r) => r.data),
  get: (id) => api.get(`/purchase-orders/${id}`).then((r) => r.data),
  // { itemId: last net rate (P.Rate less Disc %) from this vendor } for the Old Price column
  lastRates: (vendorId, excludeOrderId) => api.get('/purchase-orders/last-rates', { params: { vendorId, excludeOrderId } }).then((r) => r.data),
  create: (data) => api.post('/purchase-orders', data).then((r) => r.data),
  update: (id, data) => api.put(`/purchase-orders/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/purchase-orders/${id}`).then((r) => r.data),
};

export const stockInApi = {
  list: (search = '') => api.get('/stock-ins', { params: { search } }).then((r) => r.data),
  get: (id) => api.get(`/stock-ins/${id}`).then((r) => r.data),
  // A vendor's purchase orders, and an order's lines with Ordered / Received / Due
  // Orders still to be received; includeOrderId keeps one listed (the order of a Stock In being edited)
  orders: (vendorId, includeOrderId) => api.get('/stock-ins/orders', { params: { vendorId, includeOrderId } }).then((r) => r.data),
  orderLines: (orderId, excludeStockInId) => api.get(`/stock-ins/order-lines/${orderId}`, { params: { excludeStockInId } }).then((r) => r.data),
  create: (data) => api.post('/stock-ins', data).then((r) => r.data),
  update: (id, data) => api.put(`/stock-ins/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/stock-ins/${id}`).then((r) => r.data),
};

// Pharmacy > Vendor > Payments: invoices are Stock Ins.
export const vendorBillPaymentApi = {
  // { vendorId?, all? ('1' keeps fully paid ones) }
  invoices: (params) => api.get('/vendor-bill-payments/invoices', { params }).then((r) => r.data),
  invoice: (stockInId) => api.get(`/vendor-bill-payments/invoices/${stockInId}`).then((r) => r.data),
  create: (data) => api.post('/vendor-bill-payments', data).then((r) => r.data),
  remove: (id) => api.delete(`/vendor-bill-payments/${id}`).then((r) => r.data),
};

export const stockReturnApi = {
  list: (search = '') => api.get('/stock-returns', { params: { search } }).then((r) => r.data),
  get: (id) => api.get(`/stock-returns/${id}`).then((r) => r.data),
  // A vendor's Stock Ins, and a Stock In's lines with Received / Returned / Left
  stockIns: (vendorId) => api.get('/stock-returns/stock-ins', { params: { vendorId } }).then((r) => r.data),
  stockInLines: (stockInId, excludeReturnId) => api.get(`/stock-returns/stock-in-lines/${stockInId}`, { params: { excludeReturnId } }).then((r) => r.data),
  create: (data) => api.post('/stock-returns', data).then((r) => r.data),
  update: (id, data) => api.put(`/stock-returns/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/stock-returns/${id}`).then((r) => r.data),
};

export const stockAdjustmentApi = {
  list: (search = '') => api.get('/stock-adjustments', { params: { search } }).then((r) => r.data),
  get: (id) => api.get(`/stock-adjustments/${id}`).then((r) => r.data),
  // { purchaseRate, batches: [{ Batch, ExpiryDate, CurStock, PurchaseRate }] }, with or without stock
  batches: (itemId, excludeAdjustmentId) => api.get(`/stock-adjustments/batches/${itemId}`, { params: { excludeAdjustmentId } }).then((r) => r.data),
  create: (data) => api.post('/stock-adjustments', data).then((r) => r.data),
  update: (id, data) => api.put(`/stock-adjustments/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/stock-adjustments/${id}`).then((r) => r.data),
};

export const salesReturnApi = {
  list: (search = '') => api.get('/sales-returns', { params: { search } }).then((r) => r.data),
  get: (id) => api.get(`/sales-returns/${id}`).then((r) => r.data),
  // Customers that have a sale; sales by { date } or { customer, mobile }
  customers: () => api.get('/sales-returns/customers').then((r) => r.data),
  sales: (params) => api.get('/sales-returns/sales', { params }).then((r) => r.data),
  // A sale's head and lines with Sold / Returned / Left
  saleLines: (saleId, excludeReturnId) => api.get(`/sales-returns/sale-lines/${saleId}`, { params: { excludeReturnId } }).then((r) => r.data),
  create: (data) => api.post('/sales-returns', data).then((r) => r.data),
  update: (id, data) => api.put(`/sales-returns/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/sales-returns/${id}`).then((r) => r.data),
};

export const pharmacyReportApi = {
  // params: { search, category, show: 'history' | 'instock' | 'outofstock' | 'all' }
  stock: (params) => api.get('/pharmacy-reports/stock', { params }).then((r) => r.data),
  history: (itemId) => api.get(`/pharmacy-reports/stock/${itemId}/history`).then((r) => r.data),
  // params: { from, to } as YYYY-MM-DD; either may be blank
  vendorPayments: (params) => api.get('/pharmacy-reports/vendor-payments', { params }).then((r) => r.data),
  vendorDocs: (vendorId, params) => api.get(`/pharmacy-reports/vendor-payments/${vendorId}`, { params }).then((r) => r.data),
  allInOneScreens: () => api.get('/pharmacy-reports/all-in-one/screens').then((r) => r.data),
  allInOneValues: (screen, column) => api.get('/pharmacy-reports/all-in-one/values', { params: { screen, column } }).then((r) => r.data),
  // params: { screen, columns (comma-separated keys), from, to, filters (JSON { columnKey: [values] }) }
  allInOne: (params) => api.get('/pharmacy-reports/all-in-one', { params }).then((r) => r.data),
};
export const salesBillingApi = {
  ...transactionApi('sales-billings'),
  get: (id) => api.get(`/sales-billings/${id}`).then((r) => r.data),
  // An item's batches with stock left; excludeSaleId adds back that sale's own quantities.
  batches: (itemId, excludeSaleId) => api.get(`/sales-billings/batches/${itemId}`, { params: { excludeSaleId } }).then((r) => r.data),
};

export default api;
