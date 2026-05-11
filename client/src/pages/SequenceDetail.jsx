import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, Trash2, Clock, Save, Users } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import MediaField from '../components/MediaField.jsx';
import { api } from '../lib/api.js';

function msToDhms(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hrs: Math.floor((total % 86400) / 3600),
    mins: Math.floor((total % 3600) / 60),
    secs: total % 60,
  };
}
const dhmsToMs = ({ days, hrs, mins, secs }) =>
  ((+days || 0) * 86400 + (+hrs || 0) * 3600 + (+mins || 0) * 60 + (+secs || 0)) * 1000;

export default function SequenceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [seq, setSeq] = useState(null);
  const [testPhone, setTestPhone] = useState('');

  const load = () => api.sequences.get(id).then(setSeq);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id]);

  const addQueue = async () => {
    await api.sequences.addQueue(id, {
      name: `Queue ${(seq?.queues?.length ?? 0) + 1}`,
      delay_ms: 86400000,
      graph: {
        nodes: [{ id: 'msg', type: 'sendText', position: { x: 80, y: 80 }, data: { text: 'Follow-up message' } }],
        edges: [],
      },
    });
    load();
  };

  const saveName = async (name) => {
    setSeq({ ...seq, name });
    await api.sequences.update(id, { name });
  };

  const testSubscribe = async () => {
    if (!testPhone) return toast.error('Enter a phone first');
    try {
      await api.sequences.subscribe(id, testPhone.replace(/[^\d]/g, ''));
      toast.success('Subscribed — queues scheduled');
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!seq) return <div className="p-10 text-slate-500">Loading…</div>;

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
        subtitle={`${seq.queues.length} queue${seq.queues.length === 1 ? '' : 's'} · ${seq.subscribers.length} recent subscribers`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => nav('/sequences')}>
              <ArrowLeft size={14} /> Back
            </button>
            <input
              className="input max-w-[200px]"
              placeholder="Test phone"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
            <button className="btn-outline" onClick={testSubscribe}>Subscribe test phone</button>
            <button className="btn-primary" onClick={addQueue}>
              <Plus size={14} /> Add queue
            </button>
          </>
        }
      />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {seq.queues.length === 0 ? (
            <div className="card p-10 text-center text-slate-500">
              No queues yet. Click <b>Add queue</b> to schedule your first follow-up.
            </div>
          ) : (
            seq.queues.map((q, i) => <QueueCard key={q.id} queue={q} index={i} onChange={load} />)
          )}
        </div>
        <div className="card p-5">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Users size={14} /> Recent subscribers
          </h3>
          {seq.subscribers.length === 0 ? (
            <p className="text-sm text-slate-400 mt-3">None yet.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {seq.subscribers.slice(0, 20).map((s) => (
                <li key={s.id} className="flex items-center justify-between py-1 border-b border-slate-100">
                  <span className="font-mono text-slate-700 text-xs">{s.phone}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                    {s.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function QueueCard({ queue, index, onChange }) {
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

  const save = async () => {
    const nodes = [];
    if (mediaUrl) {
      nodes.push({
        id: 'media',
        type: mediaKind,
        position: { x: 80, y: 20 },
        data: { url: mediaUrl, caption: text },
      });
    } else if (text) {
      nodes.push({ id: 'msg', type: 'sendText', position: { x: 80, y: 80 }, data: { text } });
    }
    const graph = { nodes, edges: [] };
    await api.sequences.updateQueue(queue.id, {
      name,
      delay_ms: dhmsToMs(delay),
      graph,
    });
    toast.success('Queue saved');
    onChange?.();
  };

  const remove = async () => {
    if (!confirm('Delete this queue?')) return;
    await api.sequences.removeQueue(queue.id);
    onChange?.();
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-semibold">
            {index + 1}
          </span>
          <input
            className="font-semibold text-slate-800 bg-transparent outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost text-red-600" onClick={remove}>
            <Trash2 size={14} />
          </button>
          <button className="btn-primary" onClick={save}>
            <Save size={14} /> Save
          </button>
        </div>
      </div>
      <div className="mt-4">
        <label className="label flex items-center gap-1">
          <Clock size={12} /> Send after subscribing
        </label>
        <div className="grid grid-cols-4 gap-2">
          {['days', 'hrs', 'mins', 'secs'].map((k) => (
            <div key={k}>
              <input
                type="number"
                min="0"
                className="input"
                value={delay[k]}
                onChange={(e) => setDelay({ ...delay, [k]: e.target.value })}
              />
              <div className="text-[10px] text-slate-400 text-center mt-0.5 uppercase">{k}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Text / caption</label>
          <textarea
            className="input min-h-[90px]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What will be sent when this queue fires…"
          />
        </div>
        <div>
          <select
            className="input mb-2"
            value={mediaKind}
            onChange={(e) => setMediaKind(e.target.value)}
          >
            <option value="sendImage">Image</option>
            <option value="sendVideo">Video</option>
            <option value="sendAudio">Audio</option>
            <option value="sendDocument">Document</option>
          </select>
          <MediaField nodeType={mediaKind} value={mediaUrl} onChange={setMediaUrl} />
        </div>
      </div>
    </div>
  );
}
