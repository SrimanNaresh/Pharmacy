import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login({ appName }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSigningIn(true);
    try {
      await login(username, password);
      // The URL doesn't change across the logout/login boundary, so without
      // this a freshly logged-in user lands wherever the previous session
      // left off instead of their own dashboard. "/" re-runs DashboardRedirect.
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Sign in failed');
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-white p-8 shadow-elevated">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center">
            <img src="/pwa-192x192.png" alt="" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-lg font-bold text-ink-800">{appName}</h1>
          <p className="mt-1 text-xs text-ink-400">Sign in to continue</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Username</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus placeholder="Username" />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary w-full justify-center" disabled={signingIn}>
            <LogIn size={16} /> {signingIn ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
