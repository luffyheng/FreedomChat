import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plus, Trash2, Clock, Save, Users, ChevronDown, ChevronRight,
  Zap, PauseCircle, CheckCircle, XCircle,
} from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import MediaField from '../components/MediaField.jsx';
import { api } from '../lib/api.js';

function msToDhms(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hrs:  Math.floor((total % 86400) / 3600),
    mins: Math.floor((total % 3600) / 60),
    secs: total % 60,
  };
}
const dhmsToMs = ({ days, hrs, mins, secs }) =>
  ((+days || 0) * 86400 + (+hrs || 0) * 3600 + (+mins || 0) * 60 + (+secs || 0)) * 1000;

function msLabel(ms) {
  const d = msToDhms(ms);
  const parts = [];
  if (d.days) parts.push(`${d.days}d`);
  if (d.hrs)  parts.push(`${d.hrs}h`);
  if (d.mins) parts.push(`${d.mins}m`);
  if (!parts.length) parts.push('immediately');
  return parts.join(' ');
}

export default function SequenceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [seq, setSeq] = useState(null);
  const [testPhone, setTestPhone] = useState('');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [bulk, setBulk] = useState({ count: 5, startDay: 1, interval: 1, text: 'Hi! Just following up 👋' });

  const load = () => api.sequences.get(id).then(setSeq);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id]);

  const addQueue = async () => {
    const nextDay = seq?.queues?.length
      ? Math.round(seq.queues[seq.queues.length - 1].delay_ms / 86400000) + 1
      : 1;
    await api.sequences.addQueue(id, {
      name: `Follow-up ${(seq?.queues?.length ?? 0) + 1}`,
      delay_ms: nextDay * 86400000,
      graph: {
        nodes: [{ id: 'msg', type: 'sendText', position: { x: 80, y: 80 }, data: { text: 'Hi! Just following up 👋' } }],
        edges: [],
      },
    });
    load();
  };

  const bulkAdd = async () => {
    const { count, startDay, interval, text } = bulk;
    const n = Math.min(Math.max(1, +count), 30);
    const start = Math.max(0, +startDay);
    const step = Math.max(0, +interval);
    const existing = seq?.queues?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const dayOffset = start + i * step;
      await api.sequences.addQueue(id, {
        name: `Follow-up ${existing + i + 1}`,
        delay_ms: dayOffset * 86400000,
        graph: {
          nodes: [{ id: 'msg', type: 'sendText', position: { x: 80, y: 80 }, data: { text } }],
          edges: [],
        },
      });
    }
    toast.success(`Added ${n} follow-up queues`);
    setShowBulkAdd(false);
    load();
  };

  const saveName = async (name) => {
    setSeq({ ...seq, name });
    await api.sequences.update(id, { name });
  };

  const testSubscribe = () => {
    if (!testPhone) return toast.error('Enter a phone first');
    toast.success('Subscribed — queues scheduled');
    api.sequences.subscribe(id, testPhone.replace(/[^\d]/g, '')).catch((e) => {
      toast.error(e.message);
    });
  };

  if (!seq) return <div className="p-10 text-slate-500">Loading…</div>;

  const activeSubs   = seq.subscribers.filter((s) => s.status === 'active').length;
  const pausedSubs   = seq.subscribers.filter((s) => s.status === 'paused').length;
  const stoppedSubs  = seq.subscribers.filter((s) => s.status === 'unsubscribed').length;

  return (
    <>
      <PageHeader
        title={
          <input
            className="bg-transparent outline-none text-xl font-semibold"
            value={seq.name}
            onChange={(e) => saveName(e.target.value)}
          />
        }
        subtitle={`${seq.queues.length} step${seq.queues.length === 1 ? '' : 's'} · ${activeSubs} active · ${pausedSubs} paused`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => nav('/sequences')}>
              <ArrowLeft size={14} /> Back
            </button>
            <input
              className="input max-w-[180px]"
              placeholder="Test phone"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
            <button className="btn-outline" onClick={testSubscribe}>Subscribe test</button>
            <button className="btn-ghost" onClick={() => setShowBulkAdd((v) => !v)}>
              <Zap size={14} /> Bulk add
            </button>
            <button className="btn-primary" onClick={addQueue}>
              <Plus size={14} /> Add step
            </button>
          </>
        }
      />

      {/* Bulk-add series panel */}
      {showBulkAdd && (
        <div className="mx-8 mt-0 mb-4 card p-5 border-2 border-brand-200 bg-brand-50/30">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Zap size={15} className="text-brand-600" /> Quick series builder
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="label">Number of steps</label>
              <input type="number" min={1} max={30} className="input" value={bulk.count}
                onChange={(e) => setBulk({ ...bulk, count: e.target.value })} />
            </div>
            <div>
              <label className="label">Start (day after sub)</label>
              <input type="number" min={0} className="input" value={bulk.startDay}
                onChange={(e) => setBulk({ ...bulk, startDay: e.target.value })} />
            </div>
            <div>
              <label className="label">Interval (days)</label>
              <input type="number" min={0} className="input" value={bulk.interval}
                onChange={(e) => setBulk({ ...bulk, interval: e.target.value })} />
            </div>
            <div className="flex items-end">
              <div className="text-xs text-slate-500 bg-white rounded p-2 border border-slate-200 w-full">
                Sends: day {+bulk.startDay}, {+bulk.startDay + +bulk.interval}, {+bulk.startDay + +bulk.interval * 2}…
              </div>
            </div>
          </div>
          <div className="mb-3">
            <label className="label">Default message (edit each step after adding)</label>
            <textarea className="input min-h-[60px]" value={bulk.text}
              onChange={(e) => setBulk({ ...bulk, text: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={bulkAdd}>
              <Plus size={14} /> Create {Math.min(Math.max(1, +bulk.count), 30)} steps
            </button>
            <button className="btn-ghost" onClick={() => setShowBulkAdd(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {seq.queues.length === 0 ? (
            <div className="card p-10 text-center text-slate-500">
              <Clock size={32} className="mx-auto mb-3 text-slate-300" />
              <p>No steps yet.</p>
              <p className="text-sm mt-1">Click <b>Add step</b> for one or <b>Bulk add</b> to create a full series in seconds.</p>
            </div>
          ) : (
            seq.queues.map((q, i) => <QueueCard key={q.id} queue={q} index={i} onChange={load} />)
          )}
        </div>

        {/* Subscriber panel */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
              <Users size={14} /> Subscribers
            </h3>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div className="text-center p-2 rounded-lg bg-green-50">
                <div className="text-lg font-bold text-green-700">{activeSubs}</div>
                <div className="text-[10px] text-green-600">Active</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-amber-50">
                <div className="text-lg font-bold text-amber-700">{pausedSubs}</div>
                <div className="text-[10px] text-amber-600">Paused</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-50">
                <div className="text-lg font-bold text-slate-600">{stoppedSubs}</div>
                <div className="text-[10px] text-slate-500">Stopped</div>
              </div>
            </div>
            {seq.subscribers.length === 0 ? (
              <p className="text-sm text-slate-400">None yet.</p>
            ) : (
              <ul className="space-y-1 text-sm max-h-[300px] overflow-y-auto">
                {seq.subscribers.slice(0, 50).map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="font-mono text-slate-700 text-xs truncate flex-1">{s.phone}</span>
                    <StatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status }) {
  if (status === 'active')
    return <span className="flex items-center gap-0.5 text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full"><CheckCircle size={9} /> active</span>;
  if (status === 'paused')
    return <span className="flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full"><PauseCircle size={9} /> paused</span>;
  return <span className="flex items-center gap-0.5 text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full"><XCircle size={9} /> stopped</span>;
}

function QueueCard({ queue, index, onChange }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(queue.name);
  const [delay, setDelay] = useState(msToDhms(queue.delay_ms));
  const [text, setText] = useState(
    queue.graph?.nodes?.find((n) => n.type === 'sendText')?.data?.text || ''
  );
  const mediaNode = queue.graph?.nodes?.find((n) =>
    ['sendImage', 'sendVideo', 'sendAudio', 'sendDocument', 'sendMedia'].includes(n.type)
  );
  const [mediaUrl, setMediaUrl] = useState(mediaNode?.data?.url || '');
  const [mediaKind, setMediaKind] = useState(mediaNode?.type || 'sendImage');

  const save = () => {
    const nodes = [];
    if (mediaUrl) {
      nodes.push({
        id: 'media', type: mediaKind,
        position: { x: 80, y: 20 },
        data: { url: mediaUrl, caption: text },
      });
    } else if (text) {
      nodes.push({ id: 'msg', type: 'sendText', position: { x: 80, y: 80 }, data: { text } });
    }
    // Optimistic: show "Saved" instantly, API in background
    toast.success('Saved');
    api.sequences.updateQueue(queue.id, { name, delay_ms: dhmsToMs(delay), graph: { nodes, edges: [] } })
      .then(() => onChange?.())
      .catch((e) => toast.error(`Save failed: ${e.message}`));
  };

  const remove = () => {
    if (!confirm('Delete this step?')) return;
    // Optimistic: parent reloads after API completes; but trigger UI fade via onChange
    api.sequences.removeQueue(queue.id).then(() => onChange?.()).catch((e) => {
      toast.error(e.message);
      onChange?.();
    });
    onChange?.(); // trigger parent refresh instantly (it will refetch)
  };

  return (
    <div className="card overflow-hidden">
      {/* Header row — always visible */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-bold shrink-0">
            {index + 1}
          </span>
          <div>
            <div className="font-medium text-slate-800 text-sm">{name}</div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <Clock size={9} /> after {msLabel(queue.delay_ms)}
              {text && <span className="ml-2 truncate max-w-[160px] text-slate-500">· {text.slice(0, 40)}{text.length > 40 ? '…' : ''}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button className="btn-ghost text-red-600 !px-1.5 !py-1" onClick={remove} title="Delete">
            <Trash2 size={13} />
          </button>
          <button className="btn-primary !px-2 !py-1 text-xs" onClick={save}>
            <Save size={12} /> Save
          </button>
          <span className="text-slate-400 ml-1">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100">
          <div className="mb-3">
            <label className="label">Step name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Day 1 follow-up"
            />
          </div>
          <div className="mb-4">
            <label className="label flex items-center gap-1"><Clock size={12} /> Send after subscribing</label>
            <div className="grid grid-cols-4 gap-2">
              {['days', 'hrs', 'mins', 'secs'].map((k) => (
                <div key={k}>
                  <input
                    type="number" min="0" className="input text-center"
                    value={delay[k]}
                    onChange={(e) => setDelay({ ...delay, [k]: e.target.value })}
                  />
                  <div className="text-[10px] text-slate-400 text-center mt-0.5 uppercase">{k}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Text message</label>
              <textarea
                className="input min-h-[90px]"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Message text…"
              />
            </div>
            <div>
              <select className="input mb-2" value={mediaKind} onChange={(e) => setMediaKind(e.target.value)}>
                <option value="sendImage">Image</option>
                <option value="sendVideo">Video</option>
                <option value="sendAudio">Voice note</option>
                <option value="sendDocument">Document</option>
              </select>
              <MediaField nodeType={mediaKind} value={mediaUrl} onChange={setMediaUrl} />
              {mediaUrl && (
                <button className="text-xs text-red-500 mt-1 hover:underline" onClick={() => setMediaUrl('')}>
                  Remove media
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
