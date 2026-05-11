import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users, Trash2, FolderOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

export default function Lists() {
  const [lists, setLists] = useState([]);
  const nav = useNavigate();
  const load = () => api.lists.list().then(setLists);
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const name = prompt('List name:', 'New list');
    if (!name) return;
    const { id } = await api.lists.create({ name });
    nav(`/lists/${id}`);
  };

  const remove = async (id) => {
    if (!confirm('Delete this list?')) return;
    await api.lists.remove(id);
    load();
  };

  return (
    <>
      <PageHeader
        title="Contact Lists"
        subtitle="Group contacts for targeted broadcasts"
        actions={
          <button className="btn-primary" onClick={create}>
            <Plus size={14} /> New list
          </button>
        }
      />
      <div className="p-8">
        {lists.length === 0 ? (
          <div className="card p-12 text-center text-slate-500">
            <FolderOpen size={40} className="mx-auto mb-3 text-slate-300" />
            <div className="font-medium text-slate-700">No lists yet</div>
            <div className="text-sm mt-1">Create one and import contacts via CSV or Excel.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {lists.map((l) => (
              <div key={l.id} className="card p-5 flex flex-col">
                <Link to={`/lists/${l.id}`} className="font-semibold text-slate-800 hover:text-brand-700">
                  {l.name}
                </Link>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <Users size={12} /> {l.member_count} contact{l.member_count === 1 ? '' : 's'}
                </div>
                {l.description && (
                  <p className="text-sm text-slate-500 mt-2 line-clamp-2">{l.description}</p>
                )}
                <div className="flex items-center gap-2 mt-5">
                  <Link className="btn-outline" to={`/lists/${l.id}`}>
                    Open
                  </Link>
                  <button className="btn-ghost text-red-600" onClick={() => remove(l.id)}>
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
