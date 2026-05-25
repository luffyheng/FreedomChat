import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { QrCode, LogOut, RefreshCw, Smartphone } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

export default function Connect() {
  const [state, setState] = useState({ status: 'idle', qr: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.whatsapp.status().then(setState).catch(() => {});
    const handler = (s) => setState(s);
    socket.on('wa:status', handler);
    return () => socket.off('wa:status', handler);
  }, []);

  const connect = async () => {
    setLoading(true);
    try {
      await api.whatsapp.connect();
      toast.success('Initializing… QR will appear shortly.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      setLoading(true);
      await api.whatsapp.logout();
      setState({ status: 'idle', qr: null });
      toast('Disconnected', { icon: '👋' });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Connect WhatsApp"
        subtitle="Scan the QR with WhatsApp → Linked Devices → Link a Device"
        actions={
          <>
            {state.status === 'ready' ? (
              <button className="btn-danger" onClick={logout}>
                <LogOut size={14} /> Logout
              </button>
            ) : (
              <button className="btn-primary" onClick={connect} disabled={loading}>
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                {state.status === 'qr' ? 'Refresh' : 'Start session'}
              </button>
            )}
          </>
        }
      />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-8 flex flex-col items-center justify-center min-h-[420px]">
          {state.status === 'ready' ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-700 grid place-items-center mx-auto mb-4">
                <Smartphone size={28} />
              </div>
              <div className="font-semibold text-slate-800">WhatsApp connected</div>
              <div className="text-sm text-slate-500 mt-1">Your flows and broadcasts are live.</div>
            </div>
          ) : state.qr ? (
            <>
              <img src={state.qr} alt="QR" className="w-64 h-64" />
              <div className="text-xs text-slate-500 mt-4">Scan within 60 seconds</div>
            </>
          ) : (
            <div className="text-center text-slate-400">
              <QrCode size={48} className="mx-auto mb-3" />
              <div className="text-sm">No active session. Click “Start session” to begin.</div>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-slate-800 mb-3">How it works</h3>
          <ol className="text-sm text-slate-600 space-y-2 list-decimal list-inside">
            <li>Click <b>Start session</b> — a QR is generated.</li>
            <li>Open WhatsApp → <b>Settings</b> → <b>Linked Devices</b> → <b>Link a Device</b>.</li>
            <li>Scan the QR above.</li>
            <li>Your session stays authenticated across server restarts (local session files).</li>
          </ol>
          <div className="mt-6 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            Heads up: this uses the unofficial WhatsApp Web automation (like FreedomChat). Heavy
            broadcasts or spammy usage may get your number banned. Warm up slowly and use it
            responsibly.
          </div>
        </div>
      </div>
    </>
  );
}
