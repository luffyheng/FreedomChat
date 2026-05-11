import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { nanoid } from 'nanoid';
import db from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', (req, res) => {
  const { search } = req.query;
  const rows = search
    ? db
        .prepare(
          `SELECT * FROM contacts WHERE name LIKE ? OR phone LIKE ? OR tags LIKE ?
           ORDER BY COALESCE(last_activity, created_at) DESC LIMIT 2000`
        )
        .all(`%${search}%`, `%${search}%`, `%${search}%`)
    : db
        .prepare(
          'SELECT * FROM contacts ORDER BY COALESCE(last_activity, created_at) DESC LIMIT 2000'
        )
        .all();
  // attach sequences subscribed to
  const stmt = db.prepare(
    `SELECT s.name FROM sequence_subscribers sub
       JOIN sequences s ON s.id = sub.sequence_id
     WHERE sub.phone = ? AND sub.status = 'active' LIMIT 5`
  );
  for (const r of rows) {
    const seqs = stmt.all(r.phone).map((s) => s.name);
    r.sequences = seqs;
  }
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  const attrs = db
    .prepare('SELECT key, value FROM user_attributes WHERE phone = ?')
    .all(c.phone);
  const seqs = db
    .prepare(
      `SELECT s.id, s.name, sub.status, sub.subscribed_at
         FROM sequence_subscribers sub
         JOIN sequences s ON s.id = sub.sequence_id
        WHERE sub.phone = ?`
    )
    .all(c.phone);
  res.json({ ...c, attributes: attrs, sequences: seqs });
});

router.post('/', (req, res) => {
  const { name = '', phone, tags = '' } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const digits = String(phone).replace(/[^\d]/g, '');
  try {
    const id = nanoid();
    db.prepare('INSERT INTO contacts (id, name, phone, tags, created_at) VALUES (?,?,?,?,?)')
      .run(id, name, digits, tags, Date.now());
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/import', upload.single('file'), (req, res) => {
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

  const insert = db.prepare(
    'INSERT OR IGNORE INTO contacts (id, name, phone, tags, created_at) VALUES (?,?,?,?,?)'
  );
  const now = Date.now();
  let added = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const phone = String(r.phone || r.Phone || r.number || '').replace(/[^\d]/g, '');
      if (!phone) continue;
      const name = r.name || r.Name || '';
      const tags = r.tags || r.Tags || '';
      const info = insert.run(nanoid(), name, phone, tags, now);
      if (info.changes) added++;
    }
  });
  tx(rows);
  res.json({ added, total: rows.length });
});

export default router;
