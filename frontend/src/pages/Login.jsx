import { useState } from 'react';
import { LogIn, User, Lock, Eye, EyeOff, AlertCircle, Receipt, CalendarClock, Truck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

// Sign-in: a branded gradient backdrop; on wide screens the pharmacy's name and
// what the app does sit on the left, the sign-in card on the right.
export default function Login({ appName }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSigningIn(true);
    try {
      // On success this clears the app's stored data and reloads at "/" (the
      // dashboard), so it only returns when sign-in fails.
      await login(username, password);
    } catch (err) {
      setError(err.response?.data?.error || 'Sign in failed');
    } finally {
      setSigningIn(false);
    }
  };

  const features = [
    [Receipt, 'Billing with GST', 'Fast sales bills and returns'],
    [CalendarClock, 'Stock & expiry', 'Batch-wise stock, low-stock and expiry alerts'],
    [Truck, 'Purchases & vendors', 'Orders, Stock In and vendor payments'],
  ];

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-sidebar-gradient px-4 py-8">
      <span className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-white/5" />
      <span className="pointer-events-none absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-teal-400/10" />
      <span className="pointer-events-none absolute right-1/3 top-10 h-40 w-40 rounded-full bg-brand-400/10 blur-2xl" />

      <div className="relative grid w-full max-w-4xl items-center gap-8 lg:grid-cols-2">
        <div className="hidden text-white lg:block">
          <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white p-1.5 shadow-lg">
            <img src="/pwa-192x192.png" alt="" className="h-full w-full object-contain" />
          </span>
          <h1 className="mt-5 font-display text-4xl font-bold leading-tight">{appName}</h1>
          <p className="mt-2 max-w-sm text-sm text-white/70">Everything your pharmacy counter needs, in one place.</p>
          <ul className="mt-7 space-y-3.5">
            {features.map(([Icon, title, text]) => (
              <li key={title} className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15"><Icon size={18} /></span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-12 text-white/60">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mx-auto w-full max-w-sm animate-fade-in rounded-3xl bg-white p-7 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.5)] sm:p-8">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white p-1 shadow-md ring-1 ring-ink-100 lg:hidden">
              <img src="/pwa-192x192.png" alt="" className="h-full w-full object-contain" />
            </span>
            <h2 className="text-xl font-bold tracking-tight text-ink-900">Welcome back</h2>
            <p className="mt-1 text-13 text-ink-400"><span className="lg:hidden">{appName} · </span>Sign in to continue</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <div className="relative">
                <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input className="input min-h-[38px] pl-9" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus placeholder="Username" autoComplete="username" />
              </div>
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input type={showPassword ? 'text' : 'password'} className="input min-h-[38px] pl-9 pr-10" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600" aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            {error && (
              <p className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-13 font-medium text-red-700">
                <AlertCircle size={15} className="shrink-0" /> {error}
              </p>
            )}
            <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={signingIn}>
              {signingIn ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <LogIn size={16} />}
              {signingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <p className="mt-6 text-center text-11 text-ink-300">© {new Date().getFullYear()} {appName}</p>
        </div>
      </div>
    </div>
  );
}
