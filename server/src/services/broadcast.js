import db from '../db.js';
import { sendText, sendMedia, getStatus } from './whatsapp.js';
import { expandTemplate } from '../lib/spintax.js';

let timer = null;
let ioRef = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayStr = () => new Date().toISOString().slice(0, 10);

function pickDelay(bc) {
  const min = Number(bc.min_delay_ms ?? bc.delay_ms ?? 600000);
  const max = Number(bc.max_delay_ms ?? bc.delay_ms ?? 900000);
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

function quotaLeft(bc) {
  const limit = Number(bc.daily_limit ?? 0);
  if (!limit) return Infinity;
  if (bc.last_dispatch_date !== todayStr()) return limit;
  return Math.max(0, limit - Number(bc.daily_sent ?? 0));
}

async function bumpDaily(id, count = 1) {
  const today = todayStr();
  const cur = await db.prepare('SELECT last_dispatch_date, daily_sent FROM broadcasts WHERE id = $1').get(id);
  if (!cur) return;
  if (cur.last_dispatch_date === today) {
    await db.prepare('UPDATE broadcasts SET daily_sent = daily_sent + $1 WHERE id = $2').run(count, id);
  } else {
    await db.prepare('UPDATE broadcasts SET daily_sent = $1, last_dispatch_date = $2 WHERE id = $3').run(
      count, today, id
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
  const vars = {
    name: target.contact_name || '',
    phone: String(target.phone || '').replace(/@.+$/, ''),
  };
  const body = expandTemplate(tpl, vars);
  if (bc.image_url || bc.media_url) {
    return sendMedia(target.phone, { url: bc.image_url || bc.media_url, caption: body });
  }
  return sendText(target.phone, body);
}

function nextResumeAt(hour = 10, minute = 0) {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(Math.max(0, Math.min(23, Number(hour) || 0)), Math.max(0, Math.min(59, Number(minute) || 0)), 0, 0);
  return +next;
}

async function tick() {
  const now = Date.now();
  const { status: waStatus } = getStatus();
  if (waStatus !== 'ready') return;

  const broadcasts = await db.prepare("SELECT * FROM broadcasts WHERE status = 'running'").all();

  for (const bc of broadcasts) {
    if ((bc.paused_until || 0) > now) continue;
    if ((bc.next_due_at || 0) > now) continue;

    const target = await db.prepare(
      `SELECT * FROM broadcast_targets
       WHERE broadcast_id = $1 AND status = 'pending'
       ORDER BY attempts ASC, created_at ASC LIMIT 1`
    ).get(bc.id);

    if (!target) {
      await db.prepare("UPDATE broadcasts SET status = 'done', paused_until = 0 WHERE id = $1").run(bc.id);
      ioRef?.emit('broadcast:update', { id: bc.id, status: 'done' });
      continue;
    }

    if (quotaLeft(bc) <= 0) {
      const resumeAt = nextResumeAt(bc.resume_hour, bc.resume_minute);
      await db.prepare('UPDATE broadcasts SET paused_until = $1 WHERE id = $2').run(resumeAt, bc.id);
      ioRef?.emit('broadcast:update', { id: bc.id, paused_until: resumeAt });
      continue;
    }

    try {
      const sent = await sendOne(bc, target);
      const waId = sent?.wa_message_id || null;
      const contact = await db.prepare(
        `SELECT COALESCE(NULLIF(name,''), NULLIF(push_name,''), '') AS display_name
         FROM contacts WHERE phone = $1 OR jid = $2 LIMIT 1`
      ).get(String(target.phone).replace(/[^\d]/g, ''), target.phone);
      await db.prepare(
        'UPDATE broadcast_targets SET status=$1, sent_at=$2, message_id=$3, contact_name=$4 WHERE id=$5'
      ).run('sent', Date.now(), waId, contact?.display_name || null, target.id);
      await db.prepare('UPDATE broadcasts SET sent = sent + 1 WHERE id = $1').run(bc.id);
      await bumpDaily(bc.id, 1);
    } catch (e) {
      const MAX_ATTEMPTS = 3;
      const errMsg = e.message || '';
      const isInfraError = errMsg.includes('WhatsApp not connected') ||
        errMsg.includes('detached frame') ||
        errMsg.includes('Target closed') ||
        errMsg.includes('Session closed');
      if (isInfraError) {
        await db.prepare('UPDATE broadcast_targets SET error=$1 WHERE id=$2').run(errMsg, target.id);
      } else {
        const attempts = (target.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await db.prepare(
            'UPDATE broadcast_targets SET status=$1, error=$2, attempts=$3 WHERE id=$4'
          ).run('failed', errMsg, attempts, target.id);
          await db.prepare('UPDATE broadcasts SET failed = failed + 1 WHERE id = $1').run(bc.id);
        } else {
          await db.prepare(
            'UPDATE broadcast_targets SET error=$1, attempts=$2 WHERE id=$3'
          ).run(errMsg, attempts, target.id);
        }
      }
    }

    const updated = await db.prepare('SELECT * FROM broadcasts WHERE id = $1').get(bc.id);
    const delay = pickDelay(updated);
    await db.prepare('UPDATE broadcasts SET next_due_at = $1 WHERE id = $2').run(Date.now() + delay, bc.id);
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

export async function startBroadcast(id, io) {
  ioRef = io;
  const today = todayStr();
  const cur = await db.prepare('SELECT last_dispatch_date FROM broadcasts WHERE id = $1').get(id);
  if (cur && cur.last_dispatch_date !== today) {
    await db.prepare('UPDATE broadcasts SET daily_sent = 0, last_dispatch_date = $1 WHERE id = $2').run(today, id);
  }
  await db.prepare('UPDATE broadcasts SET status = $1, next_due_at = $2, paused_until = 0 WHERE id = $3').run(
    'running', Date.now(), id
  );
  io?.emit('broadcast:update', { id, status: 'running' });
}

export async function pauseBroadcast(id, io) {
  await db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = $1").run(id);
  io?.emit('broadcast:update', { id, status: 'paused' });
}
