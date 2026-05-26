import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Plus, Trash2, Edit2, X, Save, Zap, Type, Mic, Image as ImageIcon,
  Video, FileText, GripVertical, ChevronDown, ChevronUp, Send, Clock,
  Search, Loader2, CheckCircle2, Settings, ChevronRight, ArrowLeft, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api } from '../lib/api.js';
import MediaField from '../components/MediaField.jsx';
import pageCache from '../lib/pageCache.js';

/* ─── constants ─────────────────────────────────────────────────────────── */
const ITEM_TYPES = [
  { value: 'text',     label: 'Text',       icon: Type,      color: 'text-ink' },
  { value: 'audio',    label: 'Voice Note', icon: Mic,       color: 'text-emerald-600' },
  { value: 'image',    label: 'Image',      icon: ImageIcon, color: 'text-sky-600' },
  { value: 'video',    label: 'Video',      icon: Video,     color: 'text-purple-600' },
  { value: 'document', label: 'Document',   icon: FileText,  color: 'text-amber-600' },
];
const typeFor = (v) => ITEM_TYPES.find((t) => t.value === v) || ITEM_TYPES[0];
const mediaNodeType = { audio: 'sendAudio', image: 'sendImage', video: 'sendVideo', document: 'sendDocument' };
const emptyItem = () => ({ type: 'text', content: '', url: '' });

/* ─── thread helpers ─────────────────────────────────────────────────────── */
function threadName(t) {
  return (
    t.push_name || t.contact_name || t.resolved_number ||
    (t.phone?.endsWith('@lid') ? 'Unknown contact' : (t.phone || '').replace(/@.*/, ''))
  );
}
function threadPhone(t) {
  if (t.resolved_number) return t.resolved_number;
  if (t.phone?.endsWith('@lid')) return 'Hidden number';
  if (t.phone?.endsWith('@g.us')) return 'Group';
  return (t.phone || '').replace(/@.*/, '');
}
function initials(str) {
  return (str || '?').split(/[\s_-]+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

/* ─── main component ─────────────────────────────────────────────────────── */
export default function QuickReplies() {
  const [replies, setReplies]           = useState(pageCache.quickReplies ?? []);
  const [repliesLoading, setRepliesLoading] = useState(!pageCache.quickReplies);
  const [mode, setMode]                 = useState('send');   // 'send' | 'manage' | 'reorder'
  const [reorderList, setReorderList]   = useState([]);       // working copy during reorder
  const [reorderSaving, setReorderSaving] = useState(false);
  const [sheetQR, setSheetQR]           = useState(null);     // QR shown in bottom sheet
  const [editing, setEditing]           = useState(null);
  const [faqSearch, setFaqSearch]       = useState('');
  const [threads, setThreads]           = useState([]);
  const [threadSearch, setThreadSearch] = useState('');
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [busyPhone, setBusyPhone]       = useState(null);
  const [donePhone, setDonePhone]       = useState(null);
  const [sendPhone, setSendPhone]       = useState('');
  const doneTimer = useRef(null);

  const load = () => {
    if (!pageCache.quickReplies) setRepliesLoading(true);
    api.quickReplies.list().then((data) => {
      pageCache.quickReplies = data;
      setReplies(data);
    }).finally(() => setRepliesLoading(false));
  };
  useEffect(() => { load(); }, []);

  const loadThreads = useCallback(async () => {
    if (threads.length > 0) return;
    setThreadsLoading(true);
    try {
      const data = await api.messages.threads();
      setThreads(Array.isArray(data) ? data : []);
    } catch { setThreads([]); }
    finally { setThreadsLoading(false); }
  }, [threads.length]);

  /* send ------------------------------------------------------------------ */
  const openSheet = (qr) => {
    setSheetQR(qr);
    setThreadSearch('');
    setBusyPhone(null);
    setDonePhone(null);
    setSendPhone('');
    clearTimeout(doneTimer.current);
    loadThreads();
  };
  const closeSheet = () => { if (!busyPhone) { setSheetQR(null); clearTimeout(doneTimer.current); } };

  const handleSend = async (qrId, phone) => {
    const target = (phone || sendPhone).trim();
    if (!target) { toast.error('Pick a contact'); return; }
    if (busyPhone) return;
    setBusyPhone(target);
    setDonePhone(null);
    clearTimeout(doneTimer.current);
    try {
      await api.quickReplies.send(qrId, target);
      setBusyPhone(null);
      setDonePhone(target);
      doneTimer.current = setTimeout(() => {
        setDonePhone(null);
        setSheetQR(null);
        setSendPhone('');
      }, 1800);
    } catch (err) {
      setBusyPhone(null);
      toast.error(err.message);
    }
  };

  /* edit ------------------------------------------------------------------ */
  const openNew  = () => setEditing({ id: null, name: '', trigger_code: '', presence_seconds: 0, items: [emptyItem()] });
  const openEdit = (r) => setEditing({ ...r, trigger_code: r.trigger_code || '', presence_seconds: r.presence_seconds || 0, items: r.items?.length ? r.items : [emptyItem()] });
  const closeEdit = () => setEditing(null);

  const save = async () => {
    const { id, name, trigger_code, presence_seconds, items } = editing;
    if (!name.trim()) { toast.error('Name required'); return; }
    const validItems = items.filter((it) => it.type === 'text' ? it.content?.trim() : it.url?.trim());
    if (!validItems.length) { toast.error('Add at least one item with content'); return; }
    try {
      const payload = {
        name: name.trim(),
        trigger_code: trigger_code.trim() || null,
        presence_seconds: Number(presence_seconds) || 0,
        items: validItems.map((it, i) => ({ ...it, sort_order: i })),
      };
      if (id) await api.quickReplies.update(id, payload);
      else await api.quickReplies.create(payload);
      toast.success(id ? 'Updated' : 'Created');
      closeEdit(); load();
    } catch (err) { toast.error(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Delete this quick reply?')) return;
    await api.quickReplies.remove(id); load();
  };

  /* reorder --------------------------------------------------------------- */
  const openReorder = () => { setReorderList([...replies]); setMode('reorder'); };
  const moveReorder = (idx, dir) => setReorderList((prev) => {
    const list = prev.slice(); const to = idx + dir;
    if (to < 0 || to >= list.length) return prev;
    [list[idx], list[to]] = [list[to], list[idx]];
    return list;
  });
  const saveReorder = async () => {
    setReorderSaving(true);
    try {
      await api.quickReplies.reorder(reorderList.map((r) => r.id));
      pageCache.quickReplies = reorderList;
      setReplies(reorderList);
      setMode('send');
      toast.success('Order saved');
    } catch (e) {
      toast.error(e.message);
    } finally { setReorderSaving(false); }
  };

  const setItem    = (idx, patch) => setEditing((p) => { const items = p.items.slice(); items[idx] = { ...items[idx], ...patch }; return { ...p, items }; });
  const addItem    = () => setEditing((p) => ({ ...p, items: [...p.items, emptyItem()] }));
  const removeItem = (idx) => setEditing((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  const moveItem   = (idx, dir) => setEditing((p) => {
    const items = p.items.slice(); const to = idx + dir;
    if (to < 0 || to >= items.length) return p;
    [items[idx], items[to]] = [items[to], items[idx]];
    return { ...p, items };
  });

  const filteredThreads = threads.filter((t) => {
    if (!threadSearch.trim()) return true;
    const q = threadSearch.toLowerCase();
    return threadName(t).toLowerCase().includes(q) || threadPhone(t).includes(q);
  });

  const filteredReplies = replies.filter((r) => {
    if (!faqSearch.trim()) return true;
    const q = faqSearch.toLowerCase();
    return r.name.toLowerCase().includes(q) || (r.trigger_code || '').includes(q);
  });

  /* ══════════════════════════════════════════════════════════════════════════
     REORDER MODE — drag FAQs up / down, tap Done to save
  ══════════════════════════════════════════════════════════════════════════ */
  if (mode === 'reorder') {
    return (
      <div className="min-h-full flex flex-col" style={{ background: '#f0f2f5' }}>
        {/* Header */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ background: '#075e54' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMode('send')}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              title="Cancel"
            >
              <X size={20} className="text-white" />
            </button>
            <div>
              <div className="font-bold text-[17px] text-white">Reorder FAQs</div>
              <div className="text-[12px] text-white/60">Use arrows to rearrange</div>
            </div>
          </div>
          <button
            onClick={saveReorder}
            disabled={reorderSaving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white font-semibold text-[14px] disabled:opacity-50"
            title="Save order"
          >
            {reorderSaving
              ? <Loader2 size={16} className="animate-spin" />
              : <Check size={16} />}
            Done
          </button>
        </div>

        {/* Reorder list */}
        <div className="flex-1 p-3 space-y-2">
          {reorderList.map((r, idx) => (
            <div
              key={r.id}
              className="w-full bg-white rounded-2xl px-4 py-4 flex items-center gap-3.5 shadow-sm"
            >
              {/* Up/Down buttons */}
              <div className="flex flex-col gap-0.5 shrink-0">
                <button
                  onClick={() => moveReorder(idx, -1)}
                  disabled={idx === 0}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-20 transition-colors"
                >
                  <ChevronUp size={18} className="text-gray-500" />
                </button>
                <button
                  onClick={() => moveReorder(idx, 1)}
                  disabled={idx === reorderList.length - 1}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 disabled:opacity-20 transition-colors"
                >
                  <ChevronDown size={18} className="text-gray-500" />
                </button>
              </div>

              {/* Trigger badge */}
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 font-bold text-[16px]"
                style={{ background: '#e9f5f1', color: '#075e54' }}
              >
                {r.trigger_code || <Zap size={20} style={{ color: '#075e54' }} />}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-800 text-[15px] truncate">{r.name}</div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {(r.items || []).map((it, i) => {
                    const T = typeFor(it.type);
                    return (
                      <span key={i} className={clsx('flex items-center gap-0.5 text-[12px]', T.color)}>
                        <T.icon size={11} />
                        <span className="text-gray-400">{T.label}</span>
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Position indicator */}
              <div className="text-[13px] font-bold shrink-0" style={{ color: '#075e54' }}>
                #{idx + 1}
              </div>
            </div>
          ))}
        </div>

        {/* Save footer */}
        <div className="sticky bottom-0 px-4 py-4 bg-white border-t border-gray-100 shadow-lg">
          <button
            onClick={saveReorder}
            disabled={reorderSaving}
            className="w-full py-3.5 rounded-2xl text-white font-semibold text-[16px] flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity"
            style={{ background: '#075e54' }}
          >
            {reorderSaving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            Save order
          </button>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SEND MODE — mobile-first big buttons
  ══════════════════════════════════════════════════════════════════════════ */
  if (mode === 'send') {
    return (
      <div className="min-h-full flex flex-col" style={{ background: '#f0f2f5' }}>
        {/* Header — WA green */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between" style={{ background: '#075e54' }}>
          <div>
            <div className="font-bold text-[17px] text-white">Quick Send</div>
            <div className="text-[12px] text-white/60">{replies.length} FAQ{replies.length !== 1 ? 's' : ''} ready</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { openNew(); setMode('manage'); }}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              title="Add new FAQ"
            >
              <Plus size={21} className="text-white" />
            </button>
            <button
              onClick={openReorder}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              title="Reorder FAQs"
            >
              <Settings size={21} className="text-white" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              className="w-full bg-white rounded-full pl-9 pr-4 py-2.5 text-[14px] shadow-sm focus:outline-none"
              placeholder="Search FAQs…"
              value={faqSearch}
              onChange={(e) => setFaqSearch(e.target.value)}
            />
          </div>
        </div>

        {/* FAQ list */}
        <div className="flex-1 p-3 space-y-2">
          {filteredReplies.length === 0 && replies.length === 0 && (
            <div className="bg-white rounded-2xl p-10 text-center mt-6 shadow-sm">
              {repliesLoading
                ? <Loader2 size={36} className="mx-auto mb-3 animate-spin text-gray-400" />
                : <Zap size={40} className="mx-auto mb-3" style={{ color: '#075e54' }} />}
              <div className="font-semibold text-gray-700 mb-1">{repliesLoading ? 'Loading…' : 'No FAQs yet'}</div>
              <div className="text-gray-400 text-sm mb-5">{repliesLoading ? '' : 'Create your first quick reply'}</div>
              <button
                onClick={() => { openNew(); setMode('manage'); }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-medium"
                style={{ background: '#075e54' }}
              >
                <Plus size={15} /> Create FAQ
              </button>
            </div>
          )}

          {filteredReplies.map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-2xl shadow-sm flex items-stretch overflow-hidden"
            >
              {/* ── Send area (tap to pick contact) ── */}
              <button
                onClick={() => openSheet(r)}
                className="flex-1 px-4 py-4 flex items-center gap-3.5 text-left active:bg-gray-50 transition-colors min-w-0"
              >
                {/* Trigger badge */}
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 font-bold text-[16px]"
                  style={{ background: '#e9f5f1', color: '#075e54' }}
                >
                  {r.trigger_code || <Zap size={20} style={{ color: '#075e54' }} />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-800 text-[15px] truncate">{r.name}</div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {(r.items || []).map((it, i) => {
                      const T = typeFor(it.type);
                      return (
                        <span key={i} className={clsx('flex items-center gap-0.5 text-[12px]', T.color)}>
                          <T.icon size={11} />
                          <span className="text-gray-400">{T.label}</span>
                        </span>
                      );
                    })}
                    {r.presence_seconds > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                        <Clock size={10} /> {r.presence_seconds}s
                      </span>
                    )}
                  </div>
                </div>

                <ChevronRight size={18} className="text-gray-300 shrink-0" />
              </button>

              {/* ── Action buttons ── */}
              <div className="flex flex-col border-l border-gray-100 shrink-0">
                <button
                  onClick={() => { openEdit(r); setMode('manage'); }}
                  className="flex-1 w-12 flex items-center justify-center hover:bg-blue-50 active:bg-blue-100 transition-colors"
                  title="Edit"
                >
                  <Edit2 size={15} className="text-blue-500" />
                </button>
                <div className="h-px bg-gray-100" />
                <button
                  onClick={() => remove(r.id)}
                  className="flex-1 w-12 flex items-center justify-center hover:bg-red-50 active:bg-red-100 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={15} className="text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Contact bottom sheet */}
        {sheetQR && (
          <ContactSheet
            qr={sheetQR}
            threads={filteredThreads}
            threadsLoading={threadsLoading}
            threadSearch={threadSearch}
            onSearchChange={setThreadSearch}
            sendPhone={sendPhone}
            onPhoneChange={setSendPhone}
            busyPhone={busyPhone}
            donePhone={donePhone}
            onSend={handleSend}
            onClose={closeSheet}
          />
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MANAGE MODE — create / edit / delete
  ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-full bg-paper-50">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-paper-50 border-b border-ink/10 px-4 py-3 flex items-center gap-3">
        <button onClick={() => { setMode('send'); closeEdit(); }} className="btn-ghost btn-sm p-1.5">
          <ArrowLeft size={16} />
        </button>
        <h1 className="font-display text-xl tracking-tightest flex-1">Manage FAQs</h1>
        <button onClick={openNew} className="btn btn-sm">
          <Plus size={13} /> New
        </button>
      </div>

      <div className="px-4 py-4 max-w-2xl mx-auto space-y-3">
        {replies.length === 0 && !editing && (
          <div className="surface px-8 py-14 text-center">
            {repliesLoading
              ? <Loader2 size={28} className="mx-auto text-ink-faint mb-3 animate-spin" />
              : <Zap size={32} className="mx-auto text-ink-faint mb-3" />}
            <div className="text-ink-mute mb-4">{repliesLoading ? 'Loading…' : 'No quick replies yet'}</div>
            {!repliesLoading && <button onClick={openNew} className="btn btn-sm"><Plus size={13} /> Create one</button>}
          </div>
        )}

        {replies.map((r) => (
          <div key={r.id} className="surface">
            <div className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-ink">{r.name}</span>
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
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {(r.items || []).map((it, i) => {
                    const T = typeFor(it.type);
                    return (
                      <span key={i} className={clsx('flex items-center gap-0.5 text-[11px]', T.color)}>
                        <T.icon size={10} /> <span className="text-ink-mute">{T.label}</span>
                      </span>
                    );
                  })}
                  {!r.items?.length && <span className="text-[11px] text-ink-faint italic">no items</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(r)} className="btn-ghost btn-sm"><Edit2 size={13} /></button>
                <button onClick={() => remove(r.id)} className="btn-ghost btn-sm text-stamp-vermillion hover:bg-stamp-vermillion/10"><Trash2 size={13} /></button>
              </div>
            </div>
          </div>
        ))}

        {/* ── Editor ── */}
        {editing && (
          <div className="surface border-2 border-ink/20">
            <div className="px-5 py-4 border-b border-ink/10 flex items-center justify-between">
              <h2 className="font-display text-xl tracking-tight2">{editing.id ? 'Edit reply' : 'New quick reply'}</h2>
              <button onClick={closeEdit} className="btn-ghost btn-sm"><X size={13} /></button>
            </div>

            <div className="px-5 py-5 space-y-5">
              {/* Name + trigger */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="eyebrow-ink mb-1.5 block">Name</label>
                  <input className="input" placeholder="e.g. Fire Risk FAQ" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
                </div>
                <div>
                  <label className="eyebrow-ink mb-1.5 block">Trigger code</label>
                  <input className="input num" placeholder="e.g. 1" value={editing.trigger_code} onChange={(e) => setEditing({ ...editing, trigger_code: e.target.value.slice(0, 5) })} />
                  <p className="text-[11px] text-ink-mute mt-1">Type this in WhatsApp → auto-sends. Single digit recommended.</p>
                </div>
              </div>

              {/* Presence animation */}
              <div>
                <label className="eyebrow-ink mb-1.5 flex items-center gap-1.5 block">
                  <Clock size={11} /> Typing / recording animation
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0" max="60"
                    className="input num w-24" placeholder="0"
                    value={editing.presence_seconds}
                    onChange={(e) => setEditing({ ...editing, presence_seconds: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
                  />
                  <span className="text-[13px] text-ink-mute">seconds (0 = off)</span>
                </div>
                <p className="text-[11px] text-ink-mute mt-1">First item is voice note → shows "recording…", otherwise "typing…"</p>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="eyebrow-ink">Items <span className="text-ink-faint font-normal">(sent in order)</span></label>
                  <button onClick={addItem} className="btn-ghost btn-sm"><Plus size={11} /> Add item</button>
                </div>
                <div className="space-y-3">
                  {editing.items.map((item, idx) => {
                    const T = typeFor(item.type);
                    return (
                      <div key={idx} className="border border-ink/15 bg-paper-50">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-ink/10 bg-paper-100">
                          <GripVertical size={13} className="text-ink-faint shrink-0" />
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <T.icon size={13} className={T.color} />
                            <select className="input py-0.5 text-[12px] flex-1" value={item.type} onChange={(e) => setItem(idx, { type: e.target.value, content: '', url: '' })}>
                              {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => moveItem(idx, -1)} disabled={idx === 0} className="btn-ghost btn-sm p-0.5 disabled:opacity-30"><ChevronUp size={12} /></button>
                            <button onClick={() => moveItem(idx, 1)} disabled={idx === editing.items.length - 1} className="btn-ghost btn-sm p-0.5 disabled:opacity-30"><ChevronDown size={12} /></button>
                            <button onClick={() => removeItem(idx)} className="btn-ghost btn-sm p-0.5 text-stamp-vermillion hover:bg-stamp-vermillion/10"><X size={12} /></button>
                          </div>
                        </div>
                        <div className="p-3">
                          {item.type === 'text' ? (
                            <textarea className="w-full bg-transparent text-[13.5px] text-ink focus:outline-none min-h-[72px] resize-y" placeholder="Type your message here…" value={item.content} onChange={(e) => setItem(idx, { content: e.target.value })} />
                          ) : (
                            <MediaField nodeType={mediaNodeType[item.type] || 'sendMedia'} value={item.url} onChange={(url) => setItem(idx, { url })} />
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
              <button onClick={save} className="btn btn-sm"><Save size={12} /> Save</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Contact bottom sheet ───────────────────────────────────────────────── */
function ContactSheet({ qr, threads, threadsLoading, threadSearch, onSearchChange, sendPhone, onPhoneChange, busyPhone, donePhone, onSend, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* sheet */}
      <div className="relative bg-white rounded-t-3xl flex flex-col shadow-2xl" style={{ maxHeight: '82vh' }}>
        {/* drag handle */}
        <div className="flex justify-center pt-3 pb-0.5">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* title */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-gray-100">
          <div>
            <div className="font-semibold text-gray-800 text-[16px]">Send to…</div>
            <div className="text-[12px] text-gray-400 mt-0.5">{qr.name}</div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <X size={17} className="text-gray-500" />
          </button>
        </div>

        {/* search */}
        <div className="px-4 py-2.5 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              className="w-full bg-gray-100 rounded-full pl-10 pr-4 py-2.5 text-[14px] focus:outline-none"
              placeholder="Search contacts…"
              value={threadSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* contacts list */}
        <div className="flex-1 overflow-y-auto">
          {threadsLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={22} className="animate-spin text-gray-300" />
            </div>
          )}

          {!threadsLoading && threads.length === 0 && (
            <div className="py-10 text-center text-gray-400 text-sm">
              {threadSearch ? 'No matches' : 'No recent chats'}
            </div>
          )}

          {!threadsLoading && threads.map((t) => {
            const name = threadName(t);
            const phone = threadPhone(t);
            const isBusy = busyPhone === t.phone;
            const isDone = donePhone === t.phone;
            return (
              <button
                key={t.phone}
                onClick={() => onSend(qr.id, t.phone)}
                disabled={!!busyPhone}
                className={clsx(
                  'w-full flex items-center gap-3.5 px-5 py-3.5 transition-colors text-left',
                  isDone ? 'bg-emerald-50' : isBusy ? 'bg-gray-50' : 'hover:bg-gray-50 active:bg-gray-100',
                  busyPhone && !isBusy && 'opacity-35 cursor-default',
                )}
              >
                {/* avatar */}
                <div
                  className={clsx(
                    'w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-semibold text-[15px] transition-colors',
                    isDone ? 'bg-emerald-100 text-emerald-700' : 'text-white',
                  )}
                  style={!isDone ? { background: '#075e54' } : undefined}
                >
                  {isDone ? <CheckCircle2 size={22} className="text-emerald-600" /> : initials(name)}
                </div>

                {/* text */}
                <div className="flex-1 min-w-0">
                  <div className={clsx('font-medium text-[15px] truncate', isDone ? 'text-emerald-700' : 'text-gray-800')}>
                    {isDone ? 'Sent!' : name}
                  </div>
                  {!isDone && phone !== name && (
                    <div className="text-[12px] text-gray-400 truncate">{phone}</div>
                  )}
                </div>

                {/* right icon */}
                <div className="shrink-0">
                  {isBusy   ? <Loader2 size={20} className="animate-spin text-gray-400" /> :
                   isDone   ? <CheckCircle2 size={20} className="text-emerald-500" /> :
                              <Send size={17} className="text-gray-300" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* manual number */}
        <div className="px-4 py-3 border-t border-gray-100 flex gap-2.5 items-center">
          <input
            className="flex-1 bg-gray-100 rounded-full px-4 py-2.5 text-[14px] focus:outline-none"
            placeholder="Or type a number (601234…)"
            value={sendPhone}
            onChange={(e) => onPhoneChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSend(qr.id)}
            disabled={!!busyPhone}
          />
          <button
            onClick={() => onSend(qr.id)}
            disabled={!sendPhone.trim() || !!busyPhone}
            className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40 shrink-0 transition-opacity"
            style={{ background: '#075e54' }}
          >
            {busyPhone === sendPhone.trim()
              ? <Loader2 size={18} className="animate-spin text-white" />
              : <Send size={18} className="text-white" />}
          </button>
        </div>

        {/* iOS safe area */}
        <div className="h-[env(safe-area-inset-bottom,0px)]" />
      </div>
    </div>
  );
}
