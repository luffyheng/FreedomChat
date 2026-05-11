import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';

export default function Reset() {
  const { token } = useParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.auth.reset(token, password);
      toast.success('Password updated — sign in to continue.');
      nav('/login', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center bg-paper-100 px-6 py-12">
      <div className="w-full max-w-[380px]">
        <h1 className="text-[18px] font-semibold text-ink mb-1">Choose a new password</h1>
        <p className="text-[13px] text-ink-mute mb-5">
          Make it at least 8 characters. The link is valid for one hour.
        </p>

        <div className="surface p-6">
          <form onSubmit={submit} className="space-y-3.5">
            <div>
              <label className="label">New password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary w-full h-9" disabled={loading}>
              {loading ? 'Updating…' : 'Update password'}
            </button>
            <Link to="/login" className="block text-center text-[12.5px] text-ink-mute hover:text-ink mt-1">
              Back to sign in
            </Link>
          </form>
        </div>
      </div>
    </div>
  );
}
