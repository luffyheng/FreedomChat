import db from '../db.js';
import { setAttribute, removeAttribute, getAttributes } from '../routes/attributes.js';
import {
  subscribePhoneToSequence,
  unsubscribePhoneFromSequence,
} from '../routes/sequences.js';

async function send(type, phone, payload) {
  const wa = await import('./whatsapp.js');
  if (type === 'text') return wa.sendText(phone, payload.text);
  if (type === 'media') return wa.sendMedia(phone, payload);
  if (type === 'presence') return wa.sendPresence(phone, payload.state, payload.ms);
}

function matchTrigger(trigger, body) {
  if (trigger.type === 'any') return true;
  if (trigger.type === 'welcome') return false;
  const hay = (body || '').toLowerCase().trim();
  const needle = (trigger.value || '').toLowerCase().trim();
  if (!needle) return false;
  if (trigger.match_mode === 'exact') return hay === needle;
  if (trigger.match_mode === 'starts') return hay.startsWith(needle);
  return hay.includes(needle);
}

export async function findMatchingFlows(body) {
  const rows = await db.prepare(
    `SELECT t.*, f.graph_json, f.enabled as flow_enabled, f.name as flow_name, f.id as flow_id
     FROM triggers t JOIN flows f ON f.id = t.flow_id
     WHERE t.enabled = 1 AND f.enabled = 1`
  ).all();
  return rows.filter((r) => matchTrigger(r, body));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function interpolate(tpl, vars, phone) {
  const attrs = phone ? await getAttributes(phone) : {};
  const all = { ...attrs, ...vars };
  return String(tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => all[k] ?? '');
}

/**
 * Walks a node graph. Each non-branching node points to one outgoing edge.
 */
export async function runFlowGraph({ graph, phone, vars = {}, depth = 0 }) {
  if (depth > 5) return;
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const startNode = nodes.find((n) => n.type === 'trigger') || nodes[0];
  if (!startNode) return;

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const outgoing = (id, handleId) =>
    edges.filter((e) => e.source === id && (!handleId || e.sourceHandle === handleId));

  let current = startNode;
  const visited = new Set();
  let guard = 0;

  while (current && guard++ < 200) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const { type, data = {} } = current;

    try {
      switch (type) {
        case 'sendText': {
          const text = await interpolate(data.text || '', vars, phone);
          if (text) await send('text', phone, { text });
          break;
        }
        case 'sendImage':
        case 'sendVideo':
        case 'sendAudio':
        case 'sendDocument':
        case 'sendMedia': {
          await send('media', phone, {
            url: data.url,
            caption: await interpolate(data.caption || '', vars, phone),
          });
          break;
        }
        case 'typing': {
          await send('presence', phone, { state: 'composing', ms: Math.max(500, Number(data.ms) || 1500) });
          break;
        }
        case 'recording': {
          await send('presence', phone, { state: 'recording', ms: Math.max(500, Number(data.ms) || 1500) });
          break;
        }
        case 'delay': {
          await sleep(Math.max(0, Number(data.ms) || 1000));
          break;
        }
        case 'setAttribute': {
          if (data.key) await setAttribute(phone, data.key, await interpolate(data.value || '', vars, phone));
          break;
        }
        case 'removeAttribute': {
          if (data.key) await removeAttribute(phone, data.key);
          break;
        }
        case 'subscribeSequence': {
          if (data.sequenceId) await subscribePhoneToSequence(data.sequenceId, phone);
          break;
        }
        case 'unsubscribeSequence': {
          if (data.sequenceId) await unsubscribePhoneFromSequence(data.sequenceId, phone);
          break;
        }
        case 'redirectFlow': {
          if (data.flowId) {
            const target = await db.prepare('SELECT * FROM flows WHERE id = $1').get(data.flowId);
            if (target) {
              await runFlowGraph({
                graph: JSON.parse(target.graph_json),
                phone,
                vars,
                depth: depth + 1,
              });
            }
          }
          return;
        }
        case 'end':
          return;
        default:
          break;
      }
    } catch (e) {
      console.error('flow step error:', current.type, e.message);
    }

    // pick next edge
    let next = null;
    if (type === 'condition') {
      const needle = (await interpolate(data.expected || '', vars, phone)).toLowerCase();
      const matched = (vars.lastMessage || '').toLowerCase().includes(needle);
      const branch = matched ? 'yes' : 'no';
      const e = outgoing(current.id, branch)[0] || outgoing(current.id)[0];
      next = e ? byId[e.target] : null;
    } else if (type === 'abTest') {
      const weight = Number(data.weightA ?? 50);
      const branch = Math.random() * 100 < weight ? 'a' : 'b';
      const e = outgoing(current.id, branch)[0] || outgoing(current.id)[0];
      next = e ? byId[e.target] : null;
    } else {
      const e = outgoing(current.id)[0];
      next = e ? byId[e.target] : null;
    }
    current = next;
  }
}

export async function runFlowForIncoming({ phone, body }) {
  const matches = await findMatchingFlows(body);
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m.flow_id)) continue;
    seen.add(m.flow_id);
    let graph;
    try {
      graph = JSON.parse(m.graph_json);
    } catch {
      continue;
    }
    await runFlowGraph({ graph, phone, vars: { lastMessage: body, phone } });
  }
}
