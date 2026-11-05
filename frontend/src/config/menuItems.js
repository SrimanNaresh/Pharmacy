// Master list of assignable menu items (leaf pages), grouped for display.
// MenuKey is the stable identifier stored in the MenuAccess table.
// `to` is the route path — the top menu builds its nav from this single source
// of truth so it can filter items by the signed-in user's granted access.
export const MENU_GROUPS = [
  {
    group: 'Pharmacy',
    items: [
      // The Pharmacy spec's parts (Item, Vendor, Purchase / Order, Stock In,
      // Return, Sales, Report), each with Master / List.
      {
        label: 'Item',
        submenu: [
          { key: 'pharmacy.item', label: 'Master', to: '/pharmacy/item' },
          { key: 'pharmacy.item-list', label: 'List', to: '/pharmacy/item-list' },
          { key: 'pharmacy.item-list-new', label: 'Bulk Update', to: '/pharmacy/item-bulk-update' },
        ],
      },
      {
        label: 'Vendor',
        submenu: [
          { key: 'pharmacy.vendor-master', label: 'Master', to: '/pharmacy/vendor-master' },
          { key: 'pharmacy.vendor-list', label: 'List', to: '/pharmacy/vendor-list' },
          { key: 'pharmacy.vendor-payment', label: 'Payments', to: '/pharmacy/vendor-payment' },
        ],
      },
      {
        label: 'Purchase / Order',
        submenu: [
          { key: 'pharmacy.purchase-master', label: 'Master', to: '/pharmacy/purchase-order' },
          { key: 'pharmacy.purchase-master-list', label: 'List', to: '/pharmacy/purchase-order-list' },
        ],
      },
      {
        label: 'Stock In',
        submenu: [
          { key: 'pharmacy.stock-inward', label: 'Master', to: '/pharmacy/stock-in' },
          { key: 'pharmacy.stock-inward-list', label: 'List', to: '/pharmacy/stock-in-list' },
          { key: 'pharmacy.stock-adjustment', label: 'Adjustment', to: '/pharmacy/stock-adjustment' },
          { key: 'pharmacy.stock-adjustment-list', label: 'Adjustment List', to: '/pharmacy/stock-adjustment-list' },
        ],
      },
      {
        label: 'Return',
        submenu: [
          { key: 'pharmacy.purchase-return', label: 'Master', to: '/pharmacy/return' },
          { key: 'pharmacy.purchase-return-list', label: 'List', to: '/pharmacy/return-list' },
          { key: 'pharmacy.sales-return', label: 'Sales Return', to: '/pharmacy/sales-return' },
          { key: 'pharmacy.sales-return-list', label: 'Sales Return List', to: '/pharmacy/sales-return-list' },
        ],
      },
      {
        label: 'Sales',
        submenu: [
          { key: 'pharmacy.sales-billing', label: 'Master', to: '/pharmacy/sales-billing' },
          { key: 'pharmacy.sales-billing-list', label: 'List', to: '/pharmacy/sales-billing-list' },
        ],
      },
      {
        label: 'Report',
        submenu: [
          { key: 'pharmacy.stock-report', label: 'Stock Report', to: '/pharmacy/stock-report' },
          { key: 'pharmacy.vendor-payments', label: 'Vendor Payments', to: '/pharmacy/vendor-payments' },
          { key: 'pharmacy.all-in-one-report', label: 'All in One', to: '/pharmacy/all-in-one-report' },
        ],
      },
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
