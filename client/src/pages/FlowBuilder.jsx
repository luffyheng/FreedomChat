import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
} from '@xyflow/react';
import toast from 'react-hot-toast';
import { nanoid } from 'nanoid/non-secure';
import {
  Save,
  Zap,
  MessageSquare,
  Image,
  Video,
  Mic,
  FileText,
  Timer,
  GitBranch,
  CheckCircle2,
  Play,
  Plus,
  Trash2,
  ArrowLeft,
  Activity,
  UserCog,
  UserMinus,
  Clock,
  CornerDownRight,
  Shuffle,
} from 'lucide-react';
import { nodeTypes } from '../components/nodes/nodes.jsx';
import MediaField from '../components/MediaField.jsx';
import { api } from '../lib/api.js';

const palette = [
  { group: 'Trigger' },
  { type: 'trigger', label: 'Trigger', icon: Zap, color: 'bg-amber-100 text-amber-700', data: { keyword: '' } },
  { group: 'Content' },
  { type: 'sendText', label: 'Text', icon: MessageSquare, color: 'bg-brand-100 text-brand-700', data: { text: 'Hello!' } },
  { type: 'sendImage', label: 'Image', icon: Image, color: 'bg-purple-100 text-purple-700', data: { url: '', caption: '' } },
  { type: 'sendVideo', label: 'Video', icon: Video, color: 'bg-fuchsia-100 text-fuchsia-700', data: { url: '', caption: '' } },
  { type: 'sendAudio', label: 'Audio', icon: Mic, color: 'bg-pink-100 text-pink-700', data: { url: '' } },
  { type: 'sendDocument', label: 'Document', icon: FileText, color: 'bg-indigo-100 text-indigo-700', data: { url: '', caption: '' } },
  { type: 'typing', label: 'Typing…', icon: Activity, color: 'bg-sky-100 text-sky-700', data: { ms: 1500 } },
  { type: 'recording', label: 'Recording…', icon: Mic, color: 'bg-rose-100 text-rose-700', data: { ms: 1500 } },
  { group: 'Action' },
  { type: 'setAttribute', label: 'Set Attribute', icon: UserCog, color: 'bg-emerald-100 text-emerald-700', data: { key: '', value: '' } },
  { type: 'removeAttribute', label: 'Remove Attribute', icon: UserMinus, color: 'bg-slate-100 text-slate-700', data: { key: '' } },
  { type: 'subscribeSequence', label: 'Subscribe Sequence', icon: Clock, color: 'bg-teal-100 text-teal-700', data: { sequenceId: '', sequenceName: '' } },
  { type: 'unsubscribeSequence', label: 'Unsubscribe Sequence', icon: Clock, color: 'bg-slate-100 text-slate-700', data: { sequenceId: '', sequenceName: '' } },
  { group: 'Control' },
  { type: 'delay', label: 'Delay', icon: Timer, color: 'bg-blue-100 text-blue-700', data: { ms: 1500 } },
  { type: 'condition', label: 'If / Else', icon: GitBranch, color: 'bg-rose-100 text-rose-700', data: { expected: '' } },
  { type: 'abTest', label: 'A/B Test', icon: Shuffle, color: 'bg-orange-100 text-orange-700', data: { weightA: 50 } },
  { type: 'redirectFlow', label: 'Redirect to Flow', icon: CornerDownRight, color: 'bg-amber-100 text-amber-700', data: { flowId: '', flowName: '' } },
  { type: 'end', label: 'End', icon: CheckCircle2, color: 'bg-slate-100 text-slate-600', data: {} },
];

function Builder() {
  const { id } = useParams();
  const nav = useNavigate();

  const [flow, setFlow] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId]
  );
  const [triggers, setTriggers] = useState([]);
  const [testPhone, setTestPhone] = useState('');
  const [allFlows, setAllFlows] = useState([]);
  const [allSequences, setAllSequences] = useState([]);
  const wrapperRef = useRef(null);
  const rfRef = useRef(null);

  useEffect(() => {
    api.flows.get(id).then((f) => {
      setFlow(f);
      setNodes(f.graph?.nodes || []);
      setEdges(f.graph?.edges || []);
      setTriggers(f.triggers || []);
    });
    api.flows.list().then(setAllFlows).catch(() => {});
    api.sequences.list().then(setAllSequences).catch(() => {});
  }, [id]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, id: nanoid() }, eds)),
    [setEdges]
  );

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/node-type');
      if (!type) return;
      const bounds = wrapperRef.current.getBoundingClientRect();
      const position = rfRef.current.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      const paletteItem = palette.find((p) => p.type === type);
      const newNode = {
        id: nanoid(),
        type,
        position,
        data: { ...(paletteItem?.data || {}) },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes]
  );

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const updateSelected = useCallback(
    (patch) => {
      if (!selectedId) return;
      setNodes((nds) =>
        nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n))
      );
    },
    [selectedId, setNodes]
  );

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const save = () => {
    toast.success('Flow saved');
    api.flows.update(id, {
      name: flow.name,
      description: flow.description,
      enabled: flow.enabled,
      graph: { nodes, edges },
    }).catch((e) => toast.error(`Save failed: ${e.message}`));
  };

  const addTrigger = async () => {
    const value = prompt('Keyword to match (leave empty for "any message"):') ?? '';
    const type = value ? 'keyword' : 'any';
    // Optimistic: append a temp trigger immediately
    const temp = { id: `temp-${Date.now()}`, type, value, match_mode: 'contains' };
    setTriggers((t) => [...t, temp]);
    api.flows.addTrigger(id, { type, value, match_mode: 'contains' })
      .then(() => api.flows.get(id).then((f) => setTriggers(f.triggers)))
      .catch((e) => {
        toast.error(e.message);
        setTriggers((t) => t.filter((x) => x.id !== temp.id));
      });
  };

  const removeTrigger = (triggerId) => {
    const backup = triggers;
    setTriggers((t) => t.filter((x) => x.id !== triggerId));
    api.flows.removeTrigger(triggerId).catch((e) => {
      toast.error(e.message);
      setTriggers(backup);
    });
  };

  const runTest = () => {
    if (!testPhone) return toast.error('Enter a phone number first');
    toast.success('Flow dispatched to ' + testPhone);
    api.flows.test(id, testPhone).catch((e) => toast.error(e.message));
  };

  if (!flow) return <div className="p-10 text-slate-500">Loading…</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center gap-3">
        <button className="btn-ghost" onClick={() => nav('/flows')}>
          <ArrowLeft size={14} />
        </button>
        <input
          className="text-lg font-semibold bg-transparent outline-none flex-1 min-w-0"
          value={flow.name}
          onChange={(e) => setFlow({ ...flow, name: e.target.value })}
        />
        <input
          placeholder="Test phone (e.g. 919xxxxxxxxx)"
          className="input max-w-[220px]"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
        />
        <button className="btn-outline" onClick={runTest}>
          <Play size={14} /> Test run
        </button>
        <button className="btn-primary" onClick={save}>
          <Save size={14} /> Save
        </button>
      </div>

      <div className="flex-1 flex">
        {/* Palette */}
        <div className="w-56 border-r border-slate-200 bg-white p-3 space-y-2 overflow-auto">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Drag to canvas</div>
          {palette.map((p, i) => p.group ? (
            <div key={'g'+i} className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide pt-2">{p.group}</div>
          ) : (
            <div
              key={p.type}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/node-type', p.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
              className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 hover:border-brand-400 hover:bg-brand-50/40 cursor-grab"
            >
              <span className={`w-6 h-6 rounded grid place-items-center ${p.color}`}>
                <p.icon size={13} />
              </span>
              <span className="text-sm text-slate-700">{p.label}</span>
            </div>
          ))}

          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Triggers</div>
              <button className="text-brand-700 text-xs" onClick={addTrigger}>
                <Plus size={12} className="inline" /> add
              </button>
            </div>
            {triggers.length === 0 && (
              <div className="text-xs text-slate-400">No triggers. Add one to activate this flow.</div>
            )}
            {triggers.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-2 py-1 text-xs rounded bg-slate-50 mt-1">
                <span className="truncate">
                  {t.type === 'any' ? '(any message)' : `"${t.value}"`}
                </span>
                <button onClick={() => removeTrigger(t.id)} className="text-red-500">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => (rfRef.current = inst)}
            onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background gap={18} size={1} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <div className="w-80 border-l border-slate-200 bg-white p-4 overflow-auto">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Inspector</div>
          {!selected ? (
            <div className="text-sm text-slate-400">Select a node to edit its properties.</div>
          ) : (
            <Inspector
              node={selected}
              onChange={updateSelected}
              onDelete={deleteSelected}
              allFlows={allFlows.filter((f) => f.id !== id)}
              allSequences={allSequences}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Inspector({ node, onChange, onDelete, allFlows = [], allSequences = [] }) {
  const { type, data = {} } = node;
  const mediaTypes = ['sendImage', 'sendVideo', 'sendAudio', 'sendDocument', 'sendMedia'];
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase text-slate-400">{type}</div>

      {type === 'trigger' && (
        <div>
          <label className="label">Keyword</label>
          <input
            className="input"
            value={data.keyword || ''}
            onChange={(e) => onChange({ keyword: e.target.value })}
            placeholder="e.g. hi, hello, promo"
          />
          <p className="text-[11px] text-slate-400 mt-2">
            Saving the flow auto-creates a contains-match trigger from this keyword.
          </p>
        </div>
      )}

      {type === 'sendText' && (
        <div>
          <label className="label">Message</label>
          <textarea
            className="input min-h-[120px]"
            value={data.text || ''}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Hello {{phone}} 👋"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Use {'{{phone}}'}, {'{{lastMessage}}'}, or any user attribute like {'{{name}}'}.
          </p>
        </div>
      )}

      {mediaTypes.includes(type) && (
        <>
          <MediaField
            nodeType={type}
            value={data.url || ''}
            onChange={(url) => onChange({ url })}
          />
          {type !== 'sendAudio' && (
            <div>
              <label className="label">Caption</label>
              <textarea
                className="input min-h-[80px]"
                value={data.caption || ''}
                onChange={(e) => onChange({ caption: e.target.value })}
              />
            </div>
          )}
        </>
      )}

      {(type === 'typing' || type === 'recording' || type === 'delay') && (
        <div>
          <label className="label">{type === 'delay' ? 'Delay (ms)' : 'Show for (ms)'}</label>
          <input
            type="number"
            className="input"
            value={data.ms ?? (type === 'delay' ? 1000 : 1500)}
            onChange={(e) => onChange({ ms: Number(e.target.value) })}
          />
        </div>
      )}

      {type === 'setAttribute' && (
        <>
          <div>
            <label className="label">Key</label>
            <input
              className="input"
              value={data.key || ''}
              onChange={(e) => onChange({ key: e.target.value })}
              placeholder="e.g. name, language, stage"
            />
          </div>
          <div>
            <label className="label">Value (supports {'{{lastMessage}}'})</label>
            <input
              className="input"
              value={data.value || ''}
              onChange={(e) => onChange({ value: e.target.value })}
              placeholder="e.g. English or {{lastMessage}}"
            />
          </div>
        </>
      )}

      {type === 'removeAttribute' && (
        <div>
          <label className="label">Key to remove</label>
          <input
            className="input"
            value={data.key || ''}
            onChange={(e) => onChange({ key: e.target.value })}
          />
        </div>
      )}

      {(type === 'subscribeSequence' || type === 'unsubscribeSequence') && (
        <div>
          <label className="label">Sequence</label>
          <select
            className="input"
            value={data.sequenceId || ''}
            onChange={(e) => {
              const seq = allSequences.find((s) => s.id === e.target.value);
              onChange({ sequenceId: e.target.value, sequenceName: seq?.name || '' });
            }}
          >
            <option value="">— pick a sequence —</option>
            {allSequences.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 mt-2">
            Create sequences under <b>Sequences</b> in the sidebar.
          </p>
        </div>
      )}

      {type === 'redirectFlow' && (
        <div>
          <label className="label">Target flow</label>
          <select
            className="input"
            value={data.flowId || ''}
            onChange={(e) => {
              const f = allFlows.find((x) => x.id === e.target.value);
              onChange({ flowId: e.target.value, flowName: f?.name || '' });
            }}
          >
            <option value="">— pick a flow —</option>
            {allFlows.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}

      {type === 'condition' && (
        <div>
          <label className="label">If last message contains</label>
          <input
            className="input"
            value={data.expected || ''}
            onChange={(e) => onChange({ expected: e.target.value })}
            placeholder="yes"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Wire the "yes" and "no" outputs to different branches.
          </p>
        </div>
      )}

      {type === 'abTest' && (
        <div>
          <label className="label">Weight for branch A (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            className="input"
            value={data.weightA ?? 50}
            onChange={(e) => onChange({ weightA: Number(e.target.value) })}
          />
          <p className="text-[11px] text-slate-400 mt-1">B gets the remaining {100 - (Number(data.weightA) || 50)}%.</p>
        </div>
      )}

      <button className="btn-danger w-full justify-center" onClick={onDelete}>
        <Trash2 size={14} /> Delete node
      </button>
    </div>
  );
}

export default function FlowBuilder() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}
