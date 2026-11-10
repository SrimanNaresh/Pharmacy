import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Menu, LogOut, ChevronDown } from 'lucide-react';
import TopNav, { SideNav, MobileMenu } from './components/TopNav.jsx';
import { clinicApi } from './api/client.js';
import { useAuth } from './context/AuthContext.jsx';
import { useAppName } from './hooks/useAppName.js';
import Login from './pages/Login.jsx';

const DashboardRedirect = lazy(() => import('./pages/DashboardRedirect.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const UserMaster = lazy(() => import('./pages/master/UserMaster.jsx'));
const MenuAccess = lazy(() => import('./pages/master/MenuAccess.jsx'));
const PharmacyDetails = lazy(() => import('./pages/master/PharmacyDetails.jsx'));
const VendorMaster = lazy(() => import('./pages/pharmacy/VendorMaster.jsx'));
const VendorList = lazy(() => import('./pages/pharmacy/VendorList.jsx'));
const ItemMaster = lazy(() => import('./pages/pharmacy/ItemMaster.jsx'));
const ItemListPage = lazy(() => import('./pages/pharmacy/ItemListPage.jsx'));
const ItemBulkUpdate = lazy(() => import('./pages/pharmacy/ItemBulkUpdate.jsx'));
const PurchaseOrder = lazy(() => import('./pages/pharmacy/PurchaseOrder.jsx'));
const PurchaseOrderList = lazy(() => import('./pages/pharmacy/PurchaseOrderList.jsx'));
const StockIn = lazy(() => import('./pages/pharmacy/StockIn.jsx'));
const StockInList = lazy(() => import('./pages/pharmacy/StockInList.jsx'));
const StockIps = lazy(() => import('./pages/pharmacy/StockIps.jsx'));
const StockReturnMaster = lazy(() => import('./pages/pharmacy/StockReturnMaster.jsx'));
const StockReturnList = lazy(() => import('./pages/pharmacy/StockReturnList.jsx'));
const SalesReturnMaster = lazy(() => import('./pages/pharmacy/SalesReturnMaster.jsx'));
const StockAdjustment = lazy(() => import('./pages/pharmacy/StockAdjustment.jsx'));
const StockAdjustmentList = lazy(() => import('./pages/pharmacy/StockAdjustmentList.jsx'));
const SalesReturnList = lazy(() => import('./pages/pharmacy/SalesReturnList.jsx'));
const SalesBilling = lazy(() => import('./pages/pharmacy/SalesBilling.jsx'));
const SalesBillingList = lazy(() => import('./pages/pharmacy/SalesBillingList.jsx'));
const StockReport = lazy(() => import('./pages/pharmacy/StockReport.jsx'));
const AllInOneReport = lazy(() => import('./pages/pharmacy/AllInOneReport.jsx'));
const VendorPayments = lazy(() => import('./pages/pharmacy/VendorPayments.jsx'));
const VendorPaymentEntry = lazy(() => import('./pages/pharmacy/VendorPaymentEntry.jsx'));

function PageLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const initials = (user?.username || '?').slice(0, 2).toUpperCase();

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-ink-100"
        title="Signed in"
      >
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-11 font-semibold text-white shadow-sm">
          {initials}
        </div>
        <p className="hidden text-13 font-semibold text-ink-700 sm:block">{user?.username || 'Account'}</p>
        <ChevronDown size={14} className="hidden text-ink-400 sm:block" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-44 rounded-xl border border-ink-100 bg-white py-1.5 shadow-elevated">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <LogOut size={15} /> Logout
          </button>
        </div>
      )}
    </div>
  );
}

function AppLayout({ appName }) {
  // On desktop the menu is always shown and the menu button moves it between
  // the top bar and a left-side column (remembered in this browser); on a
  // phone it starts closed and the button opens / closes the dropdown menu.
  const [navOpen, setNavOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [navSide, setNavSide] = useState(() => {
    try { return localStorage.getItem('nav-side') === '1'; } catch { return false; }
  });
  const toggleMenu = () => {
    if (!window.matchMedia('(min-width: 1024px)').matches) return setNavOpen((o) => !o);
    setNavOpen(true);
    setNavSide((v) => {
      try { localStorage.setItem('nav-side', v ? '0' : '1'); } catch { /* not stored */ }
      return !v;
    });
  };
  const [clinicName, setClinicName] = useState('');

  useEffect(() => { clinicApi.get().then((c) => setClinicName(c?.Name || '')).catch(() => setClinicName('')); }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="no-print sticky top-0 z-20">
        <header className="relative z-10 flex items-center gap-3 border-b border-ink-100 bg-white/85 px-4 py-0.5 backdrop-blur-md lg:px-6">
          <button
            onClick={toggleMenu}
            className={`hidden rounded-lg p-1 transition-colors hover:bg-ink-100 lg:block ${navSide ? 'bg-ink-100 text-brand-700' : 'text-ink-600'}`}
            aria-label="Toggle menu"
            title={navSide ? 'Move menu to the top' : 'Move menu to the left'}
          >
            <Menu size={18} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-ink-100">
              <img src="/pwa-192x192.png" alt="" className="h-full w-full object-contain" />
            </span>
            <div className="flex min-w-0 items-baseline gap-2">
              <p className="truncate font-display text-base font-bold tracking-tight text-brand-800 sm:text-lg">{clinicName || appName}</p>
              <p className="hidden truncate text-xs text-ink-300 md:block">Pharmacy management</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-full border border-ink-100 bg-ink-50 px-2.5 py-0.5 text-11 text-ink-400 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Connected
            </div>
            <UserMenu />
          </div>
        </header>

        <TopNav open={navOpen} side={navSide} />
      </div>
      <MobileMenu />

      <div className="flex min-h-0 flex-1">
        {navSide && <SideNav />}
        <main className="no-scrollbar min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 lg:px-6 lg:pb-6 lg:pt-2">
          <div className="w-full animate-fade-in">
            {/* Each page's code loads when it's first opened, not all up front. */}
            <Suspense fallback={<PageLoading />}>
            <Routes>
                <Route path="/" element={<DashboardRedirect />} />
              <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/settings/pharmacy-details" element={<PharmacyDetails />} />
                <Route path="/settings/user" element={<UserMaster />} />
                <Route path="/settings/menu-access" element={<MenuAccess />} />
                <Route path="/pharmacy/item" element={<ItemMaster />} />
                <Route path="/pharmacy/item-list" element={<ItemListPage />} />
                <Route path="/pharmacy/item-bulk-update" element={<ItemBulkUpdate />} />
                <Route path="/pharmacy/purchase-order" element={<PurchaseOrder />} />
                <Route path="/pharmacy/purchase-order-list" element={<PurchaseOrderList />} />
                <Route path="/pharmacy/stock-in" element={<StockIn />} />
                <Route path="/pharmacy/stock-in-list" element={<StockInList />} />
                <Route path="/pharmacy/stock-ips" element={<StockIps />} />
                <Route path="/pharmacy/stock-adjustment" element={<StockAdjustment />} />
                <Route path="/pharmacy/stock-adjustment-list" element={<StockAdjustmentList />} />
                <Route path="/pharmacy/return" element={<StockReturnMaster />} />
                <Route path="/pharmacy/return-list" element={<StockReturnList />} />
                <Route path="/pharmacy/sales-return" element={<SalesReturnMaster />} />
                <Route path="/pharmacy/sales-return-list" element={<SalesReturnList />} />
                <Route path="/pharmacy/vendor-master" element={<VendorMaster />} />
                <Route path="/pharmacy/vendor-list" element={<VendorList />} />
                <Route path="/pharmacy/vendor-payment" element={<VendorPaymentEntry />} />
                <Route path="/pharmacy/sales-billing" element={<SalesBilling />} />
                <Route path="/pharmacy/sales-billing-list" element={<SalesBillingList />} />
                <Route path="/pharmacy/stock-report" element={<StockReport />} />
                <Route path="/pharmacy/vendor-payments" element={<VendorPayments />} />
                <Route path="/pharmacy/all-in-one-report" element={<AllInOneReport />} />
              </Routes>
            </Suspense>
          </div>
          <div data-fab-spacer className="h-14 lg:hidden" />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const { isAuthenticated } = useAuth();
  const appName = useAppName();
  if (!isAuthenticated) return <Login appName={appName} />;
  return <AppLayout appName={appName} />;
}
