import { useEffect, useState } from 'react';
import {
  Plus, Trash2, Edit2, X, Save, Zap, Type, Mic, Image as ImageIcon,
  Video, FileText, GripVertical, ChevronDown, ChevronUp, Send,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api } from '../lib/api.js';
import MediaField from '../components/MediaField.jsx';

const ITEM_TYPES = [
  { value: 'text',     label: 'Text',       icon: Type,      color: 'text-ink' },
  { value: 'audio',    label: 'Voice Note', icon: Mic,       color: 'text-brand-600' },
  { value: 'image',    label: 'Image',      icon: ImageIcon, color: 'text-sky-600' },
  { value: 'video',    label: 'Video',      icon: Video,     color: 'text-purple-600' },
  { value: 'document', label: 'Document',   icon: FileText,  color: 'text-amber-600' },
];

const typeFor = (v) => ITEM_TYPES.find((t) => t.value === v) || ITEM_TYPES[0];

const mediaNodeType = { audio: 'sendAudio', image: 'sendImage', video: 'sendVideo', document: 'sendDocument' };

function emptyItem() {
  return { type: 'text', content: '', url: '' };
}

export default function QuickReplies() {
  const [replies, setReplies] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | { id, ... }
  const [sendingId, setSendingId] = useState(null);
  const [sendPhone, setSendPhone] = useState('');

  const load = () => api.quickReplies.list().then(setReplies);

  useEffect(() => { load(); }, []);

  const openNew = () => setEditing({ id: null, name: '', trigger_code: '', items: [emptyItem()] });
  const openEdit = (r) => setEditing({ ...r, trigger_code: r.trigger_code || '', items: r.items?.length ? r.items : [emptyItem()] });
  const closeEdit = () => setEditing(null);

  const save = async () => {
    const { id, name, trigger_code, items } = editing;
    if (!name.trim()) { toast.error('Name is required'); return; }
    const validItems = items.filter((it) => it.type === 'text' ? it.content?.trim() : it.url?.trim());
    if (!validItems.length) { toast.error('Add at least one item with content'); return; }
    try {
      const payload = {
        name: name.trim(),
        trigger_code: trigger_code.trim() || null,
        items: validItems.map((it, i) => ({ ...it, sort_order: i })),
      };
      if (id) {
        await api.quickReplies.update(id, payload);
        toast.success('Quick reply updated');
      } else {
        await api.quickReplies.create(payload);
        toast.success('Quick reply created');
      }
      closeEdit();
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this quick reply?')) return;
    await api.quickReplies.remove(id);
    load();
  };

  const handleSend = async (id) => {
    if (!sendPhone.trim()) { toast.error('Enter a phone number'); return; }
    try {
      const r = await api.quickReplies.send(id, sendPhone.trim());
      toast.success(`Sent ${r.sent} item${r.sent === 1 ? '' : 's'}`);
      setSendingId(null);
      setSendPhone('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Item editor helpers
  const setItem = (idx, patch) => {
    setEditing((prev) => {
      const items = prev.items.slice();
      items[idx] = { ...items[idx], ...patch };
      return { ...prev, items };
    });
  };
  const addItem = () => setEditing((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const removeItem = (idx) => setEditing((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  const moveItem = (idx, dir) => {
    setEditing((prev) => {
      const items = prev.items.slice();
      const to = idx + dir;
      if (to < 0 || to >= items.length) return prev;
      [items[idx], items[to]] = [items[to], items[idx]];
      return { ...prev, items };
    });
  };

  return (
    <div className="min-h-full bg-paper-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-paper-50 border-b border-ink/10 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="eyebrow mb-0.5">Quick Replies</div>
          <h1 className="font-display text-2xl tracking-tightest leading-none">FAQ Library</h1>
        </div>
        <button onClick={openNew} className="btn btn-sm">
          <Plus size={13} /> New reply
        </button>
      </div>

      <div className="px-6 py-6 max-w-2xl mx-auto space-y-3">
        {replies.length === 0 && !editing && (
          <div className="surface px-8 py-16 text-center">
            <Zap size={32} className="mx-auto text-ink-faint mb-3" />
            <div className="font-display text-2xl tracking-tightest text-ink-mute mb-1">No quick replies yet</div>
            <div className="text-[12.5px] text-ink-mute mb-4">
              Create bundles of voice notes, images and text for your FAQs.
            </div>
            <button onClick={openNew} className="btn btn-sm">
              <Plus size={13} /> Create first reply
            </button>
          </div>
        )}

        {replies.map((r) => (
          <div key={r.id} className="surface">
            {/* Card header */}
            <div className="px-5 py-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-[18px] tracking-tight2 text-ink">{r.name}</span>
                  {r.trigger_code && (
                    <span className="num text-[11px] bg-ink text-paper-50 px-2 py-0.5 rounded-sm">
                      ⚡ {r.trigger_code}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {(r.items || []).map((it, i) => {
                    const T = typeFor(it.type);
                    return (
                      <span key={i} className={clsx('flex items-center gap-1 text-[11px]', T.color)}>
                        <T.icon size={11} />
                        <span className="text-ink-mute">{T.label}</span>
                      </span>
                    );
                  })}
                  {!r.items?.length && <span className="text-[11px] text-ink-faint italic">no items</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setSendingId(sendingId === r.id ? null : r.id)}
                  className="btn-ghost btn-sm"
                  title="Send to a number"
                >
                  <Send size={12} />
                </button>
                <button onClick={() => openEdit(r)} className="btn-ghost btn-sm" title="Edit">
                  <Edit2 size={12} />
                </button>
                <button onClick={() => remove(r.id)} className="btn-ghost btn-sm text-stamp-vermillion hover:bg-stamp-vermillion/10" title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* Quick send panel */}
            {sendingId === r.id && (
              <div className="px-5 pb-4 flex gap-2 border-t border-ink/10 pt-3">
                <input
                  className="input flex-1 text-[13px]"
                  placeholder="Phone number (e.g. 60123456789)"
                  value={sendPhone}
                  onChange={(e) => setSendPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend(r.id)}
                  autoFocus
                />
                <button className="btn btn-sm" onClick={() => handleSend(r.id)}>
                  <Send size={12} /> Send
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setSendingId(null)}>
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Editor */}
        {editing && (
          <div className="surface border-2 border-ink/20">
            <div className="px-5 py-4 border-b border-ink/10 flex items-center justify-between">
              <h2 className="font-display text-xl tracking-tight2">
                {editing.id ? 'Edit reply' : 'New quick reply'}
              </h2>
              <button onClick={closeEdit} className="btn-ghost btn-sm"><X size={13} /></button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Name + trigger code */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="eyebrow-ink mb-1.5 block">Name</label>
                  <input
                    className="input"
                    placeholder="e.g. Fire Risk FAQ"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="eyebrow-ink mb-1.5 block">Trigger code</label>
                  <input
                    className="input num"
                    placeholder="e.g. 1"
                    value={editing.trigger_code}
                    onChange={(e) => setEditing({ ...editing, trigger_code: e.target.value.slice(0, 5) })}
                  />
                  <p className="text-[11px] text-ink-mute mt-1">
                    Type this in WhatsApp → auto-sends. Single digit recommended.
                  </p>
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="eyebrow-ink">Items <span className="text-ink-faint font-normal">(sent in order)</span></label>
                  <button onClick={addItem} className="btn-ghost btn-sm"><Plus size={11} /> add</button>
                </div>
                <div className="space-y-3">
                  {editing.items.map((item, idx) => {
                    const T = typeFor(item.type);
                    return (
                      <div key={idx} className="border border-ink/15 bg-paper-50">
                        {/* Item toolbar */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-ink/10 bg-paper-100">
                          <GripVertical size={13} className="text-ink-faint" />
                          {/* Type selector */}
                          <div className="flex items-center gap-1 flex-1 flex-wrap">
                            {ITEM_TYPES.map((t) => (
                              <button
                                key={t.value}
                                onClick={() => setItem(idx, { type: t.value, content: '', url: '' })}
                                className={clsx(
                                  'flex items-center gap-1 px-2 py-0.5 text-[10.5px] border transition-colors',
                                  item.type === t.value
                                    ? 'bg-ink text-paper-50 border-ink'
                                    : 'border-ink/15 text-ink-soft hover:bg-ink/5'
                                )}
                              >
                                <t.icon size={10} />
                                {t.label}
                              </button>
                            ))}
                          </div>
                          {/* Move up/down + delete */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="btn-ghost btn-sm p-0.5 disabled:opacity-30">
                              <ChevronUp size={12} />
                            </button>
                            <button onClick={() => moveItem(idx, 1)} disabled={idx === editing.items.length - 1} className="btn-ghost btn-sm p-0.5 disabled:opacity-30">
                              <ChevronDown size={12} />
                            </button>
                            <button onClick={() => removeItem(idx)} className="btn-ghost btn-sm p-0.5 text-stamp-vermillion hover:bg-stamp-vermillion/10">
                              <X size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Item content */}
                        <div className="p-3">
                          {item.type === 'text' ? (
                            <textarea
                              className="w-full bg-transparent text-[13.5px] text-ink focus:outline-none min-h-[72px] resize-y"
                              placeholder="Type your message here…"
                              value={item.content}
                              onChange={(e) => setItem(idx, { content: e.target.value })}
                            />
                          ) : (
                            <MediaField
                              nodeType={mediaNodeType[item.type] || 'sendMedia'}
                              value={item.url}
                              onChange={(url) => setItem(idx, { url })}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-ink/10 flex justify-end gap-2">
              <button onClick={closeEdit} className="btn-ghost btn-sm">Cancel</button>
              <button onClick={save} className="btn btn-sm">
                <Save size={12} /> Save
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
