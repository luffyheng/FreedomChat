import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { startBroadcast, pauseBroadcast } from '../services/broadcast.js';
import { getStatus } from '../services/whatsapp.js';

export default function broadcastsRouter(io) {
  const router = Router();

  router.get('/', async (req, res) => {
    const rows = await db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC').all();
    res.json(rows);
  });

  router.get('/:id', async (req, res) => {
    const bc = await db.prepare('SELECT * FROM broadcasts WHERE id = $1').get(req.params.id);
    if (!bc) return res.status(404).json({ error: 'not found' });
    const targets = await db.prepare(
      `SELECT t.*,
              COALESCE(NULLIF(t.contact_name,''),
                       NULLIF(c.name,''),
                       NULLIF(c.push_name,''),
                       NULLIF(clm.name,''),
                       '') AS display_name
       FROM broadcast_targets t
       LEFT JOIN contacts c
         ON c.phone = REPLACE(REPLACE(REPLACE(t.phone,'@c.us',''),'@lid',''),'@g.us','')
       LEFT JOIN contact_list_members clm
         ON clm.list_id = $1
        AND clm.phone   = REPLACE(REPLACE(REPLACE(t.phone,'@c.us',''),'@lid',''),'@g.us','')
       WHERE t.broadcast_id = $2
       ORDER BY t.created_at ASC
       LIMIT 10000`
    ).all(bc.list_id || '', req.params.id);

    const stats = { total: targets.length, pending: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 };
    for (const t of targets) {
      if (t.status === 'pending') stats.pending++;
      else if (t.status === 'failed') stats.failed++;
      else if (t.status === 'sent') stats.sent++;
      if (t.delivered_at) stats.delivered++;
      if (t.read_at) stats.read++;
      if (t.replied_at) stats.replied++;
    }
    res.json({ ...bc, targets, stats });
  });

  router.post('/', async (req, res) => {
    const {
      name = 'Untitled Broadcast',
      message = '',
      messages = null,
      media_url = null,
      image_url = null,
      min_delay_ms = 600_000,
      max_delay_ms = 900_000,
      daily_limit = 30,
      resume_hour = 10,
      resume_minute = 0,
      phones = [],
      contact_ids = [],
      list_id = null,
    } = req.body || {};

    let variants = Array.isArray(messages) ? messages : [];
    variants = variants.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 10);
    if (variants.length === 0 && message) variants = [String(message)];
    const primaryMessage = variants[0] || '';

    if (variants.length === 0 && !media_url && !image_url) {
      return res.status(400).json({ error: 'message, image_url, or media_url required' });
    }
    if (max_delay_ms < min_delay_ms) {
      return res.status(400).json({ error: 'max_delay_ms must be >= min_delay_ms' });
    }

    const id = nanoid();
    const now = Date.now();
    const avgDelay = Math.floor((min_delay_ms + max_delay_ms) / 2);
    await db.prepare(
      `INSERT INTO broadcasts
         (id, name, message, media_url, image_url, delay_ms, min_delay_ms, max_delay_ms,
          daily_limit, daily_sent, last_dispatch_date, list_id, total, created_at,
          resume_hour, resume_minute, messages_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`
    ).run(
      id, name, primaryMessage, media_url, image_url, avgDelay, min_delay_ms, max_delay_ms,
      daily_limit, 0, null, list_id, 0, now,
      Math.max(0, Math.min(23, Number(resume_hour) || 0)),
      Math.max(0, Math.min(59, Number(resume_minute) || 0)),
      variants.length > 1 ? JSON.stringify(variants) : null
    );

    const allPhones = new Set();
    const phoneToName = new Map();
    const setName = (p, n) => { if (n && !phoneToName.get(p)) phoneToName.set(p, n); };

    for (const p of phones) {
      const d = String(p).replace(/[^\d]/g, '');
      if (d) allPhones.add(d);
    }
    if (contact_ids.length) {
      const placeholders = contact_ids.map((_, i) => `$${i + 1}`).join(',');
      const contactRows = await db.query(
        `SELECT phone, name, push_name FROM contacts WHERE id IN (${placeholders})`,
        contact_ids
      );
      for (const row of contactRows) {
        allPhones.add(row.phone);
        setName(row.phone, row.name || row.push_name || '');
      }
    }
    if (list_id) {
      const listRows = await db.prepare(
        'SELECT phone, name FROM contact_list_members WHERE list_id = $1'
      ).all(list_id);
      for (const row of listRows) {
        allPhones.add(row.phone);
        setName(row.phone, row.name || '');
      }
    }

    const variantCount = Math.max(1, variants.length);
    let i = 0;
    for (const p of allPhones) {
      await db.prepare(
        'INSERT INTO broadcast_targets (id, broadcast_id, phone, contact_name, variant_index) VALUES ($1,$2,$3,$4,$5)'
      ).run(nanoid(), id, p, phoneToName.get(p) || null, i % variantCount);
      i++;
    }
    await db.prepare('UPDATE broadcasts SET total = $1 WHERE id = $2').run(allPhones.size, id);
    res.json({ id, total: allPhones.size });
  });

  router.put('/:id', async (req, res) => {
    const fields = [
      'name', 'message', 'media_url', 'image_url',
      'min_delay_ms', 'max_delay_ms', 'daily_limit', 'resume_hour', 'resume_minute',
    ];
    const ex = await db.prepare('SELECT * FROM broadcasts WHERE id = $1').get(req.params.id);
    if (!ex) return res.status(404).json({ error: 'not found' });
    const updates = {};
    for (const f of fields) if (f in (req.body || {})) updates[f] = req.body[f];
    if ('messages' in (req.body || {}) && Array.isArray(req.body.messages)) {
      const v = req.body.messages.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 10);
      updates.messages_json = v.length > 1 ? JSON.stringify(v) : null;
      if (v.length) updates.message = v[0];
    }
    if (req.body?.resume_now === true) {
      updates.paused_until = 0;
      updates.next_due_at = 0;
    }
    if (!Object.keys(updates).length) return res.json({ ok: true });
    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await db.prepare(`UPDATE broadcasts SET ${setClauses} WHERE id = $${keys.length + 1}`).run(
      ...vals, req.params.id
    );
    if (req.body?.resume_now === true) {
      io?.emit('broadcast:update', { id: req.params.id, status: ex.status });
    }
    res.json({ ok: true });
  });

  router.post('/:id/start', async (req, res) => {
    const { status } = getStatus();
    if (status !== 'ready') {
      return res.status(400).json({ error: 'WhatsApp is not connected. Please connect WhatsApp first.' });
    }
    await startBroadcast(req.params.id, io);
    res.json({ ok: true });
  });

  router.post('/:id/send-now', async (req, res) => {
    const bc = await db.prepare('SELECT * FROM broadcasts WHERE id = $1').get(req.params.id);
    if (!bc) return res.status(404).json({ error: 'not found' });
    if (bc.status !== 'running') return res.status(400).json({ error: 'broadcast is not running' });
    await db.prepare('UPDATE broadcasts SET next_due_at = 0 WHERE id = $1').run(req.params.id);
    io?.emit('broadcast:update', { id: req.params.id });
    res.json({ ok: true });
  });

  router.post('/:id/retry-failed', async (req, res) => {
    const bc = await db.prepare('SELECT * FROM broadcasts WHERE id = $1').get(req.params.id);
    if (!bc) return res.status(404).json({ error: 'not found' });
    const result = await db.prepare(
      "UPDATE broadcast_targets SET status = 'pending', error = NULL, attempts = 0 WHERE broadcast_id = $1 AND status = 'failed'"
    ).run(req.params.id);
    await db.prepare('UPDATE broadcasts SET failed = 0 WHERE id = $1').run(req.params.id);
    res.json({ ok: true, reset: result.changes });
  });

  router.post('/:id/pause', async (req, res) => {
    await pauseBroadcast(req.params.id, io);
    res.json({ ok: true });
  });

  router.delete('/:id', async (req, res) => {
    await db.prepare('DELETE FROM broadcasts WHERE id = $1').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
