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

// Return a unified "contact card" for a phone/jid:
//   basic info, attributes, sequence subscriptions, recent flows that would match a message
router.get('/:phone', (req, res) => {
  const raw = req.params.phone;
  const digits = stripDigits(raw);
  const contact =
    db.prepare('SELECT * FROM contacts WHERE phone = ?').get(digits) ||
    db.prepare('SELECT * FROM contacts WHERE jid = ?').get(raw) ||
    null;
  const attrs = db.prepare('SELECT key, value FROM user_attributes WHERE phone = ?').all(raw);
  // sequences — subscribers table uses the JID form stored at subscribe time.
  // Match against both jid and digits-only for safety.
  const sequences = db
    .prepare(
      `SELECT s.id, s.name, sub.status, sub.subscribed_at, sub.id as subscriber_id
         FROM sequence_subscribers sub
         JOIN sequences s ON s.id = sub.sequence_id
        WHERE sub.phone = ? OR sub.phone = ?`
    )
    .all(raw, digits);
  res.json({ contact, attributes: attrs, sequences });
});

// Run an arbitrary flow against a phone (manual trigger)
router.post('/:phone/run-flow', async (req, res) => {
  const { flowId } = req.body || {};
  if (!flowId) return res.status(400).json({ error: 'flowId required' });
  const f = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId);
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

router.post('/:phone/subscribe', (req, res) => {
  const { sequenceId } = req.body || {};
  if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' });
  res.json(subscribePhoneToSequence(sequenceId, req.params.phone));
});

router.post('/:phone/unsubscribe', (req, res) => {
  const { sequenceId } = req.body || {};
  if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' });
  res.json(unsubscribePhoneFromSequence(sequenceId, req.params.phone));
});

router.post('/:phone/attributes', (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  db.prepare(
    `INSERT INTO user_attributes (phone, key, value, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(phone,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run(req.params.phone, key, String(value ?? ''), Date.now());
  res.json({ ok: true });
});

router.delete('/:phone/attributes/:key', (req, res) => {
  db.prepare('DELETE FROM user_attributes WHERE phone = ? AND key = ?').run(
    req.params.phone,
    req.params.key
  );
  res.json({ ok: true });
});

export default router;
