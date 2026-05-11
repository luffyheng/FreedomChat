import db from '../db.js';
import { runFlowGraph } from './flowEngine.js';

let timer = null;

export function startSequenceDispatcher() {
  if (timer) return;
  timer = setInterval(tick, 5000); // poll every 5s
  // Also do a tick on startup
  setTimeout(tick, 500);
}

export function stopSequenceDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick() {
  const now = Date.now();
  const due = db
    .prepare(
      `SELECT d.*, q.graph_json, q.name as queue_name, s.phone, sub.status as sub_status
       FROM sequence_dispatches d
       JOIN sequence_queues q ON q.id = d.queue_id
       JOIN sequence_subscribers s ON s.id = d.subscriber_id
       JOIN sequence_subscribers sub ON sub.id = d.subscriber_id
       WHERE d.status = 'pending' AND d.due_at <= ?
       LIMIT 20`
    )
    .all(now);

  for (const d of due) {
    try {
      if (d.sub_status !== 'active') {
        db.prepare('UPDATE sequence_dispatches SET status = ? WHERE id = ?').run('cancelled', d.id);
        continue;
      }
      const graph = JSON.parse(d.graph_json);
      await runFlowGraph({ graph, phone: d.phone, vars: { phone: d.phone } });
      db.prepare('UPDATE sequence_dispatches SET status = ?, sent_at = ? WHERE id = ?').run(
        'sent',
        Date.now(),
        d.id
      );
    } catch (e) {
      db.prepare('UPDATE sequence_dispatches SET status = ?, error = ? WHERE id = ?').run(
        'failed',
        e.message,
        d.id
      );
    }
  }
}
