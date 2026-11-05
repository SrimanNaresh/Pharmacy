import { useState, useEffect, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Menu, LogOut, ChevronDown } from 'lucide-react';
import TopNav from './components/TopNav.jsx';
import { clinicApi } from './api/client.js';
import { useAuth } from './context/AuthContext.jsx';
import { useAppName } from './hooks/useAppName.js';
import Login from './pages/Login.jsx';

import DashboardRedirect from './pages/DashboardRedirect.jsx';
import UserMaster from './pages/master/UserMaster.jsx';
import MenuAccess from './pages/master/MenuAccess.jsx';
import PharmacyDetails from './pages/master/PharmacyDetails.jsx';
import VendorMaster from './pages/pharmacy/VendorMaster.jsx';
import VendorList from './pages/pharmacy/VendorList.jsx';
import ItemMaster from './pages/pharmacy/ItemMaster.jsx';
import ItemListPage from './pages/pharmacy/ItemListPage.jsx';
import ItemBulkUpdate from './pages/pharmacy/ItemBulkUpdate.jsx';
import PurchaseOrder from './pages/pharmacy/PurchaseOrder.jsx';
import PurchaseOrderList from './pages/pharmacy/PurchaseOrderList.jsx';
import StockIn from './pages/pharmacy/StockIn.jsx';
import StockInList from './pages/pharmacy/StockInList.jsx';
import StockReturnMaster from './pages/pharmacy/StockReturnMaster.jsx';
import StockReturnList from './pages/pharmacy/StockReturnList.jsx';
import SalesReturnMaster from './pages/pharmacy/SalesReturnMaster.jsx';
import StockAdjustment from './pages/pharmacy/StockAdjustment.jsx';
import StockAdjustmentList from './pages/pharmacy/StockAdjustmentList.jsx';
import SalesReturnList from './pages/pharmacy/SalesReturnList.jsx';
import SalesBilling from './pages/pharmacy/SalesBilling.jsx';
import SalesBillingList from './pages/pharmacy/SalesBillingList.jsx';
import StockReport from './pages/pharmacy/StockReport.jsx';
import AllInOneReport from './pages/pharmacy/AllInOneReport.jsx';
import VendorPayments from './pages/pharmacy/VendorPayments.jsx';
import VendorPaymentEntry from './pages/pharmacy/VendorPaymentEntry.jsx';

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
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-semibold text-white shadow-sm">
          {initials}
        </div>
        <p className="hidden text-[13px] font-semibold text-ink-700 sm:block">{user?.username || 'Account'}</p>
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
  // Open by default — the hamburger toggles the nav bar (desktop) / dropdown (mobile) shut.
  const [navOpen, setNavOpen] = useState(true);
  const [clinicName, setClinicName] = useState('');

  useEffect(() => { clinicApi.get().then((c) => setClinicName(c?.Name || '')).catch(() => setClinicName('')); }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="no-print sticky top-0 z-20">
        <header className="relative z-10 flex items-center gap-3 border-b border-ink-100 bg-white/85 px-4 py-0.5 backdrop-blur-md lg:px-6">
          <button
            onClick={() => setNavOpen((o) => !o)}
            className="rounded-lg p-1 text-ink-600 transition-colors hover:bg-ink-100"
            aria-label="Toggle menu"
            title="Show / hide menu"
          >
            <Menu size={18} />
          </button>
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <p className="truncate font-display text-base font-bold tracking-tight text-brand-800 sm:text-lg">{clinicName || appName}</p>
            <p className="hidden truncate text-xs text-ink-300 md:block">Pharmacy management</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-1.5 rounded-full border border-ink-100 bg-ink-50 px-2.5 py-0.5 text-[11px] text-ink-400 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-500" /> Connected
            </div>
            <UserMenu />
          </div>
        </header>

        <TopNav open={navOpen} onClose={() => setNavOpen(false)} />
      </div>

      <main className="no-scrollbar flex-1 overflow-y-auto px-4 pb-4 pt-2 lg:px-6 lg:pb-6 lg:pt-2">
        <div className="w-full animate-fade-in">
          <Routes>
              <Route path="/" element={<DashboardRedirect />} />
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
          </div>
        </main>
    </div>
  );
}

export default function App() {
  const { isAuthenticated } = useAuth();
  const appName = useAppName();
  if (!isAuthenticated) return <Login appName={appName} />;
  return <AppLayout appName={appName} />;
}
