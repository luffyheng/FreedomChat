import { Router } from 'express';
import db from '../db.js';
import { runFlowGraph } from '../services/flowEngine.js';
import {
  subscribePhoneToSequence,
  unsubscribePhoneFromSequence,
} from './sequences.js';

const router = Router();

function stripDigits(s) {
  return String(s || '').replace(/[^\d]/g, '');
}

router.get('/:phone', async (req, res) => {
  const raw = req.params.phone;
  const digits = stripDigits(raw);
  let contact = await db.prepare('SELECT * FROM contacts WHERE phone = $1').get(digits);
  if (!contact) contact = await db.prepare('SELECT * FROM contacts WHERE jid = $1').get(raw);
  const [attrs, sequences] = await Promise.all([
    db.prepare('SELECT key, value FROM user_attributes WHERE phone = $1').all(raw),
    db.prepare(
      `SELECT s.id, s.name, sub.status, sub.subscribed_at, sub.id as subscriber_id
         FROM sequence_subscribers sub
         JOIN sequences s ON s.id = sub.sequence_id
        WHERE sub.phone = $1 OR sub.phone = $2`
    ).all(raw, digits),
  ]);
  res.json({ contact, attributes: attrs, sequences });
});

router.post('/:phone/run-flow', async (req, res) => {
  const { flowId } = req.body || {};
  if (!flowId) return res.status(400).json({ error: 'flowId required' });
  const f = await db.prepare('SELECT * FROM flows WHERE id = $1').get(flowId);
  if (!f) return res.status(404).json({ error: 'flow not found' });
  try {
    await runFlowGraph({
      graph: JSON.parse(f.graph_json),
      phone: req.params.phone,
      vars: { phone: req.params.phone },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:phone/subscribe', async (req, res) => {
  const { sequenceId } = req.body || {};
  if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' });
  res.json(await subscribePhoneToSequence(sequenceId, req.params.phone));
});

router.post('/:phone/unsubscribe', async (req, res) => {
  const { sequenceId } = req.body || {};
  if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' });
  res.json(await unsubscribePhoneFromSequence(sequenceId, req.params.phone));
});

router.post('/:phone/attributes', async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  await db.prepare(
    `INSERT INTO user_attributes (phone, key, value, updated_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT(phone,key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at`
  ).run(req.params.phone, key, String(value ?? ''), Date.now());
  res.json({ ok: true });
});

router.delete('/:phone/attributes/:key', async (req, res) => {
  await db.prepare(
    'DELETE FROM user_attributes WHERE phone = $1 AND key = $2'
  ).run(req.params.phone, req.params.key);
  res.json({ ok: true });
});

export default router;
