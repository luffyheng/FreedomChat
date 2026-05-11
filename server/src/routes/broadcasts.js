import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { startBroadcast, pauseBroadcast } from '../services/broadcast.js';
import { getStatus } from '../services/whatsapp.js';

export default function broadcastsRouter(io) {
  const router = Router();

  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC').all();
    res.json(rows);
  });

  router.get('/:id', (req, res) => {
    const bc = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!bc) return res.status(404).json({ error: 'not found' });
    const targets = db
      .prepare(
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
           ON clm.list_id = ?
          AND clm.phone   = REPLACE(REPLACE(REPLACE(t.phone,'@c.us',''),'@lid',''),'@g.us','')
         WHERE t.broadcast_id = ?
         ORDER BY t.rowid ASC
         LIMIT 5000`
      )
      .all(bc.list_id || '', req.params.id);

    const stats = {
      total: targets.length,
      pending: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      replied: 0,
      failed: 0,
    };
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

  router.post('/', (req, res) => {
    const {
      name = 'Untitled Broadcast',
      message = '',
      messages = null,           // array of variants — round-robin per send
      media_url = null,
      image_url = null,
      min_delay_ms = 600_000,    // 10 min
      max_delay_ms = 900_000,    // 15 min
      daily_limit = 30,
      resume_hour = 10,
      resume_minute = 0,
      phones = [],
      contact_ids = [],
      list_id = null,
    } = req.body || {};

    // Normalize variants — keep up to 10 non-empty slots
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
    // delay_ms kept for backwards compatibility — store the average
    const avgDelay = Math.floor((min_delay_ms + max_delay_ms) / 2);
    db.prepare(
      `INSERT INTO broadcasts
         (id, name, message, media_url, image_url, delay_ms, min_delay_ms, max_delay_ms,
          daily_limit, daily_sent, last_dispatch_date, list_id, total, created_at,
          resume_hour, resume_minute, messages_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      name,
      primaryMessage,
      media_url,
      image_url,
      avgDelay,
      min_delay_ms,
      max_delay_ms,
      daily_limit,
      0,
      null,
      list_id,
      0,
      now,
      Math.max(0, Math.min(23, Number(resume_hour) || 0)),
      Math.max(0, Math.min(59, Number(resume_minute) || 0)),
      variants.length > 1 ? JSON.stringify(variants) : null
    );

    const allPhones = new Set();
    const phoneToName = new Map(); // snapshot of contact name at create time
    const setName = (p, n) => {
      if (!n) return;
      if (!phoneToName.get(p)) phoneToName.set(p, n);
    };

    for (const p of phones) {
      const d = String(p).replace(/[^\d]/g, '');
      if (d) allPhones.add(d);
    }
    if (contact_ids.length) {
      const stmt = db.prepare(
        `SELECT phone, name, push_name FROM contacts
         WHERE id IN (${contact_ids.map(() => '?').join(',')})`
      );
      for (const row of stmt.all(...contact_ids)) {
        allPhones.add(row.phone);
        setName(row.phone, row.name || row.push_name || '');
      }
    }
    if (list_id) {
      const stmt = db.prepare('SELECT phone, name FROM contact_list_members WHERE list_id = ?');
      for (const row of stmt.all(list_id)) {
        allPhones.add(row.phone);
        setName(row.phone, row.name || '');
      }
    }

    const insert = db.prepare(
      'INSERT INTO broadcast_targets (id, broadcast_id, phone, contact_name, variant_index) VALUES (?,?,?,?,?)'
    );
    const variantCount = Math.max(1, variants.length);
    const tx = db.transaction((list) => {
      let i = 0;
      for (const p of list) {
        insert.run(nanoid(), id, p, phoneToName.get(p) || null, i % variantCount);
        i++;
      }
    });
    tx([...allPhones]);
    db.prepare('UPDATE broadcasts SET total = ? WHERE id = ?').run(allPhones.size, id);
    res.json({ id, total: allPhones.size });
  });

  router.put('/:id', (req, res) => {
    const fields = [
      'name',
      'message',
      'media_url',
      'image_url',
      'min_delay_ms',
      'max_delay_ms',
      'daily_limit',
      'resume_hour',
      'resume_minute',
    ];
    const ex = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!ex) return res.status(404).json({ error: 'not found' });
    const updates = {};
    for (const f of fields) if (f in (req.body || {})) updates[f] = req.body[f];
    if ('messages' in (req.body || {}) && Array.isArray(req.body.messages)) {
      const v = req.body.messages.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 10);
      updates.messages_json = v.length > 1 ? JSON.stringify(v) : null;
      if (v.length) updates.message = v[0];
    }
    // resume_now=true clears paused_until so the broadcast resumes immediately today
    if (req.body?.resume_now === true) {
      updates.paused_until = 0;
      updates.next_due_at = 0;
    }
    if (!Object.keys(updates).length) return res.json({ ok: true });
    const sql =
      'UPDATE broadcasts SET ' +
      Object.keys(updates).map((k) => `${k} = ?`).join(', ') +
      ' WHERE id = ?';
    db.prepare(sql).run(...Object.values(updates), req.params.id);
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
    startBroadcast(req.params.id, io);
    res.json({ ok: true });
  });

  router.post('/:id/retry-failed', (req, res) => {
    const bc = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id);
    if (!bc) return res.status(404).json({ error: 'not found' });
    const result = db.prepare(
      "UPDATE broadcast_targets SET status = 'pending', error = NULL, attempts = 0 WHERE broadcast_id = ? AND status = 'failed'"
    ).run(req.params.id);
    db.prepare('UPDATE broadcasts SET failed = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true, reset: result.changes });
  });

  router.post('/:id/pause', (req, res) => {
    pauseBroadcast(req.params.id, io);
    res.json({ ok: true });
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM broadcasts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
