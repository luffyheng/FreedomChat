import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const rows = await db.prepare(
    `SELECT s.*,
      (SELECT COUNT(*) FROM sequence_queues q WHERE q.sequence_id = s.id) as queue_count,
      (SELECT COUNT(*) FROM sequence_subscribers sub WHERE sub.sequence_id = s.id AND sub.status='active') as subscriber_count,
      (SELECT COUNT(*) FROM sequence_subscribers sub WHERE sub.sequence_id = s.id AND sub.status='paused') as paused_count,
      (SELECT COUNT(*) FROM sequence_subscribers sub WHERE sub.sequence_id = s.id AND sub.status='completed') as completed_count
     FROM sequences s ORDER BY created_at DESC`
  ).all();
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name = 'Untitled Sequence' } = req.body || {};
  const id = nanoid();
  await db.prepare(
    'INSERT INTO sequences (id, name, enabled, created_at) VALUES ($1,$2,$3,$4)'
  ).run(id, name, 1, Date.now());
  res.json({ id });
});

router.get('/:id', async (req, res) => {
  const seq = await db.prepare('SELECT * FROM sequences WHERE id = $1').get(req.params.id);
  if (!seq) return res.status(404).json({ error: 'not found' });
  const [queuesRaw, subscribers] = await Promise.all([
    db.prepare('SELECT * FROM sequence_queues WHERE sequence_id = $1 ORDER BY position ASC').all(req.params.id),
    db.prepare('SELECT * FROM sequence_subscribers WHERE sequence_id = $1 ORDER BY subscribed_at DESC LIMIT 200').all(req.params.id),
  ]);
  const queues = queuesRaw.map((q) => ({ ...q, graph: JSON.parse(q.graph_json) }));
  res.json({ ...seq, queues, subscribers });
});

router.put('/:id', async (req, res) => {
  const { name, enabled } = req.body || {};
  const existing = await db.prepare('SELECT * FROM sequences WHERE id = $1').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  await db.prepare('UPDATE sequences SET name = $1, enabled = $2 WHERE id = $3').run(
    name ?? existing.name,
    (enabled ?? existing.enabled) ? 1 : 0,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM sequences WHERE id = $1').run(req.params.id);
  res.json({ ok: true });
});

// Queues
router.post('/:id/queues', async (req, res) => {
  const { name = 'Queue', delay_ms = 86400000, graph = { nodes: [], edges: [] } } = req.body || {};
  const max = await db.prepare(
    'SELECT COALESCE(MAX(position), -1) as m FROM sequence_queues WHERE sequence_id = $1'
  ).get(req.params.id);
  const id = nanoid();
  await db.prepare(
    'INSERT INTO sequence_queues (id, sequence_id, name, position, delay_ms, graph_json) VALUES ($1,$2,$3,$4,$5,$6)'
  ).run(id, req.params.id, name, (max?.m ?? -1) + 1, delay_ms, JSON.stringify(graph));

  // Backfill: schedule this new step for all existing active/paused subscribers
  const subs = await db.prepare(
    "SELECT * FROM sequence_subscribers WHERE sequence_id = $1 AND status IN ('active','paused')"
  ).all(req.params.id);
  const now = Date.now();
  for (const sub of subs) {
    await db.prepare(
      'INSERT INTO sequence_dispatches (id, subscriber_id, queue_id, due_at, status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subscriber_id, queue_id) DO NOTHING'
    ).run(nanoid(), sub.id, id, now + (delay_ms || 0), 'pending');
  }

  res.json({ id });
});

router.put('/queues/:queueId', async (req, res) => {
  const { name, delay_ms, graph, position } = req.body || {};
  const existing = await db.prepare('SELECT * FROM sequence_queues WHERE id = $1').get(req.params.queueId);
  if (!existing) return res.status(404).json({ error: 'not found' });
  await db.prepare(
    'UPDATE sequence_queues SET name = $1, delay_ms = $2, graph_json = $3, position = $4 WHERE id = $5'
  ).run(
    name ?? existing.name,
    delay_ms ?? existing.delay_ms,
    graph ? JSON.stringify(graph) : existing.graph_json,
    position ?? existing.position,
    req.params.queueId
  );
  res.json({ ok: true });
});

router.delete('/queues/:queueId', async (req, res) => {
  await db.prepare('DELETE FROM sequence_queues WHERE id = $1').run(req.params.queueId);
  res.json({ ok: true });
});

// Manual subscribe / pause / resume per sequence
router.post('/:id/subscribe', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  res.json(await subscribePhoneToSequence(req.params.id, phone));
});

router.post('/:id/pause', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  res.json(await pausePhoneInSequence(req.params.id, phone));
});

router.post('/:id/resume', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  res.json(await resumePhoneInSequence(req.params.id, phone));
});

export async function subscribePhoneToSequence(sequenceId, phone) {
  const seq = await db.prepare('SELECT * FROM sequences WHERE id = $1').get(sequenceId);
  if (!seq || !seq.enabled) return { error: 'sequence not found or disabled' };

  const subId = nanoid();
  const existing = await db.prepare(
    'SELECT * FROM sequence_subscribers WHERE sequence_id = $1 AND phone = $2'
  ).get(sequenceId, phone);
  const sid = existing ? existing.id : subId;

  if (!existing) {
    await db.prepare(
      'INSERT INTO sequence_subscribers (id, sequence_id, phone, subscribed_at, status) VALUES ($1,$2,$3,$4,$5)'
    ).run(sid, sequenceId, phone, Date.now(), 'active');
  } else if (existing.status !== 'active') {
    await db.prepare('UPDATE sequence_subscribers SET status = $1 WHERE id = $2').run('active', sid);
  }

  const queues = await db.prepare(
    'SELECT * FROM sequence_queues WHERE sequence_id = $1 ORDER BY position ASC'
  ).all(sequenceId);
  const now = Date.now();
  for (const q of queues) {
    await db.prepare(
      'INSERT INTO sequence_dispatches (id, subscriber_id, queue_id, due_at, status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subscriber_id, queue_id) DO NOTHING'
    ).run(nanoid(), sid, q.id, now + (q.delay_ms || 0), 'pending');
  }
  return { ok: true, subscriberId: sid, queuesScheduled: queues.length };
}

export async function unsubscribePhoneFromSequence(sequenceId, phone) {
  const sub = await db.prepare(
    'SELECT * FROM sequence_subscribers WHERE sequence_id = $1 AND phone = $2'
  ).get(sequenceId, phone);
  if (!sub) return { ok: true };
  await db.prepare('UPDATE sequence_subscribers SET status = $1 WHERE id = $2').run('unsubscribed', sub.id);
  await db.prepare(
    "UPDATE sequence_dispatches SET status = $1 WHERE subscriber_id = $2 AND status IN ('pending','paused')"
  ).run('cancelled', sub.id);
  return { ok: true };
}

/** Pause a contact's subscription to one sequence — dispatches stay pending */
export async function pausePhoneInSequence(sequenceId, phone) {
  const digits = String(phone).replace(/[^\d]/g, '');
  const sub = await db.prepare(
    `SELECT * FROM sequence_subscribers
     WHERE sequence_id = $1 AND (phone = $2 OR phone = $3) LIMIT 1`
  ).get(sequenceId, phone, digits);
  if (!sub) return { ok: true, noop: true };
  if (sub.status === 'paused') return { ok: true, already: true };
  await db.prepare('UPDATE sequence_subscribers SET status = $1 WHERE id = $2').run('paused', sub.id);
  return { ok: true };
}

/** Resume a contact's paused subscription */
export async function resumePhoneInSequence(sequenceId, phone) {
  const digits = String(phone).replace(/[^\d]/g, '');
  const sub = await db.prepare(
    `SELECT * FROM sequence_subscribers
     WHERE sequence_id = $1 AND (phone = $2 OR phone = $3) LIMIT 1`
  ).get(sequenceId, phone, digits);
  if (!sub) return { error: 'not subscribed' };
  if (sub.status === 'active') return { ok: true, already: true };
  await db.prepare('UPDATE sequence_subscribers SET status = $1 WHERE id = $2').run('active', sub.id);
  return { ok: true };
}

/** Pause ALL active sequences for a phone (keyword trigger from WhatsApp) */
export async function pauseAllSequencesForPhone(phone) {
  const digits = String(phone).replace(/[^\d]/g, '');
  const subs = await db.prepare(
    `SELECT id FROM sequence_subscribers WHERE (phone = $1 OR phone = $2) AND status = 'active'`
  ).all(phone, digits);
  for (const sub of subs) {
    await db.prepare('UPDATE sequence_subscribers SET status = $1 WHERE id = $2').run('paused', sub.id);
  }
  return { ok: true, paused: subs.length };
}

/** Resume ALL paused sequences for a phone (keyword trigger from WhatsApp) */
export async function resumeAllSequencesForPhone(phone) {
  const digits = String(phone).replace(/[^\d]/g, '');
  const subs = await db.prepare(
    `SELECT id FROM sequence_subscribers WHERE (phone = $1 OR phone = $2) AND status = 'paused'`
  ).all(phone, digits);
  for (const sub of subs) {
    await db.prepare('UPDATE sequence_subscribers SET status = $1 WHERE id = $2').run('active', sub.id);
  }
  return { ok: true, resumed: subs.length };
}

export default router;
