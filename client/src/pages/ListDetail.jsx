import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Upload, Trash2, Send, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

export default function ListDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ phone: '', name: '' });
  const [search, setSearch] = useState('');
  const [countryCode, setCountryCode] = useState('60');
  const fileRef = useRef(null);

  const load = () => api.lists.get(id).then(setList);
  useEffect(() => {
    load();
  }, [id]);

  const add = (e) => {
    e.preventDefault();
    const payload = { ...form };
    // Optimistic: append a temp member and clear form
    const tempMember = {
      id: `temp-${Date.now()}`,
      phone: payload.phone,
      name: payload.name,
    };
    setList((prev) => prev ? {
      ...prev,
      members: [tempMember, ...prev.members],
      member_count: prev.member_count + 1,
    } : prev);
    setForm({ phone: '', name: '' });
    api.lists.addMember(id, payload).then(load).catch((err) => {
      toast.error(err.message);
      setList((prev) => prev ? {
        ...prev,
        members: prev.members.filter((m) => m.id !== tempMember.id),
        member_count: prev.member_count - 1,
      } : prev);
    });
  };

  const removeMember = (memberId) => {
    setList((prev) => prev ? {
      ...prev,
      members: prev.members.filter((m) => m.id !== memberId),
      member_count: Math.max(0, prev.member_count - 1),
    } : prev);
    api.lists.removeMember(id, memberId).catch((e) => {
      toast.error(e.message);
      load();
    });
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    toast.loading('Importing…', { id: 'imp' });
    try {
      const result = await api.lists.import(id, file, countryCode);
      toast.success(`Added ${result.added} of ${result.total}`, { id: 'imp' });
      load();
    } catch (err) {
      toast.error(err.message, { id: 'imp' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const renameList = async () => {
    const name = prompt('Rename list:', list.name);
    if (!name || name === list.name) return;
    await api.lists.update(id, { name });
    load();
  };

  if (!list) return <div className="p-10 text-slate-500">Loading…</div>;

  const filtered = list.members.filter((m) => {
    const q = search.toLowerCase();
    return (
      !q ||
      m.phone.toLowerCase().includes(q) ||
      (m.name || '').toLowerCase().includes(q)
    );
  });

  return (
    <>
      <PageHeader
        title={
          <button onClick={renameList} className="hover:text-brand-700 transition">
            {list.name}
          </button>
        }
        subtitle={`${list.member_count} contact${list.member_count === 1 ? '' : 's'}`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => nav('/lists')}>
              <ArrowLeft size={14} /> Back
            </button>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              Default country code:
              <input
                type="text"
                className="input !py-1 !px-2 max-w-[60px] text-center"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, ''))}
                title="Used when the file's number doesn't have a country code (e.g. 0123… → 60123…)"
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
              onChange={onUpload}
              className="hidden"
              id="list-upload"
            />
            <label htmlFor="list-upload" className="btn-outline cursor-pointer">
              <Upload size={14} /> Import CSV / Excel
            </label>
            <button
              className="btn-primary"
              onClick={() => nav(`/broadcast?list=${id}`)}
            >
              <Send size={14} /> Broadcast to this list
            </button>
          </>
        }
      />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form className="card p-5 space-y-3" onSubmit={add}>
          <h3 className="font-semibold text-slate-800">Add contact</h3>
          <div>
            <label className="label">Phone (with country code)</label>
            <input
              className="input"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="60123456789"
            />
          </div>
          <div>
            <label className="label">Name (optional)</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <button className="btn-primary w-full justify-center" type="submit">
            <Plus size={14} /> Add
          </button>
          <div className="text-[11px] text-slate-400 pt-2 border-t">
            Excel/CSV columns supported: <code>phone, name</code> (or <code>number</code>, <code>mobile</code>, <code>contact</code>, etc.)
          </div>
        </form>

        <div className="lg:col-span-2 card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <input
              className="input max-w-sm"
              placeholder="Search phone or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Users size={12} /> {filtered.length} shown
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">
              {list.member_count === 0
                ? 'No contacts yet — add manually or import a file.'
                : 'No matches.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Phone</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 1000).map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      {m.name || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">{m.phone}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        className="btn-ghost text-red-600 !p-1"
                        onClick={() => removeMember(m.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filtered.length > 1000 && (
                <tfoot>
                  <tr>
                    <td colSpan="3" className="px-4 py-2 text-xs text-slate-400 text-center">
                      Showing first 1000 of {filtered.length} — refine search to see others
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </>
  );
}
