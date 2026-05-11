import { Router } from 'express';
import db from '../db.js';

const router = Router();

export function setAttribute(phone, key, value) {
  if (!phone || !key) return;
  db.prepare(
    `INSERT INTO user_attributes (phone, key, value, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(phone, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(phone, key, String(value ?? ''), Date.now());
}

export function removeAttribute(phone, key) {
  db.prepare('DELETE FROM user_attributes WHERE phone = ? AND key = ?').run(phone, key);
}

export function getAttributes(phone) {
  const rows = db.prepare('SELECT key, value FROM user_attributes WHERE phone = ?').all(phone);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

router.get('/:phone', (req, res) => {
  res.json(getAttributes(req.params.phone));
});

router.post('/:phone', (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  setAttribute(req.params.phone, key, value);
  res.json({ ok: true });
});

router.delete('/:phone/:key', (req, res) => {
  removeAttribute(req.params.phone, req.params.key);
  res.json({ ok: true });
});

export default router;
