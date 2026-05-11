import { Handle, Position } from '@xyflow/react';
import {
  Zap,
  MessageSquare,
  Image,
  Video,
  Mic,
  FileText,
  Timer,
  GitBranch,
  CheckCircle2,
  Activity,
  UserCog,
  UserMinus,
  Clock,
  CornerDownRight,
  Shuffle,
} from 'lucide-react';

function Shell({ icon: Icon, color, title, children, hasInput = true, hasOutput = true, selected }) {
  return (
    <div className={`node-card ${selected ? 'selected' : ''}`}>
      {hasInput && <Handle type="target" position={Position.Left} />}
      <div className="node-header">
        <span className={`w-6 h-6 rounded grid place-items-center ${color}`}>
          <Icon size={13} />
        </span>
        <span className="truncate">{title}</span>
      </div>
      <div className="node-body">{children}</div>
      {hasOutput && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

export function TriggerNode({ data, selected }) {
  return (
    <Shell icon={Zap} color="bg-amber-100 text-amber-700" title="Trigger" hasInput={false} selected={selected}>
      <div className="text-xs text-slate-500">Keyword</div>
      <div className="font-medium text-slate-700 truncate">{data?.keyword || '(any message)'}</div>
    </Shell>
  );
}

export function SendTextNode({ data, selected }) {
  return (
    <Shell icon={MessageSquare} color="bg-brand-100 text-brand-700" title="Send Text" selected={selected}>
      <div className="line-clamp-3 whitespace-pre-wrap text-slate-700 text-[13px]">
        {data?.text || <span className="italic text-slate-400">Click to edit…</span>}
      </div>
    </Shell>
  );
}

function MediaLike({ icon, color, title, data, selected }) {
  return (
    <Shell icon={icon} color={color} title={title} selected={selected}>
      <div className="text-xs text-slate-500 truncate">URL</div>
      <div className="text-[13px] text-slate-700 truncate">{data?.url || '—'}</div>
      {data?.caption && (
        <div className="text-[12px] text-slate-500 mt-1 line-clamp-2">{data.caption}</div>
      )}
    </Shell>
  );
}

export function SendImageNode(props) {
  return <MediaLike {...props} icon={Image} color="bg-purple-100 text-purple-700" title="Image" />;
}
export function SendVideoNode(props) {
  return <MediaLike {...props} icon={Video} color="bg-fuchsia-100 text-fuchsia-700" title="Video" />;
}
export function SendAudioNode(props) {
  return <MediaLike {...props} icon={Mic} color="bg-pink-100 text-pink-700" title="Audio" />;
}
export function SendDocumentNode(props) {
  return <MediaLike {...props} icon={FileText} color="bg-indigo-100 text-indigo-700" title="Document" />;
}
// Backwards-compatible generic media
export function SendMediaNode(props) {
  return <MediaLike {...props} icon={Image} color="bg-purple-100 text-purple-700" title="Send Media" />;
}

export function TypingNode({ data, selected }) {
  return (
    <Shell icon={Activity} color="bg-sky-100 text-sky-700" title="Typing…" selected={selected}>
      <div className="text-slate-700 text-[13px]">{(Number(data?.ms) || 1500).toLocaleString()} ms</div>
    </Shell>
  );
}

export function RecordingNode({ data, selected }) {
  return (
    <Shell icon={Mic} color="bg-rose-100 text-rose-700" title="Recording…" selected={selected}>
      <div className="text-slate-700 text-[13px]">{(Number(data?.ms) || 1500).toLocaleString()} ms</div>
    </Shell>
  );
}

export function DelayNode({ data, selected }) {
  return (
    <Shell icon={Timer} color="bg-blue-100 text-blue-700" title="Delay" selected={selected}>
      <div className="text-slate-700 text-[13px]">{(Number(data?.ms) || 1000).toLocaleString()} ms</div>
    </Shell>
  );
}

export function SetAttributeNode({ data, selected }) {
  return (
    <Shell icon={UserCog} color="bg-emerald-100 text-emerald-700" title="Set Attribute" selected={selected}>
      <div className="text-[13px] text-slate-700 truncate">
        <b>{data?.key || 'key'}</b> = {data?.value || '—'}
      </div>
    </Shell>
  );
}

export function RemoveAttributeNode({ data, selected }) {
  return (
    <Shell icon={UserMinus} color="bg-slate-100 text-slate-700" title="Remove Attribute" selected={selected}>
      <div className="text-[13px] text-slate-700 truncate">{data?.key || '—'}</div>
    </Shell>
  );
}

export function SubscribeSequenceNode({ data, selected }) {
  return (
    <Shell icon={Clock} color="bg-teal-100 text-teal-700" title="Subscribe Sequence" selected={selected}>
      <div className="text-[13px] text-slate-700 truncate">{data?.sequenceName || data?.sequenceId || 'Pick a sequence…'}</div>
    </Shell>
  );
}

export function UnsubscribeSequenceNode({ data, selected }) {
  return (
    <Shell icon={Clock} color="bg-slate-100 text-slate-700" title="Unsubscribe Sequence" selected={selected}>
      <div className="text-[13px] text-slate-700 truncate">{data?.sequenceName || data?.sequenceId || 'Pick a sequence…'}</div>
    </Shell>
  );
}

export function RedirectFlowNode({ data, selected }) {
  return (
    <Shell icon={CornerDownRight} color="bg-amber-100 text-amber-700" title="Redirect to Flow" selected={selected}>
      <div className="text-[13px] text-slate-700 truncate">{data?.flowName || data?.flowId || 'Pick a flow…'}</div>
    </Shell>
  );
}

export function ConditionNode({ data, selected }) {
  return (
    <div className={`node-card ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        <span className="w-6 h-6 rounded grid place-items-center bg-rose-100 text-rose-700">
          <GitBranch size={13} />
        </span>
        <span>If / Else</span>
      </div>
      <div className="node-body">
        <div className="text-xs text-slate-500">Contains</div>
        <div className="font-medium text-slate-700 truncate">{data?.expected || '—'}</div>
      </div>
      <div className="px-3 pb-3 text-[11px] text-slate-500 flex justify-between">
        <span>yes ↗</span>
        <span>↘ no</span>
      </div>
      <Handle id="yes" type="source" position={Position.Right} style={{ top: '60%' }} />
      <Handle id="no" type="source" position={Position.Right} style={{ top: '85%' }} />
    </div>
  );
}

export function AbTestNode({ data, selected }) {
  const w = Number(data?.weightA ?? 50);
  return (
    <div className={`node-card ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        <span className="w-6 h-6 rounded grid place-items-center bg-orange-100 text-orange-700">
          <Shuffle size={13} />
        </span>
        <span>A/B Test</span>
      </div>
      <div className="node-body">
        <div className="text-xs text-slate-500">Split</div>
        <div className="font-medium text-slate-700">A {w}% · B {100 - w}%</div>
      </div>
      <div className="px-3 pb-3 text-[11px] text-slate-500 flex justify-between">
        <span>A ↗</span>
        <span>↘ B</span>
      </div>
      <Handle id="a" type="source" position={Position.Right} style={{ top: '60%' }} />
      <Handle id="b" type="source" position={Position.Right} style={{ top: '85%' }} />
    </div>
  );
}

export function EndNode({ selected }) {
  return (
    <Shell icon={CheckCircle2} color="bg-slate-100 text-slate-600" title="End" hasOutput={false} selected={selected}>
      <div className="text-xs text-slate-500">Flow ends here</div>
    </Shell>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  sendText: SendTextNode,
  sendImage: SendImageNode,
  sendVideo: SendVideoNode,
  sendAudio: SendAudioNode,
  sendDocument: SendDocumentNode,
  sendMedia: SendMediaNode,
  typing: TypingNode,
  recording: RecordingNode,
  delay: DelayNode,
  setAttribute: SetAttributeNode,
  removeAttribute: RemoveAttributeNode,
  subscribeSequence: SubscribeSequenceNode,
  unsubscribeSequence: UnsubscribeSequenceNode,
  redirectFlow: RedirectFlowNode,
  condition: ConditionNode,
  abTest: AbTestNode,
  end: EndNode,
};
