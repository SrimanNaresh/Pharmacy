import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { menuAccessApi } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui.jsx';
import { ALL_MENU_ITEMS } from '../config/menuItems.js';

// Sends a freshly logged-in user to Sales (the counter screen) when they may
// use it, else to the first screen their Menu Access grants. A user with no
// Menu Access rows sees every screen.
export default function DashboardRedirect() {
  const { user } = useAuth();
  const [target, setTarget] = useState(null);

  useEffect(() => {
    if (!user?.userId) return;
    const first = '/pharmacy/sales-billing';
    menuAccessApi.get(user.userId).then((rows) => {
      const map = new Map(rows.map((r) => [r.MenuKey, r.AccessLevel]));
      const granted = (key) => map.size === 0 || ['Full', 'View'].includes(map.get(key));
      if (granted('pharmacy.sales-billing')) return setTarget(first);
      setTarget(ALL_MENU_ITEMS.find((m) => granted(m.key))?.to || first);
    }).catch(() => setTarget(first));
  }, [user?.userId]);

  if (!target) return <Spinner />;
  return <Navigate to={target} replace />;
}
