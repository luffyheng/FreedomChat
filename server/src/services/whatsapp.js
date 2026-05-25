import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { runFlowForIncoming } from './flowEngine.js';
import { pauseAllSequencesForPhone, resumeAllSequencesForPhone } from '../routes/sequences.js';

const { Client, LocalAuth, MessageMedia } = pkg;

const MEDIA_DIR = path.resolve('./data/uploads');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

function extFor(mimetype = '') {
  const base = mimetype.split(';')[0].trim();
  const map = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif', 'video/mp4': '.mp4', 'video/quicktime': '.mov',
    'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
    'application/pdf': '.pdf',
  };
  if (map[base]) return map[base];
  const sub = base.split('/')[1] || '';
  return sub ? '.' + sub.replace(/[^a-z0-9]/gi, '').slice(0, 6) : '';
}

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
let status = 'idle';
let io = null;
let intentionalLogout = false; // prevents auto-reconnect when user clicks Logout

export function setSocketIO(instance) { io = instance; }
function emit(event, data) { if (io) io.emit(event, data); }
export function getStatus() { return { status, qr: currentQr }; }

// Auto-detect the Chromium/Chrome binary — checks env var first, then known paths.
// This survives mismatches between the Render env var and the actual Docker image path.
function findChromiumExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-unstable',
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.log(`[whatsapp] Using browser executable: ${p}`);
        return p;
      }
    } catch {}
  }
  console.log('[whatsapp] No browser found in known paths — letting puppeteer auto-detect');
  return undefined;
}

/** Delete stale Chromium lock files so a crashed container never blocks the next start */
function cleanChromiumLocks() {
  const sessionName = process.env.SESSION_NAME || 'freedomchat-default';
  const dirs = [
    path.resolve(`./data/wa-session/session-${sessionName}`),
    path.resolve(`./data/wa-session/.wwebjs_auth/session-${sessionName}`),
  ];
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'lockfile'];
  for (const dir of dirs) {
    for (const f of lockFiles) {
      try { fs.rmSync(path.join(dir, f), { force: true }); } catch {}
    }
    // Remove all .org.chromium.* temp lock files
    try {
      fs.readdirSync(dir)
        .filter((n) => n.startsWith('.org.chromium.') || n.startsWith('.com.google.'))
        .forEach((n) => { try { fs.rmSync(path.join(dir, n), { force: true }); } catch {} });
    } catch {}
  }
}

export async function initWhatsApp() {
  if (client) return client;

  cleanChromiumLocks();

  const executablePath = findChromiumExecutable();

  client = new Client({
    authStrategy: new LocalAuth({
      clientId: process.env.SESSION_NAME || 'freedomchat-default',
      dataPath: './data/wa-session',
    }),
    puppeteer: {
      headless: true,
      executablePath,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu',
        '--disable-extensions', '--disable-software-rasterizer',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding', '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
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
    client = null;
    currentQr = null;
    if (intentionalLogout) {
      // User clicked Logout — stay idle, don't reconnect
      status = 'idle';
      emit('wa:status', { status });
      return;
    }
    status = 'disconnected';
    emit('wa:status', { status, reason });
    console.log(`[whatsapp] disconnected (${reason}), reconnecting in 15s…`);
    setTimeout(() => {
      initWhatsApp().catch((e) => console.error('[whatsapp] reconnect failed:', e));
    }, 15000);
  });

  // Track delivery + read acks against broadcast targets
  client.on('message_ack', async (msg, ack) => {
    try {
      const wid = msg?.id?._serialized;
      if (!wid) return;
      const now = Date.now();
      const target = await db.prepare(
        'SELECT id, broadcast_id, delivered_at, read_at FROM broadcast_targets WHERE message_id = $1'
      ).get(wid);
      if (!target) return;
      let changed = false;
      if (ack >= 2 && !target.delivered_at) {
        await db.prepare('UPDATE broadcast_targets SET delivered_at = $1 WHERE id = $2').run(now, target.id);
        changed = true;
      }
      if (ack >= 3 && !target.read_at) {
        await db.prepare('UPDATE broadcast_targets SET read_at = $1 WHERE id = $2').run(now, target.id);
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
      const phone = msg.from;
      const body = msg.body || '';
      const rawPush = msg._data?.notifyName || msg.notifyName || '';

      const isGroup = typeof phone === 'string' && phone.endsWith('@g.us');
      let authorJid = null;
      let authorName = '';
      let contactPushName = rawPush;
      if (isGroup) {
        authorJid = msg.author || msg._data?.author || null;
        authorName = rawPush;
        if (authorJid && !authorName) {
          try {
            const c = await client.getContactById(authorJid);
            authorName = c?.pushname || c?.name || c?.verifiedName || '';
          } catch {}
        }
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

      await db.prepare(
        `INSERT INTO messages
           (id, direction, phone, body, media_type, media_url, mimetype, author_jid, author_name, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
      ).run(
        nanoid(), 'in', phone, body,
        msg.hasMedia ? msg.type : null,
        mediaUrl, mimetype, authorJid, authorName, Date.now()
      );

      // Upsert contact
      const digitsOnly = String(phone).replace(/[^\d]/g, '');
      const existing = await db.prepare(
        'SELECT id, push_name, resolved_number FROM contacts WHERE phone = $1'
      ).get(digitsOnly);
      const needsResolve = !isGroup && (!existing?.resolved_number || !existing?.push_name);
      const resolved = needsResolve
        ? await resolveContact(client, phone, contactPushName)
        : { push_name: contactPushName, resolved_number: null };

      if (existing) {
        await db.prepare(
          `UPDATE contacts SET
             last_activity = $1,
             jid = $2,
             push_name = COALESCE(NULLIF($3, ''), push_name),
             resolved_number = COALESCE($4, resolved_number)
           WHERE id = $5`
        ).run(Date.now(), phone, resolved.push_name || '', resolved.resolved_number, existing.id);
      } else {
        try {
          await db.prepare(
            `INSERT INTO contacts
             (id, name, phone, jid, push_name, resolved_number, tags, created_at, last_activity, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
          ).run(
            nanoid(), '', digitsOnly, phone,
            resolved.push_name || '', resolved.resolved_number,
            '', Date.now(), Date.now(), 'reachable'
          );
        } catch {}
      }

      emit('wa:message', { direction: 'in', phone, body, mediaUrl, mimetype, at: Date.now() });

      // Mark prior broadcast targets to this number as "replied"
      try {
        const replyAt = Date.now();
        const phoneVariants = [phone, digitsOnly];
        const placeholders = phoneVariants.map((_, i) => `$${i + 2}`).join(',');
        const updated = await db.prepare(
          `UPDATE broadcast_targets
           SET replied_at = $1
           WHERE replied_at IS NULL AND status = 'sent' AND phone IN (${placeholders})`
        ).run(replyAt, ...phoneVariants);
        if (updated.changes > 0) {
          const ids = await db.prepare(
            `SELECT DISTINCT broadcast_id FROM broadcast_targets
             WHERE replied_at = $1 AND phone IN (${placeholders})`
          ).all(replyAt, ...phoneVariants);
          for (const row of ids) emit('broadcast:progress', { id: row.broadcast_id });
        }
      } catch (e) {
        console.error('reply tracking error:', e);
      }

      // Auto-pause sequences if contact replies with opt-out keyword
      if (!msg.hasMedia) {
        const lower = body.trim().toLowerCase();
        if (['stop', 'unsubscribe', 'pause sending'].includes(lower)) {
          try { await pauseAllSequencesForPhone(phone); } catch {}
        } else if (['resume', 'start', 'subscribe', 'resume sending'].includes(lower)) {
          try { await resumeAllSequencesForPhone(phone); } catch {}
        }
      }

      await runFlowForIncoming({ phone, body });
    } catch (e) {
      console.error('message handler error:', e);
    }
  });

  // Catch messages sent from the paired WhatsApp app — fire `message_create` with fromMe=true
  client.on('message_create', async (msg) => {
    try {
      if (!msg.fromMe) return;
      const jid = msg.to || msg.id?.remote;
      if (!jid) return;
      const body = msg.body || '';
      const trimmedBody = body.trim();

      // De-dupe against messages we just logged from the UI
      const since = Date.now() - 5000;
      const dup = await db.prepare(
        `SELECT id FROM messages WHERE direction='out' AND phone=$1 AND body=$2 AND created_at > $3 LIMIT 1`
      ).get(jid, body, since);
      if (dup) return;

      // Sequence control keywords — type these while chatting with a contact to pause/resume
      // their follow-up sequences without opening the dashboard.
      if (!msg.hasMedia) {
        const lower = trimmedBody.toLowerCase();
        if (lower === 'pause sending' || lower === 'pause follow up' || lower === 'pause followup') {
          try {
            const result = await pauseAllSequencesForPhone(jid);
            console.log(`[whatsapp] paused ${result.paused} sequence(s) for ${jid}`);
          } catch (e) {
            console.error('[whatsapp] pause keyword error:', e.message);
          }
          return; // don't log this as a message
        }
        if (lower === 'resume sending' || lower === 'resume follow up' || lower === 'resume followup') {
          try {
            const result = await resumeAllSequencesForPhone(jid);
            console.log(`[whatsapp] resumed ${result.resumed} sequence(s) for ${jid}`);
          } catch (e) {
            console.error('[whatsapp] resume keyword error:', e.message);
          }
          return; // don't log this as a message
        }
      }

      // Quick reply trigger — only fires when YOU send a message from your phone.
      // Supports any trigger_code: keywords, symbols, English, Mandarin, digits.
      // Multi-digit shortcut: "13" fires FAQ 1 then FAQ 3 (when no exact match found).
      if (!msg.hasMedia && trimmedBody.length <= 50) {
        const sendQrItems = async (qr, targetJid) => {
          const items = await db.prepare(
            'SELECT * FROM quick_reply_items WHERE quick_reply_id = $1 ORDER BY sort_order ASC'
          ).all(qr.id);
          const presenceSec = Number(qr.presence_seconds || 0);
          if (presenceSec > 0 && items.length > 0) {
            const presenceState = items[0].type === 'audio' ? 'recording' : 'composing';
            await sendPresence(targetJid, presenceState, presenceSec * 1000);
          }
          for (const item of items) {
            if (item.type === 'text') {
              await sendText(targetJid, item.content || '');
            } else {
              await sendMedia(targetJid, { url: item.url, sendAudioAsVoice: item.type === 'audio' });
            }
            if (items.length > 1) await new Promise((r) => setTimeout(r, 600));
          }
        };

        // Step 1: exact match (any text — keyword, Mandarin, symbol, digit string)
        const exactQr = await db.prepare(
          'SELECT * FROM quick_replies WHERE trigger_code = $1'
        ).get(trimmedBody);
        if (exactQr) {
          try { await sendQrItems(exactQr, jid); } catch (e) { console.error('[quick-reply] send error:', e.message); }
          return; // don't log trigger as a message
        }

        // Step 2: multi-digit combo shortcut (e.g. "13" → send FAQ "1" then FAQ "3")
        const digitMatch = trimmedBody.match(/^(\d{2,5})$/);
        if (digitMatch) {
          const codes = [...new Set(trimmedBody.split(''))];
          let triggered = false;
          for (const code of codes) {
            const qr = await db.prepare('SELECT * FROM quick_replies WHERE trigger_code = $1').get(code);
            if (qr) {
              triggered = true;
              try { await sendQrItems(qr, jid); } catch (e) { console.error('[quick-reply] send error:', e.message); }
            }
          }
          if (triggered) return;
        }
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

      await db.prepare(
        `INSERT INTO messages
           (id, direction, phone, body, media_type, media_url, mimetype, author_jid, author_name, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
      ).run(
        nanoid(), 'out', jid, body,
        msg.hasMedia ? msg.type : null,
        mediaUrl, mimetype, null, 'You', Date.now()
      );

      emit('wa:message', { direction: 'out', phone: jid, body, mediaUrl, mimetype, at: Date.now() });
    } catch (e) {
      console.error('message_create handler error:', e);
    }
  });

  client.initialize().catch((e) => {
    const msg = e?.message || '';
    if (
      msg.includes('Execution context was destroyed') ||
      msg.includes('navigation') ||
      msg.includes('detached') ||
      msg.includes('Target closed') ||
      msg.includes('Session closed')
    ) {
      // WhatsApp navigated the page during init (normal after QR scan) — reconnect
      console.log('[whatsapp] page navigated during init, reconnecting in 10s…');
      client = null;
      status = 'disconnected';
      emit('wa:status', { status });
      setTimeout(() => initWhatsApp().catch((err) => console.error('[whatsapp] reconnect failed:', err)), 10000);
    } else {
      console.error('[whatsapp] fatal init error:', msg);
      // Let Docker restart the container
      process.exit(1);
    }
  });
  return client;
}

export async function logout() {
  if (!client) return;
  intentionalLogout = true;
  const c = client;
  client = null; // clear immediately to stop any in-flight handlers
  try { await c.logout(); } catch {}
  try { await c.destroy(); } catch {}
  intentionalLogout = false;
  status = 'idle';
  currentQr = null;
  emit('wa:status', { status });
  console.log('[whatsapp] logged out cleanly');
}

function toJid(phone) {
  const s = String(phone);
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
    initWhatsApp().catch((e) => console.error('[whatsapp] restart after crash failed:', e));
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
  await db.prepare(
    'INSERT INTO messages (id, direction, phone, body, media_type, created_at) VALUES ($1,$2,$3,$4,$5,$6)'
  ).run(nanoid(), 'out', phone, text, null, Date.now());
  emit('wa:message', { direction: 'out', phone, body: text, at: Date.now() });
  return { ...sent, wa_message_id: sent?.id?._serialized || null };
}

export async function resolveAllContacts() {
  if (!client || status !== 'ready') throw new Error('WhatsApp not connected');
  const rows = await db.prepare(
    `SELECT id, phone, jid, push_name, resolved_number FROM contacts
     WHERE (jid IS NOT NULL AND jid != '')
        AND (resolved_number IS NULL OR resolved_number = '' OR push_name IS NULL OR push_name = '')`
  ).all();
  let updated = 0;
  for (const row of rows) {
    const r = await resolveContact(client, row.jid, row.push_name || '');
    if (r.resolved_number || r.push_name) {
      await db.prepare(
        `UPDATE contacts SET
           resolved_number = COALESCE($1, resolved_number),
           push_name = COALESCE(NULLIF($2, ''), push_name)
         WHERE id = $3`
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
  } catch {}
}

export async function sendMedia(phone, { url, base64, mimetype, filename, caption, sendAudioAsVoice = false }) {
  if (!client || status !== 'ready') throw new Error('WhatsApp not connected');
  const jid = toJid(phone);
  let media;
  if (url) {
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
  await db.prepare(
    'INSERT INTO messages (id, direction, phone, body, media_type, created_at) VALUES ($1,$2,$3,$4,$5,$6)'
  ).run(nanoid(), 'out', phone, caption || '', mimetype || 'media', Date.now());
  emit('wa:message', { direction: 'out', phone, body: caption || '[media]', at: Date.now() });
  return { ...sent, wa_message_id: sent?.id?._serialized || null };
}
