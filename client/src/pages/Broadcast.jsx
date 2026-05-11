import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Send, Play, Pause, Trash2, Users, Image as ImageIcon, Clock, Calendar,
  X, AlarmClock, CheckCheck, Eye, MessageCircle, AlertTriangle,
  Plus, Shuffle, ChevronRight, Filter, RefreshCw, Hash, Radio,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import PageHeader from '../components/PageHeader.jsx';
import MediaField from '../components/MediaField.jsx';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';

/* ══════════════════════════════════════════════════════════════════
   formatters
   ══════════════════════════════════════════════════════════════════ */
const pad2 = (n) => String(n).padStart(2, '0');

function fmtMsShort(ms) {
  if (!ms || ms <= 0) return '0s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
function fmtMsRange(min, max) {
  if (min === max) return fmtMsShort(min);
  return `${fmtMsShort(min)}–${fmtMsShort(max)}`;
}
function fmtCountdown(ms) {
  if (!ms || ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${pad2(m)}:${pad2(sec)}`;
  return `${m}:${pad2(sec)}`;
}
function fmtClock(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function fmtRelDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const tmrw = new Date(today.getTime() + 86400_000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return `Today ${fmtClock(ts)}`;
  if (sameDay(d, tmrw))  return `Tomorrow ${fmtClock(ts)}`;
  return fmtDateTime(ts);
}
function eta(min, max, count, dailyLimit) {
  if (!count) return '—';
  const avg = (min + max) / 2;
  if (!dailyLimit || count <= dailyLimit) {
    const ms = avg * (count - 1);
    return ms < 60_000 ? `~${Math.round(ms/1000)}s` : ms < 3_600_000 ? `~${Math.round(ms/60_000)}m` : `~${(ms/3_600_000).toFixed(1)}h`;
  }
  const days = Math.ceil(count / dailyLimit);
  return `~${days}d`;
}
function shortId(id) {
  if (!id) return '----';
  return id.slice(-4).toUpperCase();
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

/* ══════════════════════════════════════════════════════════════════
   page
   ══════════════════════════════════════════════════════════════════ */
export default function Broadcast() {
  const [params] = useSearchParams();
  const presetListId = params.get('list') || '';
  const [broadcasts, setBroadcasts] = useState([]);
  const [lists, setLists] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [waStatus, setWaStatus] = useState('idle');

  const [form, setForm] = useState({
    name: '',
    messages: [''],
    image_url: '',
    list_id: presetListId,
    min_delay_ms: 600_000,
    max_delay_ms: 900_000,
    daily_limit: 30,
    resume_at: '10:00',
    phones: '',
  });

  const load = () => api.broadcasts.list().then(setBroadcasts);

  useEffect(() => {
    load();
    api.lists.list().then(setLists);
    api.whatsapp.status().then(({ status }) => setWaStatus(status));
    const refresh = () => load();
    const onWaStatus = ({ status }) => setWaStatus(status);
    socket.on('broadcast:update', refresh);
    socket.on('broadcast:progress', refresh);
    socket.on('wa:status', onWaStatus);
    const t = setInterval(load, 8000);
    return () => {
      socket.off('broadcast:update', refresh);
      socket.off('broadcast:progress', refresh);
      socket.off('wa:status', onWaStatus);
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const targetCount = useMemo(() => {
    let n = 0;
    if (form.list_id) {
      const list = lists.find((l) => l.id === form.list_id);
      n += list?.member_count || 0;
    }
    n += form.phones.split(/[\s,]+/).filter((s) => s.replace(/[^\d]/g, '').length >= 8).length;
    return n;
  }, [form.list_id, form.phones, lists]);

  const variantsCount = form.messages.filter((m) => m.trim()).length;

  const create = async (e) => {
    e.preventDefault();
    try {
      const phones = form.phones
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const [hh, mm] = (form.resume_at || '10:00').split(':').map((x) => Number(x) || 0);
      const messages = form.messages.map((s) => s.trim()).filter(Boolean).slice(0, 10);
      const { id, total } = await api.broadcasts.create({
        name: form.name || `Dispatch ${new Date().toLocaleString()}`,
        messages,
        message: messages[0] || '',
        image_url: form.image_url || null,
        list_id: form.list_id || null,
        phones,
        min_delay_ms: Number(form.min_delay_ms),
        max_delay_ms: Number(form.max_delay_ms),
        daily_limit: Number(form.daily_limit) || 0,
        resume_hour: hh,
        resume_minute: mm,
      });
      toast.success(
        `Dispatched · ${total} target${total === 1 ? '' : 's'}` +
          (messages.length > 1 ? ` · ${messages.length} variants` : '')
      );
      setForm({ ...form, name: '', messages: [''], image_url: '', phones: '' });
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const start  = async (id) => {
    if (waStatus !== 'ready') {
      toast.error('WhatsApp not connected — go to Connect page first.');
      return;
    }
    try {
      await api.broadcasts.start(id);
      toast.success('Transmission started');
    } catch (err) {
      toast.error(err.message);
    }
  };
  const pause  = async (id) => { await api.broadcasts.pause(id); };
  const remove = async (id) => {
    if (!confirm('Delete this dispatch? This cannot be undone.')) return;
    await api.broadcasts.remove(id);
    if (openId === id) setOpenId(null);
    load();
  };

  // Split for sections
  const running = broadcasts.filter((b) => b.status === 'running');
  const others  = broadcasts.filter((b) => b.status !== 'running');

  return (
    <>
      <PageHeader
        eyebrow="Section 07 · Operations"
        edition={`Edition ${todayStr().replace(/-/g, '.')}`}
        title={<>Dispatch <span className="italic font-extralight">desk</span></>}
        subtitle="Drip-style WhatsApp broadcasts. Random delays, daily quotas, per-recipient variant rotation, live delivery acks."
        actions={
          <div className="hidden md:flex items-center gap-2">
            <span className="chip">
              <Radio size={11} /> {running.length} on air
            </span>
            <span className="chip-ghost">
              <Hash size={11} /> {broadcasts.length} dispatches
            </span>
          </div>
        }
      />

      {/* On-air strip */}
      {running.length > 0 && (
        <section className="px-10 pt-2 pb-8">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="eyebrow-ink">On Air · Live Stations</h2>
            <span className="num text-[10.5px] text-ink-mute">
              tx clock {new Date(now).toLocaleTimeString()}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {running.map((b) => (
              <StationCard
                key={b.id}
                bc={b}
                now={now}
                onOpen={() => setOpenId(b.id)}
                onPause={() => pause(b.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Composer */}
      <section className="px-10 pb-12">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
          <form onSubmit={create} className="xl:col-span-7 surface relative animate-in">
            <div className="px-6 pt-5 pb-4 flex items-baseline justify-between border-b border-ink/10">
              <div>
                <div className="eyebrow mb-1">New Dispatch</div>
                <h2 className="font-display text-2xl tracking-tightest leading-none">
                  Compose transmission
                </h2>
              </div>
              <span className="num text-[10px] text-ink-mute hidden sm:block">FORM 07-A</span>
            </div>

            <Block title="Identity" num="01">
              <Field label="Dispatch name">
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. iProperty leads — week 1"
                />
              </Field>
            </Block>

            <Block title="Audience" num="02">
              <Field label="Contact list">
                <select
                  className="input"
                  value={form.list_id}
                  onChange={(e) => setForm({ ...form, list_id: e.target.value })}
                >
                  <option value="">— pick a list —</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.member_count})</option>
                  ))}
                </select>
              </Field>
              <Field label="Extra phones" hint="comma or newline separated">
                <textarea
                  className="input min-h-[58px] py-2"
                  placeholder="60123456789, 60198765432…"
                  value={form.phones}
                  onChange={(e) => setForm({ ...form, phones: e.target.value })}
                />
              </Field>
            </Block>

            <Block
              title="Variants"
              num="03"
              right={
                form.messages.length < 10 && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, messages: [...form.messages, ''] })}
                    className="btn-sm"
                  >
                    <Plus size={11} /> add variant
                  </button>
                )
              }
              hint={
                <>
                  <Shuffle size={10} className="inline -mt-px" /> Round-robin · {variantsCount}/{form.messages.length} filled · max 10 ·
                  <code className="font-mono text-[10.5px] ml-1">{`{{name}}`}</code> personalizes
                </>
              }
            >
              <div className="space-y-2.5">
                {form.messages.map((m, i) => (
                  <VariantRow
                    key={i}
                    index={i}
                    value={m}
                    canRemove={form.messages.length > 1}
                    onChange={(v) => {
                      const next = form.messages.slice();
                      next[i] = v;
                      setForm({ ...form, messages: next });
                    }}
                    onRemove={() => {
                      if (form.messages.length <= 1) {
                        setForm({ ...form, messages: [''] });
                      } else {
                        setForm({ ...form, messages: form.messages.filter((_, idx) => idx !== i) });
                      }
                    }}
                  />
                ))}
              </div>
            </Block>

            <Block title="Media" num="04">
              <Field label="Image / attachment" hint="sent as caption with each variant">
                <MediaField
                  nodeType="sendImage"
                  value={form.image_url}
                  onChange={(url) => setForm({ ...form, image_url: url })}
                />
              </Field>
            </Block>

            <Block title="Pacing" num="05">
              <DelaySlider
                label="Min delay"
                value={form.min_delay_ms}
                onChange={(v) => setForm({
                  ...form,
                  min_delay_ms: v,
                  max_delay_ms: Math.max(v, form.max_delay_ms),
                })}
              />
              <DelaySlider
                label="Max delay"
                value={form.max_delay_ms}
                onChange={(v) => setForm({
                  ...form,
                  max_delay_ms: v,
                  min_delay_ms: Math.min(v, form.min_delay_ms),
                })}
              />
              <p className="text-[12px] text-ink-soft mt-1">
                Each send waits a random interval between{' '}
                <span className="num text-ink">{fmtMsShort(form.min_delay_ms)}</span> and{' '}
                <span className="num text-ink">{fmtMsShort(form.max_delay_ms)}</span> · keeps the cadence human.
              </p>
            </Block>

            <Block title="Quota & Resume" num="06">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <Field label="Daily quota" hint="0 = no cap">
                  <div className="flex items-baseline gap-2">
                    <input
                      type="number"
                      min="0"
                      className="input num text-[20px] py-1 max-w-[100px]"
                      value={form.daily_limit}
                      onChange={(e) => setForm({ ...form, daily_limit: e.target.value })}
                    />
                    <span className="text-[12px] text-ink-mute">msg/day</span>
                  </div>
                </Field>
                <Field label="Resume at" hint="next-day pickup time after quota">
                  <div className="flex items-center gap-2">
                    <AlarmClock size={14} className="text-ink-mute" />
                    <input
                      type="time"
                      className="input num text-[16px] py-1 max-w-[120px]"
                      value={form.resume_at}
                      onChange={(e) => setForm({ ...form, resume_at: e.target.value })}
                    />
                  </div>
                </Field>
              </div>
            </Block>

            {/* Footer / submit */}
            <div className="px-6 py-4 bg-paper-100 border-t border-ink/10 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 text-[12px] text-ink-soft">
                <span className={clsx('chip-ghost', !targetCount && 'border-stamp-vermillion/40 text-stamp-vermillion')}>
                  <Users size={11} /> {targetCount}
                </span>
                <span className="chip-ghost">
                  <Clock size={11} /> ETA {eta(form.min_delay_ms, form.max_delay_ms, targetCount, Number(form.daily_limit))}
                </span>
                <span className="chip-ghost">
                  <Shuffle size={11} /> {Math.max(1, variantsCount)} var
                </span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  className="btn-stamp"
                  type="submit"
                  disabled={
                    !targetCount ||
                    (form.messages.every((m) => !m.trim()) && !form.image_url)
                  }
                  title={
                    !targetCount
                      ? 'Pick a contact list or paste extra phones'
                      : (form.messages.every((m) => !m.trim()) && !form.image_url)
                      ? 'Write at least one message variant or attach media'
                      : 'Submit dispatch'
                  }
                >
                  <Send size={13} /> Dispatch broadcast
                  <span className="num text-[10px] opacity-60">↵</span>
                </button>
                {!targetCount && (
                  <span className="text-[10.5px] text-stamp-vermillion font-mono uppercase tracking-eyebrow">
                    no targets — pick a list above
                  </span>
                )}
                {targetCount > 0 && form.messages.every((m) => !m.trim()) && !form.image_url && (
                  <span className="text-[10.5px] text-stamp-vermillion font-mono uppercase tracking-eyebrow">
                    no message — write var 1 or attach media
                  </span>
                )}
              </div>
            </div>
          </form>

          {/* Briefing aside */}
          <aside className="xl:col-span-5 space-y-6 animate-in">
            <Briefing
              variantsCount={variantsCount}
              targetCount={targetCount}
              minMs={form.min_delay_ms}
              maxMs={form.max_delay_ms}
              dailyLimit={Number(form.daily_limit) || 0}
              resumeAt={form.resume_at}
              hasMedia={!!form.image_url}
            />
            <SafetyNote />
          </aside>
        </div>
      </section>

      {/* Ledger */}
      <section className="px-10 pb-20">
        <div className="flex items-baseline justify-between mb-5">
          <div>
            <div className="eyebrow-ink mb-1">Ledger</div>
            <h2 className="font-display text-3xl tracking-tightest leading-none">
              Dispatch history
            </h2>
          </div>
          <button
            onClick={load}
            className="btn-ghost btn-sm"
            title="Refresh"
          >
            <RefreshCw size={11} /> refresh
          </button>
        </div>
        {broadcasts.length === 0 ? (
          <div className="surface px-8 py-16 text-center">
            <div className="font-display text-3xl tracking-tightest text-ink-mute mb-2">No transmissions yet.</div>
            <div className="text-[12.5px] text-ink-mute">
              Compose one above and your first dispatch will print here.
            </div>
          </div>
        ) : (
          <div className="surface overflow-hidden">
            <div className="hidden md:grid grid-cols-[64px_1.6fr_2fr_90px_90px_140px_120px] eyebrow gap-4 px-5 py-3 border-b border-ink/10 bg-paper-100">
              <div>№</div>
              <div>Name</div>
              <div>Message</div>
              <div className="text-right">Sent</div>
              <div className="text-right">Failed</div>
              <div>Status</div>
              <div className="text-right">Action</div>
            </div>
            <ul className="divide-y divide-ink/10">
              {others.concat(running).length === 0 ? null : null}
              {broadcasts.map((b, i) => (
                <LedgerRow
                  key={b.id}
                  index={i}
                  b={b}
                  now={now}
                  waReady={waStatus === 'ready'}
                  onOpen={() => setOpenId(b.id)}
                  onStart={() => start(b.id)}
                  onPause={() => pause(b.id)}
                  onRemove={() => remove(b.id)}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      {openId && (
        <DispatchTheater
          id={openId}
          now={now}
          waReady={waStatus === 'ready'}
          onClose={() => setOpenId(null)}
          onStart={start}
          onPause={pause}
          onRemove={remove}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Section block
   ══════════════════════════════════════════════════════════════════ */
function Block({ title, num, right, hint, children }) {
  return (
    <div className="px-6 py-5 border-b border-ink/10 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3 mb-3.5">
        <div className="flex items-baseline gap-3">
          <span className="num text-[10px] text-ink-mute">{num}</span>
          <h3 className="eyebrow-ink">{title}</h3>
        </div>
        {right}
      </div>
      {hint && <p className="text-[11.5px] text-ink-mute mb-3 -mt-2">{hint}</p>}
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <label className="eyebrow-ink">{label}</label>
        {hint && <span className="text-[10.5px] text-ink-mute">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Variants
   ══════════════════════════════════════════════════════════════════ */
function VariantRow({ index, value, canRemove, onChange, onRemove }) {
  return (
    <div className="border border-ink/15 bg-paper-50">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink/10 bg-paper-100">
        <span className="num text-[10px] text-ink uppercase tracking-eyebrow">var {pad2(index + 1)}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-ink-mute hover:text-stamp-vermillion transition"
            title="Remove this variant"
          >
            <X size={13} />
          </button>
        )}
      </div>
      <textarea
        className="w-full bg-transparent text-[13.5px] text-ink px-3 py-2.5 focus:outline-none min-h-[88px] resize-y"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          index === 0
            ? 'Hi {{name}}, just wanted to share a quick offer…'
            : `Variant ${index + 1} — paste a different version of the message`
        }
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Briefing aside
   ══════════════════════════════════════════════════════════════════ */
function Briefing({ variantsCount, targetCount, minMs, maxMs, dailyLimit, resumeAt, hasMedia }) {
  return (
    <div className="surface px-6 py-5">
      <div className="eyebrow mb-1">Pre-flight Briefing</div>
      <h3 className="font-display text-2xl tracking-tightest leading-none mb-4">
        What happens when you send.
      </h3>
      <div className="rule-thin mb-4" />

      <Stat label="Targets"     value={String(targetCount)} unit={targetCount === 1 ? 'recipient' : 'recipients'} />
      <Stat label="Variants"    value={String(Math.max(1, variantsCount))} unit={variantsCount > 1 ? `cycling 1→${variantsCount}` : 'single'} />
      <Stat label="Cadence"     value={fmtMsRange(minMs, maxMs)} unit="randomized between sends" />
      <Stat label="Daily quota" value={dailyLimit ? String(dailyLimit) : '∞'} unit={dailyLimit ? 'msg/day' : 'no cap'} />
      <Stat label="Resume"      value={resumeAt} unit={dailyLimit ? 'next day' : 'n/a'} />
      <Stat label="Media"       value={hasMedia ? 'attached' : '—'} unit={hasMedia ? 'sent as caption' : ''} />
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-ink/5 last:border-b-0">
      <span className="eyebrow">{label}</span>
      <div className="text-right">
        <span className="font-display text-xl tracking-tight2 text-ink">{value}</span>
        {unit && <span className="text-[11px] text-ink-mute ml-2 num">{unit}</span>}
      </div>
    </div>
  );
}

function SafetyNote() {
  return (
    <div className="border border-dashed border-ink/20 px-5 py-4 bg-paper-50/40">
      <div className="eyebrow mb-1.5">Notes from the desk</div>
      <ul className="text-[12px] text-ink-soft leading-relaxed space-y-1.5">
        <li><span className="text-ink-faint mr-1.5">—</span>Vary your message body — identical text is the #1 trigger for spam classifiers.</li>
        <li><span className="text-ink-faint mr-1.5">—</span>For new numbers, keep daily volume under 30 to non-contacts.</li>
        <li><span className="text-ink-faint mr-1.5">—</span>If a target fails, the scheduler retries up to 3 times before giving up.</li>
        <li><span className="text-ink-faint mr-1.5">—</span>Replies, delivered &amp; read receipts update live in the detail view.</li>
      </ul>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   On-air station card
   ══════════════════════════════════════════════════════════════════ */
function StationCard({ bc, now, onOpen, onPause }) {
  const pct = bc.total ? Math.round((bc.sent / bc.total) * 100) : 0;
  const dailyDone = bc.last_dispatch_date === todayStr() ? bc.daily_sent : 0;
  const pausedToday = bc.daily_limit > 0 && dailyDone >= bc.daily_limit;
  let countdown = '0:00', label = 'transmitting';
  if ((bc.paused_until || 0) > now) {
    countdown = '—';
    label = `resumes ${fmtRelDay(bc.paused_until)}`;
  } else if (bc.next_due_at) {
    countdown = fmtCountdown(Math.max(0, bc.next_due_at - now));
  }

  return (
    <article
      className="surface relative group overflow-hidden cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-deep"
      onClick={onOpen}
    >
      <div className="px-5 pt-5 pb-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="num text-[10px] text-ink-mute mb-1">№ {shortId(bc.id)}</div>
          <h3 className="font-display text-xl leading-tight tracking-tight2 truncate">{bc.name}</h3>
          <p className="text-[12px] text-ink-soft line-clamp-1 mt-0.5">{bc.message}</p>
        </div>
        <span className={pausedToday ? 'chip-ochre' : 'chip-brand'}>
          <span className="size-1.5 rounded-full bg-current animate-pulse-soft" />
          {pausedToday ? 'quota hit' : 'live'}
        </span>
      </div>
      <div className="rule-thin mx-5" />
      <div className="px-5 py-4 flex items-end gap-4">
        <div className="flex-1">
          <div className="eyebrow mb-1">{label}</div>
          <div className="font-display tabular-nums tracking-tightest text-[44px] leading-[0.9] text-ink">
            {countdown}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="num text-[20px] text-ink leading-none">
            {bc.sent}<span className="text-ink-mute">/{bc.total}</span>
          </div>
          <div className="eyebrow mt-1">sent</div>
        </div>
      </div>
      <div className="h-px bg-ink/10 relative">
        <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="px-5 pt-3 pb-4 flex items-center justify-between text-[11px] text-ink-mute">
        <span className="num">
          {bc.daily_limit > 0 ? `today ${dailyDone}/${bc.daily_limit}` : 'no daily cap'} · {fmtMsRange(bc.min_delay_ms, bc.max_delay_ms)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onPause(); }}
          className="btn-ghost btn-sm"
        >
          <Pause size={11} /> pause
        </button>
      </div>
    </article>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Ledger row
   ══════════════════════════════════════════════════════════════════ */
function LedgerRow({ index, b, now, waReady, onOpen, onStart, onPause, onRemove }) {
  const pct = b.total ? Math.round((b.sent / b.total) * 100) : 0;
  const dailyDone = b.last_dispatch_date === todayStr() ? b.daily_sent : 0;
  const pausedToday = b.daily_limit > 0 && dailyDone >= b.daily_limit && b.status === 'running';

  let nextLine = '';
  if (b.status === 'running') {
    if ((b.paused_until || 0) > now) nextLine = `resumes ${fmtRelDay(b.paused_until)}`;
    else if (b.next_due_at) nextLine = `next ${fmtCountdown(Math.max(0, b.next_due_at - now))}`;
  }

  const stop = (e) => e.stopPropagation();

  return (
    <li
      onClick={onOpen}
      className="group grid md:grid-cols-[64px_1.6fr_2fr_90px_90px_140px_120px] grid-cols-1 gap-4 px-5 py-4 cursor-pointer hover:bg-ink/[0.02] items-center"
    >
      <div className="num text-[11px] text-ink-mute">{String(index + 1).padStart(3, '0')}</div>

      <div>
        <div className="font-display text-[17px] tracking-tight2 text-ink truncate">
          {b.name}
          <ChevronRight size={13} className="inline -mt-px ml-0.5 text-ink-faint group-hover:translate-x-0.5 transition-transform" />
        </div>
        <div className="num text-[10px] text-ink-mute mt-0.5">№ {shortId(b.id)} · {fmtRelDay(b.created_at)}</div>
      </div>

      <div className="text-[12.5px] text-ink-soft line-clamp-1 leading-snug">
        <span className="opacity-90">{b.message || <em className="text-ink-mute">(no body — media only)</em>}</span>
        {nextLine && (
          <span className="block num text-[11px] text-ink-mute mt-0.5">{nextLine}</span>
        )}
      </div>

      <div className="text-right">
        <div className="num text-[15px] text-ink">{b.sent}<span className="text-ink-mute">/{b.total}</span></div>
        <div className="h-[2px] bg-ink/10 mt-1">
          <div className="h-full bg-ink" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="text-right num text-[13px]">
        {b.failed ? <span className="text-stamp-vermillion">{b.failed}</span> : <span className="text-ink-faint">0</span>}
      </div>

      <div>
        <StatusStamp status={b.status} pausedToday={pausedToday} />
        {b.daily_limit > 0 && b.status === 'running' && (
          <div className="num text-[10px] text-ink-mute mt-1.5">today {dailyDone}/{b.daily_limit}</div>
        )}
      </div>

      <div className="flex items-center justify-end gap-1">
        {b.status !== 'running' && b.status !== 'done' && (
          <button
            onClick={(e) => { stop(e); onStart(); }}
            className={clsx('btn-icon-sm', waReady ? 'btn' : 'btn opacity-40 cursor-not-allowed')}
            title={waReady ? 'Start' : 'WhatsApp not connected'}
          >
            <Play size={12} />
          </button>
        )}
        {b.status === 'running' && (
          <button onClick={(e) => { stop(e); onPause(); }} className="btn-icon-sm btn" title="Pause">
            <Pause size={12} />
          </button>
        )}
        <button onClick={(e) => { stop(e); onRemove(); }} className="btn-icon-sm btn-danger" title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </li>
  );
}

function StatusStamp({ status, pausedToday }) {
  if (pausedToday) return <span className="chip-ochre">quota hit</span>;
  if (status === 'running') return <span className="chip-brand"><span className="size-1.5 rounded-full bg-current animate-pulse-soft" /> live</span>;
  if (status === 'done')    return <span className="chip-ink">complete</span>;
  if (status === 'paused')  return <span className="chip-ochre">paused</span>;
  return <span className="chip-ghost">{status || 'draft'}</span>;
}

/* ══════════════════════════════════════════════════════════════════
   Detail "theater"
   ══════════════════════════════════════════════════════════════════ */
function DispatchTheater({ id, now, waReady, onClose, onStart, onPause, onRemove }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitInput, setLimitInput] = useState('');

  const retryFailed = async () => {
    try {
      const { reset } = await api.broadcasts.retryFailed(id);
      toast.success(`${reset} failed recipient${reset === 1 ? '' : 's'} reset to pending`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveLimit = async (resumeNow = false) => {
    const val = parseInt(limitInput, 10);
    if (!val || val < 1) { toast.error('Enter a valid number'); return; }
    try {
      await api.broadcasts.update(id, { daily_limit: val, resume_now: resumeNow });
      toast.success(resumeNow
        ? `Limit updated to ${val}/day — resuming today now!`
        : `Limit updated to ${val}/day — resumes tomorrow`
      );
      setEditingLimit(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const load = async () => {
    const myReq = ++reqRef.current;
    try {
      const d = await api.broadcasts.get(id);
      if (myReq === reqRef.current) {
        setData(d);
        setLoading(false);
      }
    } catch {
      if (myReq === reqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    const refresh = (payload) => {
      if (!payload || payload.id === id) load();
    };
    socket.on('broadcast:update', refresh);
    socket.on('broadcast:progress', refresh);
    socket.on('wa:message', load);
    const t = setInterval(load, 5000);
    return () => {
      socket.off('broadcast:update', refresh);
      socket.off('broadcast:progress', refresh);
      socket.off('wa:message', load);
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Lock scroll behind theater
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const stats = data?.stats || { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
  const targets = data?.targets || [];
  const visible = useMemo(() => {
    if (filter === 'all') return targets;
    if (filter === 'replied')   return targets.filter((t) => t.replied_at);
    if (filter === 'read')      return targets.filter((t) => t.read_at);
    if (filter === 'delivered') return targets.filter((t) => t.delivered_at);
    if (filter === 'sent')      return targets.filter((t) => t.status === 'sent' && !t.delivered_at);
    if (filter === 'pending')   return targets.filter((t) => t.status === 'pending');
    if (filter === 'failed')    return targets.filter((t) => t.status === 'failed');
    return targets;
  }, [filter, targets]);

  const pct = data?.total ? Math.round((data.sent / data.total) * 100) : 0;
  const dailyDone = data?.last_dispatch_date === todayStr() ? data.daily_sent : 0;
  const pausedToday = data && data.daily_limit > 0 && dailyDone >= data.daily_limit && data.status === 'running';

  let countdown = '0:00', countdownLabel = 'idle';
  if (data) {
    if ((data.paused_until || 0) > now) {
      countdown = '—';
      countdownLabel = `resumes ${fmtRelDay(data.paused_until)}`;
    } else if (data.status === 'running' && data.next_due_at) {
      countdown = fmtCountdown(Math.max(0, data.next_due_at - now));
      countdownLabel = 'until next pulse';
    } else if (data.status === 'done')   countdownLabel = 'transmission complete';
    else if (data.status === 'paused')   countdownLabel = 'paused by operator';
    else                                 countdownLabel = 'standing by';
  }

  return (
    <div className="fixed inset-0 z-50 bg-paper-100 animate-in flex flex-col">
      {/* Theater masthead */}
      <header className="px-8 py-4 border-b border-ink/10 bg-paper-50 flex items-center gap-4">
        <button onClick={onClose} className="btn-icon-sm btn" title="Close">
          <X size={13} />
        </button>
        <div className="num text-[10.5px] text-ink-mute uppercase tracking-eyebrow">
          Dispatch № {shortId(id)} · live theater
        </div>
        <div className="flex-1" />
        {data && (
          <div className="flex items-center gap-2">
            <StatusStamp status={data.status} pausedToday={pausedToday} />
            {data.stats?.failed > 0 && data.status !== 'running' && (
              <button
                className="btn btn-sm text-stamp-vermillion border-stamp-vermillion/40 hover:bg-stamp-vermillion/10"
                onClick={retryFailed}
                title="Reset all failed recipients back to pending"
              >
                <RefreshCw size={12} /> Retry Failed ({data.stats.failed})
              </button>
            )}
            {data.status !== 'running' && data.status !== 'done' && (
              <button
                className={clsx('btn btn-sm', !waReady && 'opacity-40 cursor-not-allowed')}
                onClick={() => onStart(data.id)}
                title={waReady ? 'Start broadcast' : 'WhatsApp not connected'}
              >
                <Play size={12} /> Start
              </button>
            )}
            {data.status === 'running' && (
              <button className="btn btn-sm" onClick={() => onPause(data.id)}>
                <Pause size={12} /> Pause
              </button>
            )}
            <button className="btn-danger btn-sm" onClick={() => { onRemove(data.id); }}>
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </header>

      {loading && !data ? (
        <div className="flex-1 grid place-items-center text-ink-mute text-sm">
          <div className="text-center">
            <div className="font-display text-3xl tracking-tightest mb-1">Tuning in…</div>
            <div className="eyebrow">Reading dispatch</div>
          </div>
        </div>
      ) : !data ? (
        <div className="flex-1 grid place-items-center text-ink-mute text-sm">Not found.</div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          {/* LEFT — command */}
          <section className="lg:col-span-5 border-r border-ink/10 overflow-y-auto px-8 py-8">
            <div className="eyebrow mb-3">Dispatch · live readout</div>
            <h1 className="font-display text-[42px] leading-[0.92] tracking-tightest text-ink mb-2">
              {data.name}
            </h1>
            <p className="text-[13px] text-ink-soft line-clamp-3 leading-relaxed mb-6">
              {data.message || <em>(no message body — media only)</em>}
            </p>

            <div className="rule mb-6" />

            <div className="eyebrow mb-2">{countdownLabel}</div>
            <div className="font-display text-[88px] leading-none tracking-tightest mb-3">
              {countdown}
            </div>
            <div className="flex items-center gap-2 mb-7">
              <span className={clsx(
                'size-1.5 rounded-full',
                data.status === 'running' ? 'bg-brand-500 animate-pulse-soft' : 'bg-ink-faint'
              )} />
              <span className="num text-[10.5px] uppercase tracking-eyebrow text-ink-soft">
                {data.status} · cadence {fmtMsRange(data.min_delay_ms, data.max_delay_ms)}
              </span>
            </div>

            {/* progress */}
            <div className="mb-6">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="eyebrow">Progress</span>
                <span className="num text-[12px] text-ink">{pct}<span className="text-ink-mute">%</span></span>
              </div>
              <div className="h-px bg-ink/10">
                <div className="h-full bg-ink transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="num text-[11px] text-ink-mute mt-1.5 flex justify-between">
                <span>{data.sent}/{data.total} sent</span>
                {data.daily_limit > 0 && <span>today {dailyDone}/{data.daily_limit}</span>}
              </div>
            </div>

            {/* Daily limit editor */}
            <div className="mb-6 border border-ink/10 px-4 py-3 bg-paper-50">
              <div className="flex items-center justify-between gap-3">
                <span className="eyebrow-ink">Daily limit</span>
                {!editingLimit ? (
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[22px] tracking-tight2 text-ink">{data.daily_limit || '∞'}</span>
                    <span className="text-[11px] text-ink-mute">msg/day</span>
                    <button
                      onClick={() => { setLimitInput(String(data.daily_limit || 30)); setEditingLimit(true); }}
                      className="btn-ghost btn-sm ml-1"
                    >edit</button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 items-end">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        className="input num text-[18px] py-0.5 w-[80px]"
                        value={limitInput}
                        onChange={(e) => setLimitInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setEditingLimit(false); }}
                        autoFocus
                      />
                      <span className="text-[11px] text-ink-mute">msg/day</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => saveLimit(true)} className="btn btn-sm text-[11px]">▶ Resume today</button>
                      <button onClick={() => saveLimit(false)} className="btn-ghost btn-sm text-[11px]">⏭ Tomorrow only</button>
                      <button onClick={() => setEditingLimit(false)} className="btn-ghost btn-sm text-[11px]">cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rule mb-5" />

            {/* Stat ledger */}
            <div className="space-y-px">
              <StatLine label="Total"     value={stats.total}     icon={Users}        active={filter==='all'}       onClick={() => setFilter('all')} />
              <StatLine label="Pending"   value={stats.pending}   icon={Clock}        active={filter==='pending'}   onClick={() => setFilter('pending')} />
              <StatLine label="Sent"      value={stats.sent}      icon={Send}         active={filter==='sent'}      onClick={() => setFilter('sent')} />
              <StatLine label="Delivered" value={stats.delivered} icon={CheckCheck}   accent="brand"  active={filter==='delivered'} onClick={() => setFilter('delivered')} />
              <StatLine label="Read"      value={stats.read}      icon={Eye}          accent="azure"  active={filter==='read'}      onClick={() => setFilter('read')} />
              <StatLine label="Replied"   value={stats.replied}   icon={MessageCircle} accent="violet" active={filter==='replied'}   onClick={() => setFilter('replied')} />
              <StatLine label="Failed"    value={stats.failed}    icon={AlertTriangle} accent="vermillion" active={filter==='failed'} onClick={() => setFilter('failed')} />
            </div>
          </section>

          {/* RIGHT — recipients */}
          <section className="lg:col-span-7 overflow-y-auto bg-paper-50/40">
            <div className="px-8 py-5 border-b border-ink/10 bg-paper-50 flex items-baseline justify-between sticky top-0 z-10">
              <div>
                <div className="eyebrow mb-1">Recipients · live ledger</div>
                <h2 className="font-display text-2xl tracking-tightest leading-none">
                  {visible.length}<span className="text-ink-mute">/{targets.length}</span>
                  <span className="ml-2 text-[12px] text-ink-mute font-sans tracking-tight2 italic">
                    in {filter === 'all' ? 'view' : filter}
                  </span>
                </h2>
              </div>
              <FilterBar filter={filter} setFilter={setFilter} stats={stats} />
            </div>

            <div className="px-4 py-4 space-y-1">
              {visible.length === 0 ? (
                <div className="px-4 py-12 text-center text-ink-mute text-sm">
                  <div className="font-display text-3xl tracking-tightest mb-1">Nothing in this view.</div>
                  <div className="text-[12.5px]">Switch the filter above.</div>
                </div>
              ) : (
                visible.slice(0, 500).map((t) => <RecipientRow key={t.id} t={t} />)
              )}
              {visible.length > 500 && (
                <div className="text-[11px] text-ink-mute text-center pt-2">
                  Showing first 500 of {visible.length}.
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StatLine({ label, value, icon: Icon, accent, active, onClick }) {
  const accents = {
    brand:      'text-brand-700',
    azure:      'text-stamp-azure',
    violet:     'text-stamp-violet',
    vermillion: 'text-stamp-vermillion',
  };
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-baseline gap-3 py-2.5 px-2 -mx-2 transition-colors',
        active ? 'bg-ink text-paper-50' : 'text-ink hover:bg-ink/[0.04]'
      )}
    >
      <Icon size={13} strokeWidth={1.7} className={clsx(accent && !active && accents[accent])} />
      <span className={clsx('eyebrow', active && 'text-paper-50')}>{label}</span>
      <span className="flex-1 border-b border-dotted border-current opacity-30" />
      <span className={clsx(
        'font-display tabular-nums tracking-tight2 text-[24px] leading-none',
        accent && !active && accents[accent]
      )}>
        {value}
      </span>
    </button>
  );
}

function FilterBar({ filter, setFilter, stats }) {
  const opts = [
    { key: 'all',       label: 'all',       count: stats.total,     show: true },
    { key: 'pending',   label: 'pending',   count: stats.pending,   show: stats.pending > 0 },
    { key: 'sent',      label: 'sent',      count: stats.sent,      show: stats.sent > 0 },
    { key: 'delivered', label: 'delivered', count: stats.delivered, show: stats.delivered > 0 },
    { key: 'read',      label: 'read',      count: stats.read,      show: stats.read > 0 },
    { key: 'replied',   label: 'replied',   count: stats.replied,   show: stats.replied > 0 },
    { key: 'failed',    label: 'failed',    count: stats.failed,    show: stats.failed > 0 },
  ].filter((o) => o.show);
  return (
    <div className="hidden md:flex items-center gap-1 flex-wrap max-w-[60%] justify-end">
      <Filter size={11} className="text-ink-mute" />
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => setFilter(o.key)}
          className={clsx(
            'text-[10px] font-mono uppercase tracking-eyebrow px-2 py-1 transition-colors border',
            filter === o.key
              ? 'bg-ink text-paper-50 border-ink'
              : 'border-ink/15 text-ink-soft hover:bg-ink/5'
          )}
        >
          {o.label} <span className="opacity-60">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

function RecipientRow({ t }) {
  let status = null;
  if (t.replied_at)         status = { tone: 'violet', icon: MessageCircle, label: `replied ${fmtClock(t.replied_at)}` };
  else if (t.read_at)       status = { tone: 'azure',  icon: Eye,           label: `read ${fmtClock(t.read_at)}` };
  else if (t.delivered_at)  status = { tone: 'brand',  icon: CheckCheck,    label: `delivered ${fmtClock(t.delivered_at)}` };
  else if (t.status === 'sent')   status = { tone: 'ink',    icon: Send,         label: `sent ${fmtClock(t.sent_at)}` };
  else if (t.status === 'failed') status = { tone: 'fail',   icon: AlertTriangle, label: 'failed' };
  else status = { tone: 'ghost', icon: Clock, label: 'pending' };

  const retrying = (t.attempts || 0) > 0 && t.status === 'pending';
  const display = t.display_name || t.contact_name || '';
  const phoneOnly = String(t.phone).replace(/@.+$/, '');
  const StatusIcon = status.icon;
  const toneClass = {
    violet: 'chip-violet',
    azure: 'chip-azure',
    brand: 'chip-brand',
    ink:   'chip-ink',
    fail:  'chip-fail',
    ghost: 'chip-ghost',
  }[status.tone];

  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-2 hover:bg-ink/[0.03] transition-colors">
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 truncate">
          {display
            ? <span className="text-[13.5px] text-ink truncate">{display}</span>
            : <span className="num text-[13px] text-ink truncate">{phoneOnly}</span>
          }
          {Number.isInteger(t.variant_index) && (
            <span className="num text-[10px] text-ink-mute">v{t.variant_index + 1}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {display && <span className="num text-[10.5px] text-ink-mute">{phoneOnly}</span>}
          {retrying && (
            <span className="num text-[10px] text-stamp-ochre uppercase tracking-eyebrow">
              ↻ retry {t.attempts}/3
            </span>
          )}
          {t.error && !retrying && (
            <span className="text-[10.5px] text-stamp-vermillion truncate max-w-[260px]">{t.error}</span>
          )}
        </div>
      </div>
      <span className={clsx(toneClass, 'inline-flex items-center gap-1.5')}>
        <StatusIcon size={10} />
        {status.label}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Delay slider (editorial monoline)
   ══════════════════════════════════════════════════════════════════ */
function DelaySlider({ label, value, onChange }) {
  const minMs = 5_000;
  const maxMs = 60 * 60_000;
  const v2pos = (v) => Math.round((Math.log(v / minMs) / Math.log(maxMs / minMs)) * 100);
  const pos2v = (p) => Math.round(minMs * Math.pow(maxMs / minMs, p / 100));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="eyebrow-ink">{label}</span>
        <span className="font-display tabular-nums text-[20px] leading-none tracking-tight2 text-ink">
          {fmtMsShort(value)}
        </span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={v2pos(value)}
        onChange={(e) => onChange(pos2v(Number(e.target.value)))}
        className="editorial"
      />
      <div className="flex justify-between text-[9.5px] text-ink-mute font-mono mt-0.5">
        <span>5s</span><span>5m</span><span>1h</span>
      </div>
    </div>
  );
}
