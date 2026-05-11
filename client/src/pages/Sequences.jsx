import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Zap, Trash2, Power, Users, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

export default function Sequences() {
  const [list, setList] = useState([]);
  const nav = useNavigate();

  const load = () => api.sequences.list().then(setList);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000); // auto-refresh so subscriber count stays fresh
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    const { id } = await api.sequences.create({ name: 'Untitled Sequence' });
    toast.success('Sequence created');
    nav(`/sequences/${id}`);
  };

  const toggle = async (s) => {
    await api.sequences.update(s.id, { enabled: s.enabled ? 0 : 1 });
    load();
  };

  const remove = async (id) => {
    if (!confirm('Delete this sequence?')) return;
    await api.sequences.remove(id);
    load();
  };

  return (
    <>
      <PageHeader
        title="Sequences"
        subtitle="Scheduled follow-up messages triggered by subscribing from a flow"
        actions={
          <button className="btn-primary" onClick={create}>
            <Plus size={14} /> New sequence
          </button>
        }
      />
      <div className="p-8">
        {list.length === 0 ? (
          <div className="card p-12 text-center text-slate-500">
            <Zap size={40} className="mx-auto mb-3 text-slate-300" />
            <div className="font-medium text-slate-700">No sequences yet</div>
            <div className="text-sm mt-1">
              Create one, add queues with delays, then use a <b>Subscribe to Sequence</b> node in a flow.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {list.map((s) => (
              <div key={s.id} className="card p-5 flex flex-col">
                <div className="flex items-start justify-between">
                  <Link to={`/sequences/${s.id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                    {s.name}
                  </Link>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${s.enabled ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {s.enabled ? 'Active' : 'Paused'}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500 mt-3">
                  <span className="flex items-center gap-1"><Clock size={12} /> {s.queue_count} queue{s.queue_count === 1 ? '' : 's'}</span>
                  <span className="flex items-center gap-1"><Users size={12} /> {s.subscriber_count} active</span>
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <Link className="btn-outline" to={`/sequences/${s.id}`}>Open</Link>
                  <button className="btn-ghost" onClick={() => toggle(s)}>
                    <Power size={14} />
                    {s.enabled ? 'Pause' : 'Enable'}
                  </button>
                  <button className="btn-ghost text-red-600" onClick={() => remove(s.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
