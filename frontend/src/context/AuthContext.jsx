import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authApi, setAuthToken } from '../api/client.js';

const AuthContext = createContext(null);

// Read once at module load and attach immediately — child routes may fire data
// requests in their own mount effects before AuthProvider's effects would run,
// so the header must already be set by the time React starts rendering.
const initialToken = localStorage.getItem('authToken') || '';
setAuthToken(initialToken);

// Clears everything this site keeps in the browser (only this app's own data;
// other sites are untouched). Each step is best-effort so one blocked store
// never stops the sign-in.
async function clearAppData() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (!name) continue;
    const expire = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0`;
    document.cookie = `${expire}; path=/`;
    document.cookie = `${expire}; path=/; domain=${location.hostname}`;
  }
  try { localStorage.clear(); } catch { /* blocked */ }
  try { sessionStorage.clear(); } catch { /* blocked */ }
  try {
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* blocked */ }
  try {
    if (navigator.serviceWorker) await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
  } catch { /* blocked */ }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(initialToken);
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('authUser');
    return raw ? JSON.parse(raw) : null;
  });

  // On refresh, confirm the stored token is still valid and refresh the username.
  useEffect(() => {
    if (!token) return;
    authApi.me().then((me) => {
      setUser(me);
      localStorage.setItem('authUser', JSON.stringify(me));
    }).catch(() => logout());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A successful sign-in starts from a clean slate: this site's cookies,
  // storage, offline cache and service worker are cleared, the new session is
  // saved, and the page reloads so the latest version of the app opens.
  const login = useCallback(async (username, password) => {
    const { token: newToken, user: newUser } = await authApi.login(username, password);
    await clearAppData();
    localStorage.setItem('authToken', newToken);
    localStorage.setItem('authUser', JSON.stringify(newUser));
    window.location.replace('/');
    await new Promise(() => {}); // stay "signing in" until the reload takes over
  }, []);

  const logout = useCallback(() => {
    setAuthToken('');
    localStorage.removeItem('authToken');
    localStorage.removeItem('authUser');
    setToken('');
    setUser(null);
  }, []);

  useEffect(() => {
    window.addEventListener('auth:unauthorized', logout);
    return () => window.removeEventListener('auth:unauthorized', logout);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, user, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
