import db from '../db.js';
import { sendText, sendMedia } from './whatsapp.js';
import { expandTemplate } from '../lib/spintax.js';

let timer = null;
let ioRef = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function pickDelay(bc) {
  const min = Number(bc.min_delay_ms ?? bc.delay_ms ?? 600000);
  const max = Number(bc.max_delay_ms ?? bc.delay_ms ?? 900000);
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

function quotaLeft(bc) {
  const limit = Number(bc.daily_limit ?? 0);
  if (!limit) return Infinity;
  if (bc.last_dispatch_date !== todayStr()) return limit; // new day → quota reset
  return Math.max(0, limit - Number(bc.daily_sent ?? 0));
}

function bumpDaily(id, count = 1) {
  const today = todayStr();
  const cur = db.prepare('SELECT last_dispatch_date, daily_sent FROM broadcasts WHERE id = ?').get(id);
  if (!cur) return;
  if (cur.last_dispatch_date === today) {
    db.prepare('UPDATE broadcasts SET daily_sent = daily_sent + ? WHERE id = ?').run(count, id);
  } else {
    db.prepare('UPDATE broadcasts SET daily_sent = ?, last_dispatch_date = ? WHERE id = ?').run(
      count,
      today,
      id
    );
  }
}

function variantsFor(bc) {
  if (bc.messages_json) {
    try {
      const arr = JSON.parse(bc.messages_json);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch {}
  }
  return [bc.message || ''];
}

async function sendOne(bc, target) {
  const variants = variantsFor(bc);
  const idx = Number.isInteger(target.variant_index)
    ? ((target.variant_index % variants.length) + variants.length) % variants.length
    : 0;
  const tpl = variants[idx] || variants[0] || '';
  // Per-recipient template expansion: spintax + {{name}} from snapshotted contact_name
  const vars = {
    name: target.contact_name || '',
    phone: String(target.phone || '').replace(/@.+$/, ''),
  };
  const body = expandTemplate(tpl, vars);
  if (bc.image_url || bc.media_url) {
    return sendMedia(target.phone, {
      url: bc.image_url || bc.media_url,
      caption: body,
    });
  }
  return sendText(target.phone, body);
}

// Compute timestamp for tomorrow at hh:mm local time
function nextResumeAt(hour = 10, minute = 0) {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(Math.max(0, Math.min(23, Number(hour) || 0)), Math.max(0, Math.min(59, Number(minute) || 0)), 0, 0);
  return +next;
}

/**
 * Tick the broadcast scheduler. Runs every 10s. For each broadcast in
 * `running` status:
 *   - If we're past `next_due_at`, try to dispatch the next pending target
 *   - Respect daily_limit + last_dispatch_date (auto-pause when quota hit,
 *     auto-resume on the next calendar day)
 *   - After each send, schedule next_due_at = now + random(min..max)
 */
async function tick() {
  const now = Date.now();
  const broadcasts = db
    .prepare('SELECT * FROM broadcasts WHERE status = ?')
    .all('running');

  for (const bc of broadcasts) {
    if ((bc.paused_until || 0) > now) continue;
    if ((bc.next_due_at || 0) > now) continue;

    // Done? — check before quota so we don't set paused_until on a finished broadcast.
    // Untried targets (attempts=0) are tried first; failed-but-retryable ones come after.
    const target = db
      .prepare(
        `SELECT * FROM broadcast_targets
         WHERE broadcast_id = ? AND status = 'pending'
         ORDER BY attempts ASC, rowid ASC LIMIT 1`
      )
      .get(bc.id);

    if (!target) {
      db.prepare('UPDATE broadcasts SET status = ?, paused_until = 0 WHERE id = ?').run('done', bc.id);
      ioRef?.emit('broadcast:update', { id: bc.id, status: 'done' });
      continue;
    }

    // Daily quota check
    if (quotaLeft(bc) <= 0) {
      // Resume tomorrow at the configured hour/minute
      const resumeAt = nextResumeAt(bc.resume_hour, bc.resume_minute);
      db.prepare('UPDATE broadcasts SET paused_until = ? WHERE id = ?').run(resumeAt, bc.id);
      ioRef?.emit('broadcast:update', { id: bc.id, paused_until: resumeAt });
      continue;
    }

    try {
      const sent = await sendOne(bc, target);
      const waId = sent?.wa_message_id || null;
      // Snapshot the contact's name (if we have one) so the detail view can show it
      const contact = db
        .prepare(
          `SELECT COALESCE(NULLIF(name,''), NULLIF(push_name,''), '') AS display_name
           FROM contacts WHERE phone = ? OR jid = ? LIMIT 1`
        )
        .get(String(target.phone).replace(/[^\d]/g, ''), target.phone);
      db.prepare(
        'UPDATE broadcast_targets SET status=?, sent_at=?, message_id=?, contact_name=? WHERE id=?'
      ).run('sent', Date.now(), waId, contact?.display_name || null, target.id);
      db.prepare('UPDATE broadcasts SET sent = sent + 1 WHERE id = ?').run(bc.id);
      bumpDaily(bc.id, 1);
    } catch (e) {
      const MAX_ATTEMPTS = 3;
      const attempts = (target.attempts || 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Give up — mark terminally failed
        db.prepare(
          'UPDATE broadcast_targets SET status=?, error=?, attempts=? WHERE id=?'
        ).run('failed', e.message, attempts, target.id);
        db.prepare('UPDATE broadcasts SET failed = failed + 1 WHERE id = ?').run(bc.id);
      } else {
        // Keep pending — will retry on a future tick
        db.prepare(
          'UPDATE broadcast_targets SET error=?, attempts=? WHERE id=?'
        ).run(e.message, attempts, target.id);
      }
    }

    // Schedule next dispatch with jitter
    const updated = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(bc.id);
    const delay = pickDelay(updated);
    db.prepare('UPDATE broadcasts SET next_due_at = ? WHERE id = ?').run(Date.now() + delay, bc.id);
    ioRef?.emit('broadcast:progress', { id: bc.id, next_due_at: Date.now() + delay });
  }
}

export function startBroadcastScheduler(io) {
  ioRef = io;
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((e) => console.error('broadcast tick error:', e));
  }, 10_000);
  setTimeout(tick, 1000);
}

export function startBroadcast(id, io) {
  ioRef = io;
  // Reset daily counter if it's a new day, schedule immediate dispatch
  const today = todayStr();
  const cur = db.prepare('SELECT last_dispatch_date FROM broadcasts WHERE id = ?').get(id);
  if (cur && cur.last_dispatch_date !== today) {
    db.prepare('UPDATE broadcasts SET daily_sent = 0, last_dispatch_date = ? WHERE id = ?').run(
      today,
      id
    );
  }
  db.prepare('UPDATE broadcasts SET status = ?, next_due_at = ?, paused_until = 0 WHERE id = ?').run(
    'running',
    Date.now(),
    id
  );
  io?.emit('broadcast:update', { id, status: 'running' });
}

export function pauseBroadcast(id, io) {
  db.prepare('UPDATE broadcasts SET status = ? WHERE id = ?').run('paused', id);
  io?.emit('broadcast:update', { id, status: 'paused' });
}
