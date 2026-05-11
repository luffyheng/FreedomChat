import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Workflow, Trash2, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

export default function Flows() {
  const [flows, setFlows] = useState([]);
  const nav = useNavigate();

  const load = () => api.flows.list().then(setFlows);
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const starter = {
      name: 'New Flow',
      graph: {
        nodes: [
          { id: 'trigger', type: 'trigger', position: { x: 80, y: 80 }, data: { keyword: 'hi' } },
          { id: 'reply', type: 'sendText', position: { x: 380, y: 80 }, data: { text: 'Hello! 👋' } },
        ],
        edges: [{ id: 'e1', source: 'trigger', target: 'reply' }],
      },
    };
    const { id } = await api.flows.create(starter);
    toast.success('Flow created');
    nav(`/flows/${id}`);
  };

  const remove = async (id) => {
    if (!confirm('Delete this flow?')) return;
    await api.flows.remove(id);
    load();
  };

  const toggle = async (flow) => {
    await api.flows.update(flow.id, { enabled: flow.enabled ? 0 : 1 });
    load();
  };

  return (
    <>
      <PageHeader
        title="Flows"
        subtitle="Automated conversations powered by triggers"
        actions={
          <button className="btn-primary" onClick={create}>
            <Plus size={14} /> New flow
          </button>
        }
      />
      <div className="p-8">
        {flows.length === 0 ? (
          <div className="card p-12 text-center text-slate-500">
            <Workflow size={40} className="mx-auto mb-3 text-slate-300" />
            <div className="font-medium text-slate-700">No flows yet</div>
            <div className="text-sm mt-1">Create your first flow to automate replies.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {flows.map((f) => (
              <div key={f.id} className="card p-5 flex flex-col">
                <div className="flex items-start justify-between">
                  <div>
                    <Link to={`/flows/${f.id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                      {f.name}
                    </Link>
                    <div className="text-xs text-slate-500 mt-1">
                      {f.description || 'No description'}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${f.enabled ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {f.enabled ? 'Active' : 'Paused'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <Link className="btn-outline" to={`/flows/${f.id}`}>
                    Open
                  </Link>
                  <button className="btn-ghost" onClick={() => toggle(f)}>
                    <Power size={14} />
                    {f.enabled ? 'Pause' : 'Enable'}
                  </button>
                  <button className="btn-ghost text-red-600" onClick={() => remove(f.id)}>
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
