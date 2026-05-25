import db from '../db.js';
import { runFlowGraph } from './flowEngine.js';

let timer = null;

export function startSequenceDispatcher() {
  if (timer) return;
  timer = setInterval(tick, 5000);
  setTimeout(tick, 500);
}

export function stopSequenceDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tick() {
  const now = Date.now();
  const due = await db.prepare(
    `SELECT d.*, q.graph_json, q.name as queue_name, s.phone, sub.status as sub_status
     FROM sequence_dispatches d
     JOIN sequence_queues q ON q.id = d.queue_id
     JOIN sequence_subscribers s ON s.id = d.subscriber_id
     JOIN sequence_subscribers sub ON sub.id = d.subscriber_id
     WHERE d.status = 'pending' AND d.due_at <= $1
     LIMIT 20`
  ).all(now);

  for (const d of due) {
    try {
      if (d.sub_status !== 'active') {
        await db.prepare("UPDATE sequence_dispatches SET status = 'cancelled' WHERE id = $1").run(d.id);
        continue;
      }
      const graph = JSON.parse(d.graph_json);
      await runFlowGraph({ graph, phone: d.phone, vars: { phone: d.phone } });
      await db.prepare(
        'UPDATE sequence_dispatches SET status = $1, sent_at = $2 WHERE id = $3'
      ).run('sent', Date.now(), d.id);
    } catch (e) {
      await db.prepare(
        'UPDATE sequence_dispatches SET status = $1, error = $2 WHERE id = $3'
      ).run('failed', e.message, d.id);
    }
  }
}
