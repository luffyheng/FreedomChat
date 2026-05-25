import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      const to = loc.state?.from || '/';
      nav(to, { replace: true });
    } catch (err) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center bg-paper-100 px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-8">
          <Mark />
          <div className="text-[15px] font-semibold tracking-tight2 text-ink">FreedomChat</div>
        </div>

        <div className="surface p-6 sm:p-7">
          <h1 className="text-[18px] font-semibold text-ink">Sign in</h1>
          <p className="text-[13px] text-ink-mute mt-1">Access your WhatsApp automation dashboard.</p>

          <form onSubmit={submit} className="mt-5 space-y-3.5">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label !mb-1.5">Password</label>
                <Link
                  to="/forgot"
                  className="text-[12px] text-ink-mute hover:text-ink underline-offset-4 hover:underline"
                >
                  Forgot?
                </Link>
              </div>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button type="submit" className="btn-primary w-full h-9" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-[11.5px] text-ink-faint text-center mt-5">
          Self-hosted &middot; FreedomChat Dispatch
        </p>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 22 22" className="shrink-0">
      <rect width="22" height="22" rx="6" fill="#09090b" />
      <path
        d="M6 15 L6 7.5 L8.5 7.5 L11 12 L13.5 7.5 L16 7.5 L16 15"
        stroke="#10b981"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
