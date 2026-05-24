import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { runFlowForIncoming } from './flowEngine.js';

const { Client, LocalAuth, MessageMedia } = pkg;

const MEDIA_DIR = path.resolve('./data/uploads');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// mimetype → reasonable file extension
function extFor(mimetype = '') {
  const base = mimetype.split(';')[0].trim();
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'application/pdf': '.pdf',
  };
  if (map[base]) return map[base];
  const sub = base.split('/')[1] || '';
  return sub ? '.' + sub.replace(/[^a-z0-9]/gi, '').slice(0, 6) : '';
}

// Resolve a @lid / @c.us JID to a real phone number + display name, if we can.
// WhatsApp's newer LID system hides the real number; we fall back gracefully.
async function resolveContact(client, jid, fallbackPushName = '') {
  const out = { resolved_number: null, push_name: fallbackPushName || '' };
  try {
    const c = await client.getContactById(jid);
    if (c) {
      const num = c.number || (c.id && c.id.user) || null;
      if (num && /^\d+$/.test(num)) out.resolved_number = num;
      out.push_name = c.pushname || c.name || c.verifiedName || out.push_name;
    }
  } catch {}
  return out;
}

let client = null;
let currentQr = null;
let status = 'idle'; // idle | qr | authenticated | ready | disconnected
let io = null;

export function setSocketIO(instance) {
  io = instance;
}

function emit(event, data) {
  if (io) io.emit(event, data);
}

export function getStatus() {
  return { status, qr: currentQr };
}

export async function initWhatsApp() {
  if (client) return client;

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: process.env.SESSION_NAME || 'chatmamba-default',
      dataPath: './data/wa-session',
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',      // prevents Chromium crash on VPS (limited /dev/shm)
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', async (qr) => {
    status = 'qr';
    currentQr = await qrcode.toDataURL(qr);
    emit('wa:status', { status, qr: currentQr });
  });

  client.on('authenticated', () => {
    status = 'authenticated';
    currentQr = null;
    emit('wa:status', { status });
  });

  client.on('ready', () => {
    status = 'ready';
    currentQr = null;
    emit('wa:status', { status });
  });

  client.on('disconnected', (reason) => {
    status = 'disconnected';
    emit('wa:status', { status, reason });
    client = null;
    currentQr = null;
    // Auto-reconnect unless the user manually logged out
    if (reason !== 'LOGOUT') {
      console.log(`[whatsapp] disconnected (${reason}), reconnecting in 15s…`);
      setTimeout(() => {
        initWhatsApp().catch(e => console.error('[whatsapp] reconnect failed:', e));
      }, 15000);
    }
  });

  // Track delivery + read acks against broadcast targets.
  // ack levels: 1 = sent to server, 2 = delivered to device, 3 = read, 4 = played
  client.on('message_ack', (msg, ack) => {
    try {
      const wid = msg?.id?._serialized;
      if (!wid) return;
      const now = Date.now();
      const target = db
        .prepare('SELECT id, broadcast_id, delivered_at, read_at FROM broadcast_targets WHERE message_id = ?')
        .get(wid);
      if (!target) return;
      let changed = false;
      if (ack >= 2 && !target.delivered_at) {
        db.prepare('UPDATE broadcast_targets SET delivered_at = ? WHERE id = ?').run(now, target.id);
        changed = true;
      }
      if (ack >= 3 && !target.read_at) {
        db.prepare('UPDATE broadcast_targets SET read_at = ? WHERE id = ?').run(now, target.id);
        changed = true;
      }
      if (changed) emit('broadcast:progress', { id: target.broadcast_id });
    } catch (e) {
      console.error('message_ack handler error:', e);
    }
  });

  client.on('message', async (msg) => {
    try {
      if (msg.fromMe) return;
      // Keep the full JID (@c.us, @lid, @g.us) so replies route correctly
      const phone = msg.from;
      const body = msg.body || '';
      const rawPush = msg._data?.notifyName || msg.notifyName || '';

      // Group message? msg.author is the actual sender's JID inside the group.
      const isGroup = typeof phone === 'string' && phone.endsWith('@g.us');
      let authorJid = null;
      let authorName = '';
      let contactPushName = rawPush; // for 1:1: use sender's name; overridden below for groups
      if (isGroup) {
        authorJid = msg.author || msg._data?.author || null;
        // rawPush is the SENDER's name — use it for author_name in the message record
        authorName = rawPush;
        if (authorJid && !authorName) {
          try {
            const c = await client.getContactById(authorJid);
            authorName = c?.pushname || c?.name || c?.verifiedName || '';
          } catch {}
        }
        // For the CONTACT record we want the GROUP name, not the sender's name
        try {
          const chat = await msg.getChat();
          contactPushName = chat.name || '';
        } catch {}
      }

      // Download media to disk if present
      let mediaUrl = null;
      let mimetype = null;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media && media.data) {
            mimetype = media.mimetype || null;
            const filename = `${nanoid()}${extFor(mimetype)}`;
            const filePath = path.join(MEDIA_DIR, filename);
            fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
            mediaUrl = `/uploads/${filename}`;
          }
        } catch (e) {
          console.error('media download failed:', e.message);
        }
      }

      const msgId = nanoid();
      db.prepare(
        `INSERT INTO messages
           (id, direction, phone, body, media_type, media_url, mimetype, author_jid, author_name, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(
        msgId,
        'in',
        phone,
        body,
        msg.hasMedia ? msg.type : null,
        mediaUrl,
        mimetype,
        authorJid,
        authorName,
        Date.now()
      );

      // upsert contact + try to resolve real identity (@lid → real number)
      // Groups don't have a real phone number to resolve — use group name directly.
      const digitsOnly = String(phone).replace(/[^\d]/g, '');
      const existing = db.prepare('SELECT id, push_name, resolved_number FROM contacts WHERE phone = ?').get(digitsOnly);
      const needsResolve = !isGroup && (!existing?.resolved_number || !existing?.push_name);
      const resolved = needsResolve
        ? await resolveContact(client, phone, contactPushName)
        : { push_name: contactPushName, resolved_number: null };

      if (existing) {
        db.prepare(
          `UPDATE contacts SET
             last_activity = ?,
             jid = ?,
             push_name = COALESCE(NULLIF(?, ''), push_name),
             resolved_number = COALESCE(?, resolved_number)
           WHERE id = ?`
        ).run(Date.now(), phone, resolved.push_name || '', resolved.resolved_number, existing.id);
      } else {
        try {
          db.prepare(
            `INSERT INTO contacts
             (id, name, phone, jid, push_name, resolved_number, tags, created_at, last_activity, status)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).run(
            nanoid(),
            '',
            digitsOnly,
            phone,
            resolved.push_name || '',
            resolved.resolved_number,
            '',
            Date.now(),
            Date.now(),
            'reachable'
          );
        } catch {}
      }

      emit('wa:message', { direction: 'in', phone, body, mediaUrl, mimetype, at: Date.now() });

      // Mark any prior broadcast targets to this number as "replied"
      try {
        const replyAt = Date.now();
        const phoneVariants = [phone, digitsOnly];
        const placeholders = phoneVariants.map(() => '?').join(',');
        const updated = db
          .prepare(
            `UPDATE broadcast_targets
             SET replied_at = ?
             WHERE replied_at IS NULL
               AND status = 'sent'
               AND phone IN (${placeholders})`
          )
          .run(replyAt, ...phoneVariants);
        if (updated.changes > 0) {
          // Notify clients so the detail view refreshes reply counts live
          const ids = db
            .prepare(
              `SELECT DISTINCT broadcast_id FROM broadcast_targets
               WHERE replied_at = ? AND phone IN (${placeholders})`
            )
            .all(replyAt, ...phoneVariants);
          for (const row of ids) emit('broadcast:progress', { id: row.broadcast_id });
        }
      } catch (e) {
        console.error('reply tracking error:', e);
      }

      await runFlowForIncoming({ phone, body });
    } catch (e) {
      console.error('message handler error:', e);
    }
  });

  // Catch messages sent from the paired WhatsApp app itself — these don't
  // fire `message` (that's inbound-only) but they DO fire `message_create`
  // with fromMe=true. Skip ones that our own sendText/sendMedia already logged.
  client.on('message_create', async (msg) => {
    try {
      if (!msg.fromMe) return;
      const jid = msg.to || msg.id?.remote;
      if (!jid) return;
      const body = msg.body || '';
      const trimmedBody = body.trim();

      // De-dupe against messages we just logged from the UI (same phone, body, recent).
      const since = Date.now() - 5000;
      const dup = db
        .prepare(
          `SELECT id FROM messages WHERE direction='out' AND phone=? AND body=? AND created_at > ? LIMIT 1`
        )
        .get(jid, body, since);
      if (dup) return;

      // Quick reply trigger: body is digits optionally followed by # (e.g. "1", "2#", "13#")
      // Try exact match first, then digit-by-digit for combos like "13" → sends reply 1 + reply 3
      const triggerMatch = trimmedBody.match(/^(\d+)#?$/);
      if (triggerMatch && triggerMatch[1].length <= 10 && !msg.hasMedia) {
        const digits = triggerMatch[1];
        // Try full code first (e.g. "13" as a single trigger), then individual digits
        const exactQr = db.prepare('SELECT * FROM quick_replies WHERE trigger_code = ?').get(digits);
        const codesToTry = exactQr ? [digits] : [...new Set(digits.split(''))];
        let triggered = false;
        for (const code of codesToTry) {
          const qr = exactQr && code === digits ? exactQr
            : db.prepare('SELECT * FROM quick_replies WHERE trigger_code = ?').get(code);
          if (qr) {
            triggered = true;
            const items = db
              .prepare('SELECT * FROM quick_reply_items WHERE quick_reply_id = ? ORDER BY sort_order ASC')
              .all(qr.id);
            try {
              // Show presence animation before sending
              const presenceSec = Number(qr.presence_seconds || 0);
              if (presenceSec > 0 && items.length > 0) {
                const firstType = items[0].type;
                const presenceState = firstType === 'audio' ? 'recording' : 'composing';
                await sendPresence(jid, presenceState, presenceSec * 1000);
              }
              for (const item of items) {
                if (item.type === 'text') {
                  await sendText(jid, item.content || '');
                } else {
                  await sendMedia(jid, { url: item.url, sendAudioAsVoice: item.type === 'audio' });
                }
                if (items.length > 1) await new Promise((r) => setTimeout(r, 600));
              }
            } catch (e) {
              console.error('[quick-reply] send error:', e.message);
            }
          }
        }
        if (triggered) return; // don't log the trigger digit to the inbox
      }

      let mediaUrl = null;
      let mimetype = null;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media && media.data) {
            mimetype = media.mimetype || null;
            const filename = `${nanoid()}${extFor(mimetype)}`;
            fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.from(media.data, 'base64'));
            mediaUrl = `/uploads/${filename}`;
          }
        } catch {}
      }

      db.prepare(
        `INSERT INTO messages
           (id, direction, phone, body, media_type, media_url, mimetype, author_jid, author_name, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(
        nanoid(),
        'out',
        jid,
        body,
        msg.hasMedia ? msg.type : null,
        mediaUrl,
        mimetype,
        null,
        'You',
        Date.now()
      );

      emit('wa:message', { direction: 'out', phone: jid, body, mediaUrl, mimetype, at: Date.now() });
    } catch (e) {
      console.error('message_create handler error:', e);
    }
  });

  client.initialize();
  return client;
}

export async function logout() {
  if (!client) return;
  try {
    await client.logout();
  } catch {}
  try {
    await client.destroy();
  } catch {}
  client = null;
  status = 'idle';
  currentQr = null;
  emit('wa:status', { status });
}

function toJid(phone) {
  const s = String(phone);
  // Already a JID (e.g. "64463633952991@lid" or "6017...@c.us") — use as-is
  if (s.includes('@')) return s;
  const digits = s.replace(/[^\d]/g, '');
  return `${digits}@c.us`;
}

function isFrameError(e) {
  const msg = e?.message || '';
  return msg.includes('detached frame') || msg.includes('Target closed') || msg.includes('Session closed');
}

function triggerRestart() {
  console.error('[whatsapp] page/frame crashed — restarting client in 10s…');
  status = 'disconnected';
  client = null;
  currentQr = null;
  emit('wa:status', { status });
  setTimeout(() => {
    initWhatsApp().catch(e => console.error('[whatsapp] restart after crash failed:', e));
  }, 10000);
}

export async function sendText(phone, text) {
  if (!client || status !== 'ready') throw new Error('WhatsApp not connected');
  const jid = toJid(phone);
  let sent;
  try {
    sent = await client.sendMessage(jid, text);
  } catch (e) {
    if (isFrameError(e)) triggerRestart();
    throw e;
  }
  db.prepare(
    'INSERT INTO messages (id, direction, phone, body, media_type, created_at) VALUES (?,?,?,?,?,?)'
  ).run(nanoid(), 'out', phone, text, null, Date.now());
  emit('wa:message', { direction: 'out', phone, body: text, at: Date.now() });
  // Attach the WA message id for callers (e.g. broadcast scheduler) that want to track acks
  return { ...sent, wa_message_id: sent?.id?._serialized || null };
}

export async function resolveAllContacts() {
  if (!client || status !== 'ready') throw new Error('WhatsApp not connected');
  const rows = db
    .prepare(
      `SELECT id, phone, jid, push_name, resolved_number FROM contacts
       WHERE (jid IS NOT NULL AND jid != '')
          AND (resolved_number IS NULL OR resolved_number = '' OR push_name IS NULL OR push_name = '')`
    )
    .all();
  let updated = 0;
  for (const row of rows) {
    const r = await resolveContact(client, row.jid, row.push_name || '');
    if (r.resolved_number || r.push_name) {
      db.prepare(
        `UPDATE contacts SET
           resolved_number = COALESCE(?, resolved_number),
           push_name = COALESCE(NULLIF(?, ''), push_name)
         WHERE id = ?`
      ).run(r.resolved_number, r.push_name || '', row.id);
      updated++;
    }
  }
  return { scanned: rows.length, updated };
}

export async function sendPresence(phone, state = 'composing', ms = 1500) {
  if (!client || status !== 'ready') return;
  const jid = toJid(phone);
  try {
    const chat = await client.getChatById(jid);
    if (state === 'recording') await chat.sendStateRecording();
    else await chat.sendStateTyping();
    await new Promise((r) => setTimeout(r, Math.max(500, ms)));
    await chat.clearState();
  } catch (e) {
    // non-fatal — presence is best-effort
  }
}

export async function sendMedia(phone, { url, base64, mimetype, filename, caption, sendAudioAsVoice = false }) {
  if (!client || status !== 'ready') throw new Error('WhatsApp not connected');
  const jid = toJid(phone);
  let media;
  if (url) {
    // Handle both relative (/uploads/abc.png) and absolute
    // (http://localhost:4000/uploads/abc.png) URLs pointing at our own uploads.
    const localMatch = String(url).match(/\/uploads\/([^/?#]+)(?:\?|#|$)/);
    if (localMatch) {
      const filePath = path.resolve('./data/uploads', localMatch[1]);
      if (fs.existsSync(filePath)) {
        media = MessageMedia.fromFilePath(filePath);
      }
    }
    if (!media) {
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Media URL must be absolute (https://…) or a local upload');
      }
      media = await MessageMedia.fromUrl(url, { unsafeMime: true });
    }
  } else if (base64) {
    media = new MessageMedia(mimetype || 'application/octet-stream', base64, filename);
  } else {
    throw new Error('url or base64 required');
  }
  let sent;
  try {
    sent = await client.sendMessage(jid, media, { caption, sendAudioAsVoice });
  } catch (e) {
    if (isFrameError(e)) triggerRestart();
    throw e;
  }
  db.prepare(
    'INSERT INTO messages (id, direction, phone, body, media_type, created_at) VALUES (?,?,?,?,?,?)'
  ).run(nanoid(), 'out', phone, caption || '', mimetype || 'media', Date.now());
  emit('wa:message', { direction: 'out', phone, body: caption || '[media]', at: Date.now() });
  return { ...sent, wa_message_id: sent?.id?._serialized || null };
}
