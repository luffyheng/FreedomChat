import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { nanoid } from 'nanoid';
import db from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', async (req, res) => {
  const { search } = req.query;
  const rows = search
    ? await db.prepare(
        `SELECT * FROM contacts WHERE name ILIKE $1 OR phone ILIKE $1 OR tags ILIKE $1
         ORDER BY COALESCE(last_activity, created_at) DESC LIMIT 2000`
      ).all(`%${search}%`)
    : await db.prepare(
        'SELECT * FROM contacts ORDER BY COALESCE(last_activity, created_at) DESC LIMIT 2000'
      ).all();

  // Batch-fetch all sequence subscriptions in ONE query (avoids N+1)
  if (rows.length > 0) {
    const phoneList = rows.map((r) => `'${String(r.phone).replace(/'/g, "''")}'`).join(',');
    const allSeqs = await db.prepare(
      `SELECT sub.phone, s.name, sub.status FROM sequence_subscribers sub
         JOIN sequences s ON s.id = sub.sequence_id
       WHERE sub.phone IN (${phoneList}) AND sub.status IN ('active','paused')`
    ).all();
    const seqMap = {};
    for (const seq of allSeqs) {
      if (!seqMap[seq.phone]) seqMap[seq.phone] = [];
      seqMap[seq.phone].push(seq);
    }
    for (const r of rows) {
      r.sequence_subs = seqMap[r.phone] || [];
      r.sequences = r.sequence_subs.map((s) => s.name);
    }
  }
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const c = await db.prepare('SELECT * FROM contacts WHERE id = $1').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const [attrs, seqs] = await Promise.all([
    db.prepare('SELECT key, value FROM user_attributes WHERE phone = $1').all(c.phone),
    db.prepare(
      `SELECT s.id, s.name, sub.status, sub.subscribed_at
         FROM sequence_subscribers sub
         JOIN sequences s ON s.id = sub.sequence_id
        WHERE sub.phone = $1`
    ).all(c.phone),
  ]);
  res.json({ ...c, attributes: attrs, sequences: seqs });
});

router.post('/', async (req, res) => {
  const { name = '', phone, tags = '' } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const digits = String(phone).replace(/[^\d]/g, '');
  try {
    const id = nanoid();
    await db.prepare(
      'INSERT INTO contacts (id, name, phone, tags, created_at) VALUES ($1,$2,$3,$4,$5)'
    ).run(id, name, digits, tags, Date.now());
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM contacts WHERE id = $1').run(req.params.id);
  res.json({ ok: true });
});

router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  let rows;
  try {
    rows = parse(req.file.buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (e) {
    return res.status(400).json({ error: 'invalid csv: ' + e.message });
  }

  const now = Date.now();
  let added = 0;
  for (const r of rows) {
    const phone = String(r.phone || r.Phone || r.number || '').replace(/[^\d]/g, '');
    if (!phone) continue;
    const name = r.name || r.Name || '';
    const tags = r.tags || r.Tags || '';
    const result = await db.prepare(
      'INSERT INTO contacts (id, name, phone, tags, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (phone) DO NOTHING'
    ).run(nanoid(), name, phone, tags, now);
    if (result.changes) added++;
  }
  res.json({ added, total: rows.length });
});

export default router;
