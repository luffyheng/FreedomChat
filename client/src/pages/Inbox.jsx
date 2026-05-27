import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Search, Info, CheckCheck, RefreshCw, FileText, Image as ImageIcon, Video, Music, Zap, X, Users, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import ContactPanel from '../components/ContactPanel.jsx';

function prettyTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Deterministic avatar color from phone/JID
const colors = [
  'bg-brand-100 text-brand-700',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-fuchsia-100 text-fuchsia-700',
];
function avatarClass(key) {
  let h = 0;
  for (let i = 0; i < (key || '').length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

// WA-Web style: each group participant gets a distinct text color for their name
const nameColors = [
  'text-red-600',
  'text-orange-600',
  'text-amber-700',
  'text-lime-700',
  'text-emerald-700',
  'text-teal-700',
  'text-cyan-700',
  'text-sky-700',
  'text-blue-700',
  'text-indigo-700',
  'text-violet-700',
  'text-purple-700',
  'text-pink-700',
  'text-rose-700',
];
function authorColor(key) {
  let h = 0;
  for (let i = 0; i < (key || '').length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return nameColors[Math.abs(h) % nameColors.length];
}

function displayName(thread) {
  return (
    thread.push_name ||
    thread.contact_name ||
    // If we managed to resolve the real phone via WA, show that
    thread.resolved_number ||
    // Otherwise fall back to the cleaned JID
    thread.phone.replace(/@.*/, '')
  );
}

function displaySub(thread) {
  if (thread.phone.endsWith('@g.us')) return 'Group chat';
  if (thread.resolved_number) return thread.resolved_number;
  if (thread.phone.endsWith('@lid')) return 'Hidden number';
  return thread.phone;
}

function mediaPreview(m) {
  if (!m.last_media_type) return null;
  const kind = m.last_media_type;
  const icon = { image: '📷', video: '🎥', ptt: '🎤', audio: '🎵', document: '📄', sticker: '🎨' }[kind] || '📎';
  return `${icon} ${kind}`;
}

function initials(str) {
  return (str || '?')
    .split(/[\s_-]+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function isGroup(thread) {
  return typeof thread.phone === 'string' && thread.phone.endsWith('@g.us');
}

export default function Inbox() {
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [activePhone, setActivePhone] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [showInfo, setShowInfo] = useState(true);
  const [showQR, setShowQR] = useState(false);
  const [quickReplies, setQuickReplies] = useState([]);
  const scrollRef = useRef(null);
  const sendingRef = useRef(new Set()); // dedup double-taps on send buttons

  const loadThreads = () => {
    setThreadsLoading(true);
    return api.messages.threads().then(setThreads).finally(() => setThreadsLoading(false));
  };
  const loadQR = () => api.quickReplies.list().then(setQuickReplies).catch(() => {});
  const loadMessages = (phone) =>
    api.messages.list(phone).then((m) => setMessages(m.slice().reverse()));

  useEffect(() => {
    loadThreads();
    loadQR();
    const onMsg = () => {
      loadThreads();
      if (activePhone) loadMessages(activePhone);
    };
    socket.on('wa:message', onMsg);
    return () => socket.off('wa:message', onMsg);
  }, [activePhone]);

  useEffect(() => {
    if (!activePhone) return;
    loadMessages(activePhone);
    api.messages.markRead(activePhone).then(loadThreads).catch(() => {});
  }, [activePhone]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, activePhone]);

  const filtered = useMemo(() => {
    if (!search) return threads;
    const q = search.toLowerCase();
    return threads.filter(
      (t) =>
        t.phone.toLowerCase().includes(q) ||
        (t.push_name || '').toLowerCase().includes(q) ||
        (t.contact_name || '').toLowerCase().includes(q) ||
        (t.last_body || '').toLowerCase().includes(q)
    );
  }, [threads, search]);

  const active = threads.find((t) => t.phone === activePhone);

  const send = (e) => {
    e.preventDefault();
    if (!activePhone || !draft.trim()) return;
    const body = draft;
    const phone = activePhone;
    const key = `txt:${phone}:${body}`;
    if (sendingRef.current.has(key)) return; // dedup double Enter
    sendingRef.current.add(key);
    // Optimistic: append message immediately + clear draft
    const tempMsg = {
      id: `temp-${Date.now()}`,
      direction: 'out',
      body,
      created_at: Date.now(),
    };
    setMessages((m) => [...m, tempMsg]);
    setDraft('');
    api.whatsapp.send(phone, body)
      .then(() => { loadThreads(); loadMessages(phone); })
      .catch((err) => {
        toast.error(err.message);
        setMessages((m) => m.filter((x) => x.id !== tempMsg.id));
      })
      .finally(() => sendingRef.current.delete(key));
  };

  const sendQuickReply = (qrId) => {
    if (!activePhone) return;
    const phone = activePhone;
    const key = `qr:${qrId}:${phone}`;
    if (sendingRef.current.has(key)) return; // dedup double-tap
    sendingRef.current.add(key);
    setShowQR(false);
    toast.success('Sending quick reply…');
    api.quickReplies.send(qrId, phone)
      .then(() => { loadThreads(); loadMessages(phone); })
      .catch((err) => toast.error(err.message))
      .finally(() => sendingRef.current.delete(key));
  };

  return (
    <div className="h-full flex bg-slate-100">
      {/* Thread list */}
      <div className="w-[340px] border-r border-slate-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="font-semibold text-slate-800">Inbox</h1>
            <button
              className="btn-ghost text-xs"
              title="Fetch real phone numbers + names from WhatsApp for contacts we haven't resolved yet"
              onClick={async () => {
                toast.loading('Resolving…', { id: 'rc' });
                try {
                  const r = await api.whatsapp.resolveContacts();
                  toast.success(`Resolved ${r.updated}/${r.scanned}`, { id: 'rc' });
                  loadThreads();
                } catch (e) {
                  toast.error(e.message, { id: 'rc' });
                }
              }}
            >
              <RefreshCw size={12} /> Resolve
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8"
              placeholder="Search or start a chat"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {threadsLoading ? (
            <div className="p-10 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
              <Loader2 size={22} className="animate-spin" />
              <span>Loading…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">No conversations yet.</div>
          ) : (
            filtered.map((t) => {
              const name = displayName(t);
              const isActive = activePhone === t.phone;
              return (
                <button
                  key={t.phone}
                  onClick={() => setActivePhone(t.phone)}
                  className={`w-full text-left px-3 py-3 border-b border-slate-100 flex items-center gap-3 hover:bg-slate-50 ${
                    isActive ? 'bg-brand-50/60' : ''
                  }`}
                >
                  {/* Avatar — group gets a special icon */}
                  {isGroup(t) ? (
                    <span className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${avatarClass(t.phone)}`}>
                      <Users size={17} />
                    </span>
                  ) : (
                    <span className={`w-10 h-10 rounded-full grid place-items-center font-semibold text-sm shrink-0 ${avatarClass(t.phone)}`}>
                      {initials(name)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-slate-800 text-sm truncate">{name}</div>
                      <div className="text-[10px] text-slate-500 shrink-0">{prettyTime(t.last_at)}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-slate-500 truncate flex items-center gap-1">
                        {t.last_direction === 'out' && <CheckCheck size={11} className="text-slate-400 shrink-0" />}
                        <span className="truncate">
                          {/* In groups show "Sender: message" */}
                          {isGroup(t) && t.last_direction === 'in' && t.last_author_name
                            ? <><span className="font-medium text-slate-600">{t.last_author_name.split(' ')[0]}:</span> {t.last_body || mediaPreview(t)}</>
                            : t.last_body || mediaPreview(t) || '(no message)'
                          }
                        </span>
                      </div>
                      {t.unread > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-600 text-white font-semibold shrink-0">
                          {t.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Chat pane */}
      <div className="flex-1 flex flex-col">
        {!active ? (
          <div className="flex-1 grid place-items-center text-slate-400">
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-slate-200 mx-auto mb-3" />
              <div className="text-sm">Select a conversation</div>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 bg-white border-b border-slate-200 flex items-center gap-3">
              <span
                className={`w-10 h-10 rounded-full grid place-items-center font-semibold text-sm ${avatarClass(active.phone)}`}
              >
                {initials(displayName(active))}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800 truncate">{displayName(active)}</div>
                <div className="text-xs text-slate-500 truncate">
                  {displaySub(active)}
                  {active.resolved_number && !active.phone?.endsWith('@lid') && (
                    <span className="ml-2 text-[10px] text-slate-400 font-mono">· {active.phone}</span>
                  )}
                </div>
              </div>
              <button
                className={`btn-ghost ${showInfo ? 'bg-slate-100' : ''}`}
                onClick={() => setShowInfo(!showInfo)}
                title="Toggle contact info"
              >
                <Info size={16} />
              </button>
            </div>
            <div
              ref={scrollRef}
              className="flex-1 overflow-auto p-6 space-y-1"
              style={{
                backgroundImage:
                  'radial-gradient(#e2e8f0 1px, transparent 1px)',
                backgroundSize: '18px 18px',
              }}
            >
              {messages.length === 0 && (
                <div className="text-center text-slate-400 text-sm py-10">No messages yet.</div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const outgoing = m.direction === 'out';
                // For groups, start a new group when author changes (so we only
                // show the author name once per streak, like WA Web).
                const isGroupChat = active.phone.endsWith('@g.us');
                const authorChanged =
                  isGroupChat &&
                  !outgoing &&
                  (!prev || prev.author_jid !== m.author_jid || prev.direction !== 'in');
                const gap =
                  !prev ||
                  prev.direction !== m.direction ||
                  m.created_at - prev.created_at > 5 * 60 * 1000 ||
                  authorChanged;
                return (
                  <div
                    key={m.id}
                    className={`flex ${outgoing ? 'justify-end' : 'justify-start'} ${gap ? 'mt-3' : 'mt-1'}`}
                  >
                    <div
                      className={`max-w-[70%] p-1.5 rounded-2xl text-sm shadow-sm ${
                        outgoing
                          ? 'bg-brand-600 text-white rounded-br-sm'
                          : 'bg-white text-slate-800 rounded-bl-sm border border-slate-200'
                      }`}
                    >
                      {/* Group chat: show sender name on the first bubble of each streak */}
                      {isGroupChat && !outgoing && authorChanged && (m.author_name || m.author_jid) && (
                        <div
                          className={`text-xs font-semibold px-1.5 pt-1 ${authorColor(m.author_jid || m.author_name)}`}
                        >
                          {m.author_name || (m.author_jid || '').replace(/@.*/, '')}
                        </div>
                      )}
                      <MessageContent msg={m} outgoing={outgoing} />
                      <div
                        className={`text-[10px] px-1.5 pb-0.5 flex items-center gap-1 justify-end ${
                          outgoing ? 'text-brand-50/80' : 'text-slate-400'
                        }`}
                      >
                        {prettyTime(m.created_at)}
                        {outgoing && <CheckCheck size={10} />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="bg-white border-t border-slate-200">
              {/* Quick reply panel */}
              {showQR && (
                <div className="px-3 pt-3 pb-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Quick Replies</span>
                    <button onClick={() => setShowQR(false)} className="text-slate-400 hover:text-slate-600">
                      <X size={13} />
                    </button>
                  </div>
                  {quickReplies.length === 0 ? (
                    <div className="text-[12px] text-slate-400 py-2">
                      No quick replies yet. <a href="/quick-replies" className="underline">Create one</a>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pb-2">
                      {quickReplies.map((qr) => (
                        <button
                          key={qr.id}
                          onClick={() => sendQuickReply(qr.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-slate-100 hover:bg-brand-50 hover:text-brand-700 border border-slate-200 hover:border-brand-300 rounded-full transition-colors"
                        >
                          {qr.trigger_code && (
                            <span className="text-[10px] bg-slate-300 text-slate-600 rounded px-1 font-mono">{qr.trigger_code}</span>
                          )}
                          {qr.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <form onSubmit={send} className="p-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowQR((v) => !v)}
                  className={`btn-ghost shrink-0 ${showQR ? 'bg-brand-50 text-brand-600' : ''}`}
                  title="Quick replies"
                >
                  <Zap size={15} />
                </button>
                <input
                  className="input flex-1"
                  placeholder="Type a message…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="btn-primary" type="submit">
                  <Send size={14} /> Send
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {/* Right info panel */}
      {active && showInfo && (
        <div className="w-[340px] hidden xl:block">
          <ContactPanel phone={active.phone} onClose={() => setShowInfo(false)} />
        </div>
      )}
    </div>
  );
}

function MessageContent({ msg, outgoing }) {
  const { body, media_url, media_type, mimetype } = msg;
  const kind = (mimetype || '').split('/')[0]; // image | video | audio | application

  if (media_url) {
    const url = media_url.startsWith('http') ? media_url : `${media_url}`;
    if (kind === 'image' || media_type === 'image' || media_type === 'sticker') {
      return (
        <div className="space-y-1">
          <img
            src={url}
            alt=""
            className="rounded-xl max-h-80 cursor-pointer"
            onClick={() => window.open(url, '_blank')}
          />
          {body && <div className="px-1.5 pt-1 whitespace-pre-wrap break-words">{body}</div>}
        </div>
      );
    }
    if (kind === 'video' || media_type === 'video') {
      return (
        <div className="space-y-1">
          <video src={url} controls className="rounded-xl max-h-80 w-full" />
          {body && <div className="px-1.5 pt-1 whitespace-pre-wrap break-words">{body}</div>}
        </div>
      );
    }
    if (kind === 'audio' || media_type === 'audio' || media_type === 'ptt') {
      return (
        <div className="p-1.5">
          <audio src={url} controls className="w-full min-w-[240px]" />
        </div>
      );
    }
    // Document / other
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center gap-2 p-2 rounded-lg ${
          outgoing ? 'bg-brand-700/40 hover:bg-brand-700/60' : 'bg-slate-100 hover:bg-slate-200'
        } transition`}
      >
        <FileText size={18} />
        <div className="text-xs truncate">
          {(url.split('/').pop() || 'Attachment').slice(0, 40)}
        </div>
      </a>
    );
  }

  return (
    <div className="px-1.5 py-1 whitespace-pre-wrap break-words">
      {body || <em className="opacity-70">[empty]</em>}
    </div>
  );
}
