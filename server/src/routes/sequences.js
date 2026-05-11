import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM sequence_queues q WHERE q.sequence_id = s.id) as queue_count,
        (SELECT COUNT(*) FROM sequence_subscribers sub WHERE sub.sequence_id = s.id AND sub.status='active') as subscriber_count
       FROM sequences s ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name = 'Untitled Sequence' } = req.body || {};
  const id = nanoid();
  db.prepare('INSERT INTO sequences (id, name, enabled, created_at) VALUES (?,?,?,?)').run(
    id,
    name,
    1,
    Date.now()
  );
  res.json({ id });
});

router.get('/:id', (req, res) => {
  const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
  if (!seq) return res.status(404).json({ error: 'not found' });
  const queues = db
    .prepare('SELECT * FROM sequence_queues WHERE sequence_id = ? ORDER BY position ASC')
    .all(req.params.id)
    .map((q) => ({ ...q, graph: JSON.parse(q.graph_json) }));
  const subscribers = db
    .prepare('SELECT * FROM sequence_subscribers WHERE sequence_id = ? ORDER BY subscribed_at DESC LIMIT 200')
    .all(req.params.id);
  res.json({ ...seq, queues, subscribers });
});

router.put('/:id', (req, res) => {
  const { name, enabled } = req.body || {};
  const existing = db.prepare('SELECT * FROM sequences WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE sequences SET name = ?, enabled = ? WHERE id = ?').run(
    name ?? existing.name,
    (enabled ?? existing.enabled) ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM sequences WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Queues
router.post('/:id/queues', (req, res) => {
  const { name = 'Queue', delay_ms = 86400000, graph = { nodes: [], edges: [] } } = req.body || {};
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) as m FROM sequence_queues WHERE sequence_id = ?')
    .get(req.params.id);
  const id = nanoid();
  db.prepare(
    'INSERT INTO sequence_queues (id, sequence_id, name, position, delay_ms, graph_json) VALUES (?,?,?,?,?,?)'
  ).run(id, req.params.id, name, (max.m ?? -1) + 1, delay_ms, JSON.stringify(graph));
  res.json({ id });
});

router.put('/queues/:queueId', (req, res) => {
  const { name, delay_ms, graph, position } = req.body || {};
  const existing = db.prepare('SELECT * FROM sequence_queues WHERE id = ?').get(req.params.queueId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare(
    'UPDATE sequence_queues SET name = ?, delay_ms = ?, graph_json = ?, position = ? WHERE id = ?'
  ).run(
    name ?? existing.name,
    delay_ms ?? existing.delay_ms,
    graph ? JSON.stringify(graph) : existing.graph_json,
    position ?? existing.position,
    req.params.queueId
  );
  res.json({ ok: true });
});

router.delete('/queues/:queueId', (req, res) => {
  db.prepare('DELETE FROM sequence_queues WHERE id = ?').run(req.params.queueId);
  res.json({ ok: true });
});

// Manual subscribe (for testing)
router.post('/:id/subscribe', (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  res.json(subscribePhoneToSequence(req.params.id, phone));
});

export function subscribePhoneToSequence(sequenceId, phone) {
  const seq = db.prepare('SELECT * FROM sequences WHERE id = ?').get(sequenceId);
  if (!seq || !seq.enabled) return { error: 'sequence not found or disabled' };
  // Insert subscriber (ignore duplicates)
  const subId = nanoid();
  const existing = db
    .prepare('SELECT * FROM sequence_subscribers WHERE sequence_id = ? AND phone = ?')
    .get(sequenceId, phone);
  const sid = existing ? existing.id : subId;
  if (!existing) {
    db.prepare(
      'INSERT INTO sequence_subscribers (id, sequence_id, phone, subscribed_at, status) VALUES (?,?,?,?,?)'
    ).run(sid, sequenceId, phone, Date.now(), 'active');
  } else if (existing.status !== 'active') {
    db.prepare('UPDATE sequence_subscribers SET status = ? WHERE id = ?').run('active', sid);
  }
  // Enqueue dispatches for all queues
  const queues = db
    .prepare('SELECT * FROM sequence_queues WHERE sequence_id = ? ORDER BY position ASC')
    .all(sequenceId);
  const now = Date.now();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO sequence_dispatches (id, subscriber_id, queue_id, due_at, status) VALUES (?,?,?,?,?)'
  );
  for (const q of queues) {
    insert.run(nanoid(), sid, q.id, now + (q.delay_ms || 0), 'pending');
  }
  return { ok: true, subscriberId: sid, queuesScheduled: queues.length };
}

export function unsubscribePhoneFromSequence(sequenceId, phone) {
  const sub = db
    .prepare('SELECT * FROM sequence_subscribers WHERE sequence_id = ? AND phone = ?')
    .get(sequenceId, phone);
  if (!sub) return { ok: true };
  db.prepare('UPDATE sequence_subscribers SET status = ? WHERE id = ?').run('unsubscribed', sub.id);
  db.prepare('UPDATE sequence_dispatches SET status = ? WHERE subscriber_id = ? AND status = ?').run(
    'cancelled',
    sub.id,
    'pending'
  );
  return { ok: true };
}

export default router;
