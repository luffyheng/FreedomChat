import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { sendText, sendMedia } from '../services/whatsapp.js';

const router = Router();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET /api/quick-replies — list all with items
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM quick_replies ORDER BY created_at ASC').all();
  const items = db.prepare('SELECT * FROM quick_reply_items ORDER BY sort_order ASC').all();
  const itemsByQr = {};
  for (const it of items) {
    if (!itemsByQr[it.quick_reply_id]) itemsByQr[it.quick_reply_id] = [];
    itemsByQr[it.quick_reply_id].push(it);
  }
  res.json(rows.map((r) => ({ ...r, items: itemsByQr[r.id] || [] })));
});

// POST /api/quick-replies — create
router.post('/', (req, res) => {
  const { name, trigger_code = null, items = [] } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });

  const id = nanoid();
  const now = Date.now();

  // Check duplicate trigger code
  if (trigger_code) {
    const existing = db.prepare('SELECT id FROM quick_replies WHERE trigger_code = ?').get(trigger_code);
    if (existing) return res.status(400).json({ error: `Trigger code "${trigger_code}" is already in use` });
  }

  db.prepare('INSERT INTO quick_replies (id, name, trigger_code, created_at) VALUES (?,?,?,?)').run(
    id, name.trim(), trigger_code || null, now
  );

  const insertItem = db.prepare(
    'INSERT INTO quick_reply_items (id, quick_reply_id, type, content, url, sort_order) VALUES (?,?,?,?,?,?)'
  );
  const tx = db.transaction((list) => {
    list.forEach((it, i) => {
      insertItem.run(nanoid(), id, it.type || 'text', it.content || null, it.url || null, i);
    });
  });
  tx(items);

  const created = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(id);
  const createdItems = db.prepare('SELECT * FROM quick_reply_items WHERE quick_reply_id = ? ORDER BY sort_order').all(id);
  res.json({ ...created, items: createdItems });
});

// PUT /api/quick-replies/:id — update
router.put('/:id', (req, res) => {
  const qr = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'not found' });

  const { name, trigger_code, items } = req.body || {};

  // Check duplicate trigger code (allow same ID to keep its own code)
  if (trigger_code !== undefined && trigger_code !== qr.trigger_code) {
    if (trigger_code) {
      const existing = db.prepare('SELECT id FROM quick_replies WHERE trigger_code = ? AND id != ?').get(trigger_code, req.params.id);
      if (existing) return res.status(400).json({ error: `Trigger code "${trigger_code}" is already in use` });
    }
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (trigger_code !== undefined) updates.trigger_code = trigger_code || null;

  if (Object.keys(updates).length) {
    const sql = 'UPDATE quick_replies SET ' + Object.keys(updates).map((k) => `${k} = ?`).join(', ') + ' WHERE id = ?';
    db.prepare(sql).run(...Object.values(updates), req.params.id);
  }

  // Replace items if provided
  if (Array.isArray(items)) {
    db.prepare('DELETE FROM quick_reply_items WHERE quick_reply_id = ?').run(req.params.id);
    const insertItem = db.prepare(
      'INSERT INTO quick_reply_items (id, quick_reply_id, type, content, url, sort_order) VALUES (?,?,?,?,?,?)'
    );
    const tx = db.transaction((list) => {
      list.forEach((it, i) => {
        insertItem.run(nanoid(), req.params.id, it.type || 'text', it.content || null, it.url || null, i);
      });
    });
    tx(items);
  }

  const updated = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id);
  const updatedItems = db.prepare('SELECT * FROM quick_reply_items WHERE quick_reply_id = ? ORDER BY sort_order').all(req.params.id);
  res.json({ ...updated, items: updatedItems });
});

// DELETE /api/quick-replies/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM quick_replies WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/quick-replies/:id/send — send to a phone number
router.post('/:id/send', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const qr = db.prepare('SELECT * FROM quick_replies WHERE id = ?').get(req.params.id);
  if (!qr) return res.status(404).json({ error: 'not found' });

  const items = db.prepare(
    'SELECT * FROM quick_reply_items WHERE quick_reply_id = ? ORDER BY sort_order ASC'
  ).all(req.params.id);

  try {
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
