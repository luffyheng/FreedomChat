import { useEffect, useRef, useState } from 'react';
import { Plus, Upload, Trash2, Users, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import PageHeader from '../components/PageHeader.jsx';
import ContactPanel from '../components/ContactPanel.jsx';
import { api } from '../lib/api.js';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', tags: '' });
  const [openIndex, setOpenIndex] = useState(null);
  const fileRef = useRef(null);

  const openPhone = openIndex !== null ? (contacts[openIndex]?.jid || contacts[openIndex]?.phone) : null;

  const load = () => api.contacts.list().then(setContacts);
  useEffect(() => {
    load();
  }, []);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.contacts.create(form);
      setForm({ name: '', phone: '', tags: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await api.contacts.import(file);
    toast.success(`Imported ${result.added} contacts (of ${result.total})`);
    load();
    if (fileRef.current) fileRef.current.value = '';
  };

  const remove = async (id) => {
    await api.contacts.remove(id);
    setContacts((c) => c.filter((x) => x.id !== id));
    setOpenIndex(null);
  };

  const goNext = () => setOpenIndex((i) => Math.min(contacts.length - 1, i + 1));
  const goPrev = () => setOpenIndex((i) => Math.max(0, i - 1));

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={onUpload}
              className="hidden"
              id="csv-upload"
            />
            <label htmlFor="csv-upload" className="btn-outline cursor-pointer">
              <Upload size={14} /> Import CSV
            </label>
          </>
        }
      />
      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form className="card p-5 space-y-3" onSubmit={add}>
          <h3 className="font-semibold text-slate-800">Add contact</h3>
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Phone (with country code)</label>
            <input
              className="input"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="919xxxxxxxxx"
            />
          </div>
          <div>
            <label className="label">Tags (comma separated)</label>
            <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          </div>
          <button className="btn-primary w-full justify-center" type="submit">
            <Plus size={14} /> Add
          </button>
          <p className="text-[11px] text-slate-400 pt-2 border-t">
            CSV format: <code>name,phone,tags</code>
          </p>
        </form>

        <div className="card lg:col-span-2 overflow-hidden">
          {contacts.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <Users size={40} className="mx-auto mb-3 text-slate-300" />
              No contacts yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-3">Contact</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Sequences</th>
                  <th className="text-left px-4 py-3">Last activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c, i) => (
                  <tr
                    key={c.id}
                    className={`border-t border-slate-100 hover:bg-slate-50 cursor-pointer ${openIndex === i ? 'bg-brand-50' : ''}`}
                    onClick={() => setOpenIndex(i)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-slate-800">
                        {c.push_name || c.name || <span className="text-slate-400">Unnamed</span>}
                      </div>
                      <div className="text-xs font-mono text-slate-500">{c.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">
                        {c.status || 'reachable'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {c.sequence_subs?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {c.sequence_subs.map((s) => (
                            <span
                              key={s.name}
                              className={`text-[10px] px-2 py-0.5 rounded-full ${
                                s.status === 'active'
                                  ? 'bg-green-100 text-green-700'
                                  : s.status === 'paused'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                              title={s.status}
                            >
                              {s.name}
                            </span>
                          ))}
                        </div>
                      ) : c.sequences?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {c.sequences.map((s) => (
                            <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {s}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {c.last_activity ? (
                        <span className="flex items-center gap-1">
                          <Clock size={11} /> {new Date(c.last_activity).toLocaleString()}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="btn-ghost text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(c.id);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Contact detail drawer with prev/next navigation */}
      {openIndex !== null && openPhone && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setOpenIndex(null)}>
          <div className="flex-1 bg-black/30" />
          <div
            className="w-[420px] bg-white shadow-2xl animate-slide-in flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Navigation bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 text-sm">
              <button
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-200 disabled:opacity-30 text-slate-600"
                onClick={goPrev}
                disabled={openIndex === 0}
              >
                <ChevronLeft size={15} /> Prev
              </button>
              <span className="text-slate-500 text-xs">{openIndex + 1} / {contacts.length}</span>
              <button
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-200 disabled:opacity-30 text-slate-600"
                onClick={goNext}
                disabled={openIndex === contacts.length - 1}
              >
                Next <ChevronRight size={15} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ContactPanel phone={openPhone} onClose={() => setOpenIndex(null)} variant="drawer" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
