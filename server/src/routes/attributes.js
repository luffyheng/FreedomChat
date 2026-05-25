import { Router } from 'express';
import db from '../db.js';

const router = Router();

export async function setAttribute(phone, key, value) {
  if (!phone || !key) return;
  await db.prepare(
    `INSERT INTO user_attributes (phone, key, value, updated_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT(phone, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`
  ).run(phone, key, String(value ?? ''), Date.now());
}

export async function removeAttribute(phone, key) {
  await db.prepare('DELETE FROM user_attributes WHERE phone = $1 AND key = $2').run(phone, key);
}

export async function getAttributes(phone) {
  const rows = await db.prepare('SELECT key, value FROM user_attributes WHERE phone = $1').all(phone);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

router.get('/:phone', async (req, res) => {
  res.json(await getAttributes(req.params.phone));
});

router.post('/:phone', async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  await setAttribute(req.params.phone, key, value);
  res.json({ ok: true });
});

router.delete('/:phone/:key', async (req, res) => {
  await removeAttribute(req.params.phone, req.params.key);
  res.json({ ok: true });
});

export default router;
