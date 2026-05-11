import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.auth.forgot(email);
      setSent(true);
    } catch (err) {
      toast.error(err.message || 'Could not send reset link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center bg-paper-100 px-6 py-12">
      <div className="w-full max-w-[380px]">
        <h1 className="text-[18px] font-semibold text-ink mb-1">Reset your password</h1>
        <p className="text-[13px] text-ink-mute mb-5">
          Enter the email tied to your account.
        </p>

        <div className="surface p-6">
          {sent ? (
            <div className="space-y-3 text-[13.5px] text-ink-soft">
              <p>
                If an account exists for <span className="font-medium text-ink">{email}</span>, a reset link has been issued.
              </p>
              <p className="text-ink-mute">
                Email delivery isn’t configured yet — the link is printed in the server console. Open it within an hour.
              </p>
              <Link to="/login" className="btn w-full justify-center">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button type="submit" className="btn-primary w-full h-9" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
              <Link to="/login" className="block text-center text-[12.5px] text-ink-mute hover:text-ink mt-1">
                Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
