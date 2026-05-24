import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Edit2, X, Save, Zap, Type, Mic, Image as ImageIcon,
  Video, FileText, GripVertical, ChevronDown, ChevronUp, Send, Clock,
  Search, User, Loader2, CheckCircle2,
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

// Best display name for a thread object (same priority as Inbox)
function threadName(t) {
  return t.push_name || t.contact_name || t.resolved_number ||
    (t.phone?.endsWith('@lid') ? 'Unknown contact' : (t.phone || '').replace(/@.*/, ''));
}

// Best phone display for a thread (never show raw @lid)
function threadPhone(t) {
  if (t.resolved_number) return t.resolved_number;
  if (t.phone?.endsWith('@lid')) return 'Hidden number';
  if (t.phone?.endsWith('@g.us')) return 'Group';
  return (t.phone || '').replace(/@.*/, '');
}

export default function QuickReplies() {
  const [replies, setReplies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [sendingId, setSendingId] = useState(null);
  const [sendPhone, setSendPhone] = useState('');
  const [threads, setThreads] = useState([]);
  const [threadSearch, setThreadSearch] = useState('');
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [busyPhone, setBusyPhone] = useState(null);   // phone currently being sent to
  const [donePhone, setDonePhone] = useState(null);   // phone just successfully sent (shows ✓)
  const doneTimer = useRef(null);

  const load = () => api.quickReplies.list().then(setReplies);

  useEffect(() => { load(); }, []);

  const loadThreads = useCallback(async () => {
    if (threads.length > 0) return; // already loaded
    setThreadsLoading(true);
    try {
      const data = await api.messages.threads();
      setThreads(Array.isArray(data) ? data : []);
    } catch {
      setThreads([]);
    } finally {
      setThreadsLoading(false);
    }
  }, [threads.length]);

  const openSend = (id) => {
    const opening = sendingId !== id;
    setSendingId(opening ? id : null);
    setSendPhone('');
    setThreadSearch('');
    setBusyPhone(null);
    setDonePhone(null);
    clearTimeout(doneTimer.current);
    if (opening) loadThreads();
  };

  const openNew = () => setEditing({ id: null, name: '', trigger_code: '', presence_seconds: 0, items: [emptyItem()] });
  const openEdit = (r) => setEditing({
    ...r,
    trigger_code: r.trigger_code || '',
    presence_seconds: r.presence_seconds || 0,
    items: r.items?.length ? r.items : [emptyItem()],
  });
  const closeEdit = () => setEditing(null);

  const save = async () => {
    const { id, name, trigger_code, presence_seconds, items } = editing;
    if (!name.trim()) { toast.error('Name is required'); return; }
    const validItems = items.filter((it) => it.type === 'text' ? it.content?.trim() : it.url?.trim());
    if (!validItems.length) { toast.error('Add at least one item with content'); return; }
    try {
      const payload = {
        name: name.trim(),
        trigger_code: trigger_code.trim() || null,
        presence_seconds: Number(presence_seconds) || 0,
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

  const handleSend = async (id, phone) => {
    const target = (phone || sendPhone).trim();
    if (!target) { toast.error('Select or enter a phone number'); return; }
    if (busyPhone) return; // already sending
    setBusyPhone(target);
    setDonePhone(null);
    clearTimeout(doneTimer.current);
    try {
      const r = await api.quickReplies.send(id, target);
      setBusyPhone(null);
      setDonePhone(target);
      // Show green ✓ for 1.8 s then close panel
      doneTimer.current = setTimeout(() => {
        setDonePhone(null);
        setSendingId(null);
        setSendPhone('');
      }, 1800);
    } catch (err) {
      setBusyPhone(null);
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

  // Filter threads by search — no cap, all contacts scrollable
  const filteredThreads = threads.filter((t) => {
    if (!threadSearch.trim()) return true;
    const q = threadSearch.toLowerCase();
    return (
      threadName(t).toLowerCase().includes(q) ||
      threadPhone(t).includes(q)
    );
  });

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
                  {r.presence_seconds > 0 && (
                    <span className="flex items-center gap-1 text-[11px] text-ink-mute">
                      <Clock size={10} /> {r.presence_seconds}s
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
                  onClick={() => openSend(r.id)}
                  className="btn-ghost btn-sm"
                  title="Send to a contact"
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
              <div className="px-5 pb-4 border-t border-ink/10 pt-3">
                {/* Search bar */}
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  <input
                    className="input pl-8 text-[13px] w-full"
                    placeholder="Search recent chats…"
                    value={threadSearch}
                    onChange={(e) => setThreadSearch(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Recent contacts list */}
                {threadsLoading && (
                  <div className="text-[12px] text-ink-mute py-3 text-center">Loading contacts…</div>
                )}
                {!threadsLoading && filteredThreads.length > 0 && (
                  <div className="max-h-72 overflow-y-auto border border-ink/10 rounded divide-y divide-ink/8 mb-2">
                    {filteredThreads.map((t) => {
                      const name = threadName(t);
                      const phone = threadPhone(t);
                      const isBusy = busyPhone === t.phone;
                      const isDone = donePhone === t.phone;
                      return (
                        <button
                          key={t.phone}
                          onClick={() => handleSend(r.id, t.phone)}
                          disabled={!!busyPhone}
                          className={clsx(
                            'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                            isDone ? 'bg-emerald-50' : isBusy ? 'bg-ink/5' : 'hover:bg-ink/5',
                            busyPhone && !isBusy && 'opacity-40 cursor-not-allowed',
                          )}
                        >
                          <div className={clsx(
                            'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                            isDone ? 'bg-emerald-100' : 'bg-ink/10',
                          )}>
                            {isDone
                              ? <CheckCircle2 size={14} className="text-emerald-600" />
                              : <User size={13} className="text-ink-mute" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className={clsx(
                              'text-[13px] font-medium truncate',
                              isDone ? 'text-emerald-700' : 'text-ink',
                            )}>
                              {isDone ? `Sent to ${name}` : name}
                            </div>
                            {!isDone && phone !== name && (
                              <div className="text-[11px] text-ink-mute">{phone}</div>
                            )}
                          </div>
                          <div className="shrink-0">
                            {isBusy
                              ? <Loader2 size={13} className="text-ink-mute animate-spin" />
                              : isDone
                              ? <CheckCircle2 size={13} className="text-emerald-500" />
                              : <Send size={11} className="text-ink-faint" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!threadsLoading && filteredThreads.length === 0 && threadSearch && (
                  <div className="text-[12px] text-ink-mute py-2 text-center">No matches</div>
                )}

                {/* Manual fallback */}
                <div className="flex gap-2">
                  <input
                    className="input flex-1 text-[13px]"
                    placeholder="Or type a number (e.g. 60123456789)"
                    value={sendPhone}
                    onChange={(e) => setSendPhone(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend(r.id)}
                    disabled={!!busyPhone}
                  />
                  <button
                    className="btn btn-sm min-w-[72px] justify-center"
                    onClick={() => handleSend(r.id)}
                    disabled={!!busyPhone}
                  >
                    {busyPhone && busyPhone === sendPhone.trim()
                      ? <Loader2 size={12} className="animate-spin" />
                      : <><Send size={12} /> Send</>}
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => setSendingId(null)} disabled={!!busyPhone}>
                    <X size={12} />
                  </button>
                </div>
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

              {/* Presence animation */}
              <div>
                <label className="eyebrow-ink mb-1.5 block flex items-center gap-1.5">
                  <Clock size={11} /> Typing / recording animation
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="60"
                    className="input num w-24"
                    placeholder="0"
                    value={editing.presence_seconds}
                    onChange={(e) => setEditing({ ...editing, presence_seconds: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
                  />
                  <span className="text-[13px] text-ink-mute">seconds</span>
                </div>
                <p className="text-[11px] text-ink-mute mt-1">
                  Shows "typing…" or "recording…" before sending. 0 = disabled.
                  First item is voice note → shows recording, otherwise typing.
                </p>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="eyebrow-ink">
                    Items <span className="text-ink-faint font-normal">(sent in order)</span>
                  </label>
                  <button onClick={addItem} className="btn-ghost btn-sm"><Plus size={11} /> Add item</button>
                </div>
                <div className="space-y-3">
                  {editing.items.map((item, idx) => {
                    const T = typeFor(item.type);
                    return (
                      <div key={idx} className="border border-ink/15 bg-paper-50">
                        {/* Item toolbar */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-ink/10 bg-paper-100">
                          <GripVertical size={13} className="text-ink-faint shrink-0" />

                          {/* Type dropdown */}
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <T.icon size={13} className={T.color} />
                            <select
                              className="input py-0.5 text-[12px] flex-1"
                              value={item.type}
                              onChange={(e) => setItem(idx, { type: e.target.value, content: '', url: '' })}
                            >
                              {ITEM_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </div>

                          {/* Move up/down + delete */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => moveItem(idx, -1)}
                              disabled={idx === 0}
                              className="btn-ghost btn-sm p-0.5 disabled:opacity-30"
                              title="Move up"
                            >
                              <ChevronUp size={12} />
                            </button>
                            <button
                              onClick={() => moveItem(idx, 1)}
                              disabled={idx === editing.items.length - 1}
                              className="btn-ghost btn-sm p-0.5 disabled:opacity-30"
                              title="Move down"
                            >
                              <ChevronDown size={12} />
                            </button>
                            <button
                              onClick={() => removeItem(idx)}
                              className="btn-ghost btn-sm p-0.5 text-stamp-vermillion hover:bg-stamp-vermillion/10"
                              title="Remove"
                            >
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
                <button onClick={addItem} className="btn-ghost btn-sm mt-2 w-full justify-center border border-dashed border-ink/20">
                  <Plus size={12} /> Add another item
                </button>
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
