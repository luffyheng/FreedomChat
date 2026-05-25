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
  PauseCircle,
  PlayCircle,
  SendHorizonal,
} from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Sidebar-style panel showing everything about a contact: name, attributes,
 * which sequences they're subscribed to, and quick actions (run a flow,
 * subscribe/unsubscribe a sequence, edit attributes).
 *
 * Works off the raw phone/JID as stored in the messages table.
 */
function relativeTime(ts) {
  const diff = Number(ts) - Date.now();
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60000) return past ? 'just now' : 'in a moment';
  if (abs < 3600000) { const m = Math.round(abs / 60000); return past ? `${m}m overdue` : `in ${m}m`; }
  if (abs < 86400000) { const h = Math.round(abs / 3600000); return past ? `${h}h overdue` : `in ${h}h`; }
  const d = Math.round(abs / 86400000);
  return past ? `${d}d overdue` : `in ${d}d`;
}

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

  // Map sequence_id → subscription info ({ status, subscriber_id, subscribed_at })
  const subMap = Object.fromEntries(
    (info?.sequences || []).map((s) => [s.id, s])
  );
  const pushName = info?.contact?.push_name || info?.contact?.name;
  const initials = (pushName || phone).slice(0, 2).toUpperCase();

  // Optimistic helper — instantly update a subscription's status in local state
  const optimisticSubStatus = (sequenceId, newStatus) => {
    setInfo((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sequences: prev.sequences.map((s) =>
          s.id === sequenceId ? { ...s, status: newStatus } : s
        ),
      };
    });
  };

  const runFlow = async (flowId) => {
    try {
      await api.people.runFlow(phone, flowId);
      toast.success('Flow dispatched');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const subscribe = async (sequenceId) => {
    optimisticSubStatus(sequenceId, 'active');
    toast.success('Subscribed');
    try {
      await api.people.subscribe(phone, sequenceId);
      load(); // need fresh next_dispatch after subscribing
    } catch (e) {
      toast.error(e.message);
      load(); // revert
    }
  };

  const unsubscribe = async (sequenceId) => {
    optimisticSubStatus(sequenceId, 'unsubscribed');
    toast('Sequence stopped', { icon: '⏹' });
    api.people.unsubscribe(phone, sequenceId).catch((e) => {
      toast.error(e.message);
      load(); // revert on failure
    });
  };

  const pauseSeq = async (sequenceId) => {
    optimisticSubStatus(sequenceId, 'paused');
    toast('Paused', { icon: '⏸' });
    api.people.pauseSequence(phone, sequenceId).catch((e) => {
      toast.error(e.message);
      load();
    });
  };

  const resumeSeq = async (sequenceId) => {
    optimisticSubStatus(sequenceId, 'active');
    toast.success('Resumed');
    api.people.resumeSequence(phone, sequenceId).catch((e) => {
      toast.error(e.message);
      load();
    });
  };

  const sendNow = async (dispatchId) => {
    toast.success('Sending…');
    try {
      await api.people.sendDispatch(phone, dispatchId);
      toast.success('Sent!');
      load(); // refresh to show next step
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
            <ul className="space-y-2">
              {sequences.map((s) => {
                const sub = subMap[s.id];
                const status = sub?.status; // 'active' | 'paused' | 'unsubscribed' | undefined
                return (
                  <li key={s.id} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-sm text-slate-700 truncate flex-1 font-medium">{s.name}</span>
                      {status === 'active' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold shrink-0">Active</span>
                      )}
                      {status === 'paused' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold shrink-0">Paused</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {status === 'active' && (
                        <>
                          <button
                            className="text-[11px] px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center gap-1"
                            onClick={() => pauseSeq(s.id)}
                            title="Pause follow-up — resumes when you click Resume"
                          >
                            <PauseCircle size={11} /> Pause
                          </button>
                          <button
                            className="text-[11px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                            onClick={() => unsubscribe(s.id)}
                            title="Stop follow-up permanently"
                          >
                            <BellOff size={11} /> Stop
                          </button>
                        </>
                      )}
                      {status === 'paused' && (
                        <>
                          <button
                            className="text-[11px] px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100 flex items-center gap-1"
                            onClick={() => resumeSeq(s.id)}
                          >
                            <PlayCircle size={11} /> Resume
                          </button>
                          <button
                            className="text-[11px] px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 flex items-center gap-1"
                            onClick={() => unsubscribe(s.id)}
                          >
                            <BellOff size={11} /> Stop
                          </button>
                        </>
                      )}
                      {(!status || status === 'unsubscribed') && (
                        <button
                          className="text-[11px] px-2 py-1 rounded bg-brand-50 text-brand-700 hover:bg-brand-100 flex items-center gap-1"
                          onClick={() => subscribe(s.id)}
                        >
                          <BellRing size={11} /> Subscribe
                        </button>
                      )}
                    </div>
                    {/* Next pending dispatch */}
                    {sub?.next_dispatch && (status === 'active' || status === 'paused') && (
                      <div className="mt-2 p-2 rounded bg-white border border-slate-200">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-400">Next up</div>
                            <div className="text-xs font-medium text-slate-700 truncate">{sub.next_dispatch.queue_name}</div>
                            <div className={`text-[10px] ${sub.next_dispatch.due_at < Date.now() ? 'text-amber-600' : 'text-slate-400'}`}>
                              {relativeTime(sub.next_dispatch.due_at)}
                            </div>
                          </div>
                          {status === 'active' && (
                            <button
                              className="shrink-0 text-[11px] px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-700 flex items-center gap-1"
                              onClick={() => sendNow(sub.next_dispatch.id)}
                              title="Send this step now"
                            >
                              <SendHorizonal size={11} /> Send now
                            </button>
                          )}
                        </div>
                        {sub.next_dispatch.preview_text ? (
                          <div className="mt-1.5 text-[11px] text-slate-500 bg-slate-50 rounded p-1.5 line-clamp-2 whitespace-pre-wrap">
                            {sub.next_dispatch.preview_text}
                          </div>
                        ) : (
                          <div className="mt-1.5 text-[10px] text-amber-600 italic">
                            ⚠ Queue step has no message — open Sequences to add content
                          </div>
                        )}
                      </div>
                    )}
                    {sub?.subscribed_at && (
                      <div className="text-[10px] text-slate-400 mt-1">
                        since {new Date(Number(sub.subscribed_at)).toLocaleDateString()}
                      </div>
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
