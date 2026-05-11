import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { runFlowGraph } from '../services/flowEngine.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, name, description, enabled, updated_at FROM flows ORDER BY updated_at DESC').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id);
  if (!flow) return res.status(404).json({ error: 'not found' });
  const triggers = db.prepare('SELECT * FROM triggers WHERE flow_id = ?').all(req.params.id);
  res.json({ ...flow, graph: JSON.parse(flow.graph_json), triggers });
});

router.post('/', (req, res) => {
  const { name = 'Untitled Flow', description = '', graph = { nodes: [], edges: [] }, enabled = 1 } = req.body || {};
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    'INSERT INTO flows (id, name, description, enabled, graph_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, name, description, enabled ? 1 : 0, JSON.stringify(graph), now, now);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  const { name, description, graph, enabled } = req.body || {};
  const existing = db.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.prepare(
    'UPDATE flows SET name=?, description=?, enabled=?, graph_json=?, updated_at=? WHERE id=?'
  ).run(
    name ?? existing.name,
    description ?? existing.description,
    (enabled ?? existing.enabled) ? 1 : 0,
    graph ? JSON.stringify(graph) : existing.graph_json,
    Date.now(),
    req.params.id
  );

  // Auto-sync triggers from any 'trigger' nodes in the graph so the canvas
  // keyword field "just works" without having to add triggers separately.
  if (graph) {
    const autoKey = 'auto:canvas';
    // Remove previously auto-created triggers for this flow
    db.prepare('DELETE FROM triggers WHERE flow_id = ? AND id LIKE ?').run(
      req.params.id,
      autoKey + '%'
    );
    const triggerNodes = (graph.nodes || []).filter((n) => n.type === 'trigger');
    const insert = db.prepare(
      'INSERT INTO triggers (id, flow_id, type, value, match_mode, enabled, created_at) VALUES (?,?,?,?,?,?,?)'
    );
    for (const n of triggerNodes) {
      const kw = (n.data?.keyword || '').trim();
      const type = kw ? 'keyword' : 'any';
      insert.run(
        `${autoKey}:${n.id}`,
        req.params.id,
        type,
        kw,
        'contains',
        1,
        Date.now()
      );
    }
  }

  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM flows WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Triggers
router.post('/:id/triggers', (req, res) => {
  const { type = 'keyword', value = '', match_mode = 'contains', enabled = 1 } = req.body || {};
  const id = nanoid();
  db.prepare(
    'INSERT INTO triggers (id, flow_id, type, value, match_mode, enabled, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(id, req.params.id, type, value, match_mode, enabled ? 1 : 0, Date.now());
  res.json({ id });
});

router.delete('/triggers/:triggerId', (req, res) => {
  db.prepare('DELETE FROM triggers WHERE id = ?').run(req.params.triggerId);
  res.json({ ok: true });
});

// Test-run a flow against a phone (for quick QA)
router.post('/:id/test', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(req.params.id);
  if (!flow) return res.status(404).json({ error: 'not found' });
  try {
    await runFlowGraph({ graph: JSON.parse(flow.graph_json), phone, vars: { phone } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
