// Master list of assignable menu items (leaf pages), grouped for display.
// MenuKey is the stable identifier stored in the MenuAccess table.
// `to` is the route path — the top menu builds its nav from this single source
// of truth so it can filter items by the signed-in user's granted access.
// Each Pharmacy part (Item, Vendor, Purchase / Order, ...) is its own
// top-level menu.
export const MENU_GROUPS = [
  // A group whose only page has the group's own name shows as a plain link.
  {
    group: 'Dashboard',
    items: [
      { key: 'dashboard', label: 'Dashboard', to: '/dashboard' },
    ],
  },
  {
    group: 'Item',
    items: [
      { key: 'pharmacy.item', label: 'Master', to: '/pharmacy/item' },
      { key: 'pharmacy.item-list', label: 'List', to: '/pharmacy/item-list' },
      { key: 'pharmacy.item-list-new', label: 'Bulk Update', to: '/pharmacy/item-bulk-update' },
    ],
  },
  {
    group: 'Vendor',
    items: [
      { key: 'pharmacy.vendor-master', label: 'Master', to: '/pharmacy/vendor-master' },
      { key: 'pharmacy.vendor-list', label: 'List', to: '/pharmacy/vendor-list' },
      { key: 'pharmacy.vendor-payment', label: 'Payments', to: '/pharmacy/vendor-payment' },
    ],
  },
  {
    group: 'Purchase / Order',
    items: [
      { key: 'pharmacy.purchase-master', label: 'Master', to: '/pharmacy/purchase-order' },
      { key: 'pharmacy.purchase-master-list', label: 'List', to: '/pharmacy/purchase-order-list' },
    ],
  },
  {
    group: 'Stock In',
    items: [
      { key: 'pharmacy.stock-inward', label: 'Master', to: '/pharmacy/stock-in' },
      { key: 'pharmacy.stock-inward-list', label: 'List', to: '/pharmacy/stock-in-list' },
      {
        label: 'Adjustment',
        submenu: [
          { key: 'pharmacy.stock-adjustment', label: 'Adjustment Entry', to: '/pharmacy/stock-adjustment' },
          { key: 'pharmacy.stock-adjustment-list', label: 'Adjustment List', to: '/pharmacy/stock-adjustment-list' },
        ],
      },
    ],
  },
  {
    group: 'Return',
    items: [
      {
        label: 'Purchase Return',
        submenu: [
          { key: 'pharmacy.purchase-return', label: 'Return Entry', to: '/pharmacy/return' },
          { key: 'pharmacy.purchase-return-list', label: 'Return List', to: '/pharmacy/return-list' },
        ],
      },
      {
        label: 'Sales Return',
        submenu: [
          { key: 'pharmacy.sales-return', label: 'Sales Return Entry', to: '/pharmacy/sales-return' },
          { key: 'pharmacy.sales-return-list', label: 'Sales Return List', to: '/pharmacy/sales-return-list' },
        ],
      },
    ],
  },
  {
    group: 'Sales',
    items: [
      { key: 'pharmacy.sales-billing', label: 'Master', to: '/pharmacy/sales-billing' },
      { key: 'pharmacy.sales-billing-list', label: 'List', to: '/pharmacy/sales-billing-list' },
    ],
  },
  {
    group: 'Report',
    items: [
      { key: 'pharmacy.stock-report', label: 'Stock Report', to: '/pharmacy/stock-report' },
      { key: 'pharmacy.vendor-payments', label: 'Vendor Payments', to: '/pharmacy/vendor-payments' },
      { key: 'pharmacy.all-in-one-report', label: 'All in One', to: '/pharmacy/all-in-one-report' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { key: 'settings.pharmacy-details', label: 'Pharmacy Details', to: '/settings/pharmacy-details' },
      { key: 'settings.user', label: 'User Master', to: '/settings/user' },
      { key: 'settings.menu-access', label: 'Menu Access', to: '/settings/menu-access' },
    ],
  },
];

// A group's items can nest submenus to arbitrary depth —
// recurse all the way down so access checks/grants still see every real leaf.
function flattenLeaves(items, groupLabel) {
  return items.flatMap((it) =>
    it.submenu ? flattenLeaves(it.submenu, groupLabel) : [{ ...it, group: groupLabel }]
  );
}
export const ALL_MENU_ITEMS = MENU_GROUPS.flatMap((g) => flattenLeaves(g.items, g.group));

export const ACCESS_LEVELS = ['Full', 'View', 'No Access'];
