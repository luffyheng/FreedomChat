import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  User,
  Clock,
  Play,
  Plus,
  X,
  Tag,
  Workflow,
  BellOff,
  BellRing,
} from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Sidebar-style panel showing everything about a contact: name, attributes,
 * which sequences they're subscribed to, and quick actions (run a flow,
 * subscribe/unsubscribe a sequence, edit attributes).
 *
 * Works off the raw phone/JID as stored in the messages table.
 */
export default function ContactPanel({ phone, onClose, variant = 'side' }) {
  const [info, setInfo] = useState(null);
  const [flows, setFlows] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [newAttr, setNewAttr] = useState({ key: '', value: '' });

  const load = () => {
    if (!phone) return;
    api.people.get(phone).then(setInfo).catch(() => setInfo(null));
  };

  useEffect(() => {
    load();
    api.flows.list().then(setFlows).catch(() => {});
    api.sequences.list().then(setSequences).catch(() => {});
  }, [phone]);

  if (!phone) return null;

  const subscribedIds = new Set((info?.sequences || []).filter((s) => s.status === 'active').map((s) => s.id));
  const pushName = info?.contact?.push_name || info?.contact?.name;
  const initials = (pushName || phone).slice(0, 2).toUpperCase();

  const runFlow = async (flowId) => {
    try {
      await api.people.runFlow(phone, flowId);
      toast.success('Flow dispatched');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const subscribe = async (sequenceId) => {
    try {
      await api.people.subscribe(phone, sequenceId);
      toast.success('Subscribed');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const unsubscribe = async (sequenceId) => {
    try {
      await api.people.unsubscribe(phone, sequenceId);
      toast('Unsubscribed', { icon: '👋' });
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const addAttr = async (e) => {
    e.preventDefault();
    if (!newAttr.key) return;
    try {
      await api.people.setAttribute(phone, newAttr.key, newAttr.value);
      setNewAttr({ key: '', value: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const removeAttr = async (key) => {
    await api.people.removeAttribute(phone, key);
    load();
  };

  return (
    <div className={`h-full flex flex-col bg-white ${variant === 'drawer' ? '' : 'border-l border-slate-200'}`}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">Contact info</h3>
        {onClose && (
          <button onClick={onClose} className="btn-ghost p-1">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="overflow-auto flex-1 p-5 space-y-5">
        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xl font-semibold">
            {initials || <User size={24} />}
          </div>
          <div className="font-semibold text-slate-800 mt-3">
            {pushName || <span className="text-slate-400">No name</span>}
          </div>
          <div className="text-xs font-mono text-slate-500 mt-0.5 break-all">{phone}</div>
          {info?.contact?.last_activity && (
            <div className="text-[11px] text-slate-400 mt-2 flex items-center gap-1">
              <Clock size={11} /> last seen {new Date(info.contact.last_activity).toLocaleString()}
            </div>
          )}
        </div>

        {/* Sequences */}
        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Clock size={12} /> Sequences
          </h4>
          {sequences.length === 0 ? (
            <p className="text-xs text-slate-400">No sequences exist yet.</p>
          ) : (
            <ul className="space-y-1">
              {sequences.map((s) => {
                const isSubbed = subscribedIds.has(s.id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <span className="text-sm text-slate-700 truncate flex-1">{s.name}</span>
                    {isSubbed ? (
                      <button
                        className="text-xs px-2 py-1 rounded-md bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center gap-1"
                        onClick={() => unsubscribe(s.id)}
                      >
                        <BellOff size={11} /> Unsubscribe
                      </button>
                    ) : (
                      <button
                        className="text-xs px-2 py-1 rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 flex items-center gap-1"
                        onClick={() => subscribe(s.id)}
                      >
                        <BellRing size={11} /> Subscribe
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Run a flow */}
        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Workflow size={12} /> Run a flow
          </h4>
          {flows.length === 0 ? (
            <p className="text-xs text-slate-400">No flows exist yet.</p>
          ) : (
            <ul className="space-y-1">
              {flows.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-sm text-slate-700 truncate flex-1">{f.name}</span>
                  <button
                    className="text-xs px-2 py-1 rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 flex items-center gap-1"
                    onClick={() => runFlow(f.id)}
                    title="Dispatch this flow to the contact now"
                  >
                    <Play size={11} /> Run
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Attributes */}
        <section>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Tag size={12} /> Attributes
          </h4>
          {info?.attributes?.length ? (
            <ul className="space-y-1 mb-2">
              {info.attributes.map((a) => (
                <li
                  key={a.key}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-slate-500 truncate">{a.key}</div>
                    <div className="text-sm text-slate-700 truncate">{a.value || <em className="text-slate-400">empty</em>}</div>
                  </div>
                  <button onClick={() => removeAttr(a.key)} className="text-slate-400 hover:text-red-600 p-1" title="Remove">
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400 mb-2">No attributes yet.</p>
          )}
          <form onSubmit={addAttr} className="grid grid-cols-[1fr_1fr_auto] gap-1">
            <input
              className="input !py-1.5 text-xs"
              placeholder="key"
              value={newAttr.key}
              onChange={(e) => setNewAttr({ ...newAttr, key: e.target.value })}
            />
            <input
              className="input !py-1.5 text-xs"
              placeholder="value"
              value={newAttr.value}
              onChange={(e) => setNewAttr({ ...newAttr, value: e.target.value })}
            />
            <button className="btn-primary !py-1.5 !px-2" type="submit">
              <Plus size={12} />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
