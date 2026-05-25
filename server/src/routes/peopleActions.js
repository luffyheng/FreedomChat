import { Router } from 'express';
import db from '../db.js';
import { runFlowGraph } from '../services/flowEngine.js';
import {
  subscribePhoneToSequence,
  unsubscribePhoneFromSequence,
  pausePhoneInSequence,
  resumePhoneInSequence,
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
  const [attrs, sequencesRaw] = await Promise.all([
    db.prepare('SELECT key, value FROM user_attributes WHERE phone = $1').all(raw),
    db.prepare(
      `SELECT s.id, s.name, sub.status, sub.subscribed_at, sub.id as subscriber_id
         FROM sequence_subscribers sub
         JOIN sequences s ON s.id = sub.sequence_id
        WHERE sub.phone = $1 OR sub.phone = $2`
    ).all(raw, digits),
  ]);

  // Attach the next pending dispatch to each subscription
  const sequences = await Promise.all(
    sequencesRaw.map(async (sub) => {
      const nextDispatch = await db.prepare(
        `SELECT d.id, d.due_at, q.name as queue_name, q.position, q.graph_json
         FROM sequence_dispatches d
         JOIN sequence_queues q ON q.id = d.queue_id
         WHERE d.subscriber_id = $1 AND d.status = 'pending'
         ORDER BY d.due_at ASC LIMIT 1`
      ).get(sub.subscriber_id);
      if (nextDispatch) {
        // Extract preview text from the first sendText node in the flow graph
        try {
          const graph = JSON.parse(nextDispatch.graph_json || '{}');
          const textNode = (graph.nodes || []).find((n) => n.type === 'sendText');
          nextDispatch.preview_text = textNode?.data?.text || '';
        } catch { nextDispatch.preview_text = ''; }
        delete nextDispatch.graph_json; // don't send raw JSON to client
      }
      return { ...sub, next_dispatch: nextDispatch || null };
    })
  );

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

router.post('/:phone/pause-sequence', async (req, res) => {
  const { sequenceId } = req.body || {};
  if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' });
  res.json(await pausePhoneInSequence(sequenceId, req.params.phone));
});

router.post('/:phone/resume-sequence', async (req, res) => {
  const { sequenceId } = req.body || {};
  if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' });
  res.json(await resumePhoneInSequence(sequenceId, req.params.phone));
});

router.post('/:phone/send-dispatch', async (req, res) => {
  const { dispatchId } = req.body || {};
  if (!dispatchId) return res.status(400).json({ error: 'dispatchId required' });

  const dispatch = await db.prepare(
    `SELECT d.*, q.graph_json
     FROM sequence_dispatches d
     JOIN sequence_queues q ON q.id = d.queue_id
     WHERE d.id = $1`
  ).get(dispatchId);

  if (!dispatch) return res.status(404).json({ error: 'dispatch not found' });

  try {
    const graph = JSON.parse(dispatch.graph_json);
    await runFlowGraph({ graph, phone: req.params.phone, vars: { phone: req.params.phone } });
    await db.prepare(
      'UPDATE sequence_dispatches SET status = $1, sent_at = $2 WHERE id = $3'
    ).run('sent', Date.now(), dispatchId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
