import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const { phone, limit = 500 } = req.query;
  const rows = phone
    ? db.prepare('SELECT * FROM messages WHERE phone = ? ORDER BY created_at DESC LIMIT ?').all(phone, Number(limit))
    : db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?').all(Number(limit));
  res.json(rows);
});

router.get('/threads', (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.phone,
              MAX(m.created_at) AS last_at,
              (SELECT body FROM messages WHERE phone = m.phone ORDER BY created_at DESC LIMIT 1) AS last_body,
              (SELECT direction FROM messages WHERE phone = m.phone ORDER BY created_at DESC LIMIT 1) AS last_direction,
              (SELECT media_type FROM messages WHERE phone = m.phone ORDER BY created_at DESC LIMIT 1) AS last_media_type,
              (SELECT COUNT(*) FROM messages WHERE phone = m.phone AND direction='in' AND COALESCE(read,0) = 0) AS unread,
              c.name AS contact_name,
              c.push_name AS push_name,
              c.resolved_number AS resolved_number
         FROM messages m
         LEFT JOIN contacts c
           ON c.jid = m.phone
           OR c.phone = REPLACE(REPLACE(REPLACE(m.phone,'@c.us',''),'@lid',''),'@g.us','')
        GROUP BY m.phone
        ORDER BY last_at DESC
        LIMIT 500`
    )
    .all();
  res.json(rows);
});

router.post('/mark-read', (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  db.prepare('UPDATE messages SET read = 1 WHERE phone = ? AND direction = ? AND COALESCE(read,0) = 0').run(
    phone,
    'in'
  );
  res.json({ ok: true });
});

export default router;
