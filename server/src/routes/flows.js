import { Router } from 'express';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { runFlowGraph } from '../services/flowEngine.js';

const router = Router();

router.get('/', async (req, res) => {
  const rows = await db.prepare(
    'SELECT id, name, description, enabled, updated_at FROM flows ORDER BY updated_at DESC'
  ).all();
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const flow = await db.prepare('SELECT * FROM flows WHERE id = $1').get(req.params.id);
  if (!flow) return res.status(404).json({ error: 'not found' });
  const triggers = await db.prepare('SELECT * FROM triggers WHERE flow_id = $1').all(req.params.id);
  res.json({ ...flow, graph: JSON.parse(flow.graph_json), triggers });
});

router.post('/', async (req, res) => {
  const { name = 'Untitled Flow', description = '', graph = { nodes: [], edges: [] }, enabled = 1 } = req.body || {};
  const id = nanoid();
  const now = Date.now();
  await db.prepare(
    'INSERT INTO flows (id, name, description, enabled, graph_json, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)'
  ).run(id, name, description, enabled ? 1 : 0, JSON.stringify(graph), now, now);
  res.json({ id });
});

router.put('/:id', async (req, res) => {
  const { name, description, graph, enabled } = req.body || {};
  const existing = await db.prepare('SELECT * FROM flows WHERE id = $1').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  await db.prepare(
    'UPDATE flows SET name=$1, description=$2, enabled=$3, graph_json=$4, updated_at=$5 WHERE id=$6'
  ).run(
    name ?? existing.name,
    description ?? existing.description,
    (enabled ?? existing.enabled) ? 1 : 0,
    graph ? JSON.stringify(graph) : existing.graph_json,
    Date.now(),
    req.params.id
  );

  // Auto-sync triggers from any 'trigger' nodes in the graph
  if (graph) {
    const autoKey = 'auto:canvas';
    await db.prepare("DELETE FROM triggers WHERE flow_id = $1 AND id LIKE $2").run(
      req.params.id,
      autoKey + '%'
    );
    const triggerNodes = (graph.nodes || []).filter((n) => n.type === 'trigger');
    for (const n of triggerNodes) {
      const kw = (n.data?.keyword || '').trim();
      const type = kw ? 'keyword' : 'any';
      await db.prepare(
        'INSERT INTO triggers (id, flow_id, type, value, match_mode, enabled, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)'
      ).run(`${autoKey}:${n.id}`, req.params.id, type, kw, 'contains', 1, Date.now());
    }
  }

  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await db.prepare('DELETE FROM flows WHERE id = $1').run(req.params.id);
  res.json({ ok: true });
});

// Triggers
router.post('/:id/triggers', async (req, res) => {
  const { type = 'keyword', value = '', match_mode = 'contains', enabled = 1 } = req.body || {};
  const id = nanoid();
  await db.prepare(
    'INSERT INTO triggers (id, flow_id, type, value, match_mode, enabled, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)'
  ).run(id, req.params.id, type, value, match_mode, enabled ? 1 : 0, Date.now());
  res.json({ id });
});

router.delete('/triggers/:triggerId', async (req, res) => {
  await db.prepare('DELETE FROM triggers WHERE id = $1').run(req.params.triggerId);
  res.json({ ok: true });
});

// Test-run a flow against a phone
router.post('/:id/test', async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const flow = await db.prepare('SELECT * FROM flows WHERE id = $1').get(req.params.id);
  if (!flow) return res.status(404).json({ error: 'not found' });
  try {
    await runFlowGraph({ graph: JSON.parse(flow.graph_json), phone, vars: { phone } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
