import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authApi, setAuthToken } from '../api/client.js';

const AuthContext = createContext(null);

// Read once at module load and attach immediately — child routes may fire data
// requests in their own mount effects before AuthProvider's effects would run,
// so the header must already be set by the time React starts rendering.
const initialToken = localStorage.getItem('authToken') || '';
setAuthToken(initialToken);

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

  const login = useCallback(async (username, password) => {
    const { token: newToken, user: newUser } = await authApi.login(username, password);
    setAuthToken(newToken); // synchronous, before the re-render mounts any protected routes
    localStorage.setItem('authToken', newToken);
    localStorage.setItem('authUser', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
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
