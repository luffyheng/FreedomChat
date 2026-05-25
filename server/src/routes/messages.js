import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { phone, limit = 500 } = req.query;
  const rows = phone
    ? await db.prepare('SELECT * FROM messages WHERE phone = $1 ORDER BY created_at DESC LIMIT $2').all(phone, Number(limit))
    : await db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT $1').all(Number(limit));
  res.json(rows);
});

router.get('/threads', async (req, res) => {
  const rows = await db.query(
    `WITH latest AS (
       SELECT DISTINCT ON (phone)
              phone,
              created_at  AS last_at,
              body        AS last_body,
              direction   AS last_direction,
              media_type  AS last_media_type,
              author_name AS last_author_name
         FROM messages
        ORDER BY phone, created_at DESC
     )
     SELECT l.phone,
            l.last_at,
            l.last_body,
            l.last_direction,
            l.last_media_type,
            l.last_author_name,
            (SELECT COUNT(*) FROM messages
              WHERE phone = l.phone AND direction='in' AND COALESCE(read,0) = 0) AS unread,
            (SELECT name FROM contacts
              WHERE jid = l.phone
                 OR phone = REPLACE(REPLACE(REPLACE(l.phone,'@c.us',''),'@lid',''),'@g.us','')
              LIMIT 1) AS contact_name,
            (SELECT push_name FROM contacts
              WHERE jid = l.phone
                 OR phone = REPLACE(REPLACE(REPLACE(l.phone,'@c.us',''),'@lid',''),'@g.us','')
              LIMIT 1) AS push_name,
            (SELECT resolved_number FROM contacts
              WHERE jid = l.phone
                 OR phone = REPLACE(REPLACE(REPLACE(l.phone,'@c.us',''),'@lid',''),'@g.us','')
              LIMIT 1) AS resolved_number
       FROM latest l
      ORDER BY l.last_at DESC
      LIMIT 500`
  );
  res.json(rows);
});

router.post('/mark-read', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  await db.prepare(
    "UPDATE messages SET read = 1 WHERE phone = $1 AND direction = $2 AND COALESCE(read,0) = 0"
  ).run(phone, 'in');
  res.json({ ok: true });
});

export default router;
