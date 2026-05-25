import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { sendText, sendMedia, sendPresence } from '../services/whatsapp.js';

const router = Router();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET /api/quick-replies — list all with items
router.get('/', async (req, res) => {
  const [rows, items] = await Promise.all([
    db.prepare('SELECT * FROM quick_replies ORDER BY created_at ASC').all(),
    db.prepare('SELECT * FROM quick_reply_items ORDER BY sort_order ASC').all(),
  ]);
  const itemsByQr = {};
  for (const it of items) {
    if (!itemsByQr[it.quick_reply_id]) itemsByQr[it.quick_reply_id] = [];
    itemsByQr[it.quick_reply_id].push(it);
  }
  res.json(rows.map((r) => ({ ...r, items: itemsByQr[r.id] || [] })));
});

// POST /api/quick-replies — create
router.post('/', async (req, res) => {
  const { name, trigger_code = null, presence_seconds = 0, items = [] } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const id = nanoid();
  const now = Date.now();

  if (trigger_code) {
    const existing = await db.prepare(
      'SELECT id FROM quick_replies WHERE trigger_code = $1'
    ).get(trigger_code);
    if (existing) return res.status(400).json({ error: `Trigger code "${trigger_code}" is already in use` });
  }

  await db.prepare(
    'INSERT INTO quick_replies (id, name, trigger_code, presence_seconds, created_at) VALUES ($1,$2,$3,$4,$5)'
  ).run(id, name.trim(), trigger_code || null, Number(presence_seconds) || 0, now);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await db.prepare(
      'INSERT INTO quick_reply_items (id, quick_reply_id, type, content, url, sort_order) VALUES ($1,$2,$3,$4,$5,$6)'
    ).run(nanoid(), id, it.type || 'text', it.content || null, it.url || null, i);
  }

  const [created, createdItems] = await Promise.all([
    db.prepare('SELECT * FROM quick_replies WHERE id = $1').get(id),
    db.prepare('SELECT * FROM quick_reply_items WHERE quick_reply_id = $1 ORDER BY sort_order').all(id),
  ]);
  res.json({ ...created, items: createdItems });
});

// PUT /api/quick-replies/:id — update
router.put('/:id', async (req, res) => {
  const qr = await db.prepare('SELECT * FROM quick_replies WHERE id = $1').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'not found' });

  const { name, trigger_code, presence_seconds, items } = req.body || {};

  if (trigger_code !== undefined && trigger_code !== qr.trigger_code && trigger_code) {
    const existing = await db.prepare(
      'SELECT id FROM quick_replies WHERE trigger_code = $1 AND id != $2'
    ).get(trigger_code, req.params.id);
    if (existing) return res.status(400).json({ error: `Trigger code "${trigger_code}" is already in use` });
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (trigger_code !== undefined) updates.trigger_code = trigger_code || null;
  if (presence_seconds !== undefined) updates.presence_seconds = Number(presence_seconds) || 0;

  if (Object.keys(updates).length) {
    const keys = Object.keys(updates);
    const vals = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await db.prepare(
      `UPDATE quick_replies SET ${setClauses} WHERE id = $${keys.length + 1}`
    ).run(...vals, req.params.id);
  }

  if (Array.isArray(items)) {
    await db.prepare('DELETE FROM quick_reply_items WHERE quick_reply_id = $1').run(req.params.id);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await db.prepare(
        'INSERT INTO quick_reply_items (id, quick_reply_id, type, content, url, sort_order) VALUES ($1,$2,$3,$4,$5,$6)'
      ).run(nanoid(), req.params.id, it.type || 'text', it.content || null, it.url || null, i);
    }
  }

  const [updated, updatedItems] = await Promise.all([
    db.prepare('SELECT * FROM quick_replies WHERE id = $1').get(req.params.id),
    db.prepare('SELECT * FROM quick_reply_items WHERE quick_reply_id = $1 ORDER BY sort_order').all(req.params.id),
  ]);
  res.json({ ...updated, items: updatedItems });
});

// DELETE /api/quick-replies/:id
router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM quick_replies WHERE id = $1').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/quick-replies/:id/send — send to a phone number
router.post('/:id/send', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const qr = await db.prepare('SELECT * FROM quick_replies WHERE id = $1').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'not found' });

  const items = await db.prepare(
    'SELECT * FROM quick_reply_items WHERE quick_reply_id = $1 ORDER BY sort_order ASC'
  ).all(req.params.id);

  try {
    const presenceSec = Number(qr.presence_seconds || 0);
    if (presenceSec > 0 && items.length > 0) {
      const presenceState = items[0].type === 'audio' ? 'recording' : 'composing';
      await sendPresence(phone, presenceState, presenceSec * 1000);
    }

    for (const item of items) {
      if (item.type === 'text') {
        await sendText(phone, item.content || '');
      } else {
        await sendMedia(phone, {
          url: item.url,
          sendAudioAsVoice: item.type === 'audio',
        });
      }
      if (items.length > 1) await sleep(600);
    }
    res.json({ ok: true, sent: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
