import { useRef, useState } from 'react';
import { Upload, Link as LinkIcon, X, FileText, Image as ImageIcon, Video, Music, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';

const kindIcon = {
  sendImage: ImageIcon,
  sendVideo: Video,
  sendAudio: Music,
  sendDocument: FileText,
  sendMedia: ImageIcon,
};

const kindAccept = {
  sendImage: 'image/*',
  sendVideo: 'video/*',
  sendAudio: 'audio/*',
  sendDocument: '*/*',
  sendMedia: 'image/*,video/*,audio/*,application/pdf',
};

export default function MediaField({ nodeType, value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef(null);
  const Icon = kindIcon[nodeType] || ImageIcon;

  const handleFile = async (file) => {
    if (!file) return;
    setUploading(true);
    setProgress(10);
    try {
      // Progress bar is fake since fetch doesn't surface upload progress
      // without XHR. Keep it visually alive.
      const tick = setInterval(() => setProgress((p) => Math.min(90, p + 10)), 200);
      const result = await api.uploads.upload(file);
      clearInterval(tick);
      setProgress(100);
      onChange(result.url);
      toast.success('Uploaded');
    } catch (e) {
      toast.error(e.message || 'Upload failed');
    } finally {
      setUploading(false);
      setTimeout(() => setProgress(0), 500);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleDownload = async (url) => {
    if (!url) return;
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0] || 'download');
    try {
      // Fetch as blob — works for same-origin /uploads/* and any
      // CORS-allowed remote URL. Forces a real download instead of
      // opening the file in a new tab.
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (e) {
      // Fallback — open in new tab so the user can long-press / right-click → save
      toast.error('Direct download blocked — opened in new tab instead');
      window.open(url, '_blank', 'noopener');
    }
  };

  const isImage = nodeType === 'sendImage' || (value && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(value));
  const isVideo = nodeType === 'sendVideo' || (value && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(value));
  const isAudio = nodeType === 'sendAudio' || (value && /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(value));

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative border border-ink/15 bg-paper-100 p-2">
          {isImage && <img src={value} alt="" className="max-h-44 mx-auto" />}
          {isVideo && <video src={value} controls className="max-h-44 w-full" />}
          {isAudio && <audio src={value} controls className="w-full" />}
          {!isImage && !isVideo && !isAudio && (
            <div className="flex items-center gap-2 text-[13px] text-ink-soft p-2">
              <FileText size={14} />
              <span className="truncate flex-1">{value.split('/').pop()}</span>
            </div>
          )}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleDownload(value)}
              className="p-1 bg-paper-50 border border-ink/20 text-ink-soft hover:text-ink hover:border-ink transition"
              title="Download"
            >
              <Download size={11} />
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="p-1 bg-paper-50 border border-ink/20 text-ink-soft hover:text-stamp-vermillion hover:border-stamp-vermillion transition"
              title="Remove"
            >
              <X size={11} />
            </button>
          </div>
        </div>
      ) : (
        <label
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="flex flex-col items-center justify-center gap-2 border border-dashed border-ink/25 hover:border-ink hover:bg-ink/[0.02] p-6 cursor-pointer transition"
        >
          <Icon size={20} strokeWidth={1.5} className="text-ink-mute" />
          <div className="text-[11.5px] text-ink-soft text-center">
            {uploading ? (
              <>Uploading <span className="font-mono">{progress}%</span></>
            ) : (
              <>
                <span className="text-ink font-medium underline underline-offset-4 decoration-ink/40">Click to upload</span>
                <span className="block num text-[10px] text-ink-mute mt-1">or drag &amp; drop</span>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={kindAccept[nodeType] || '*/*'}
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      )}

      <details className="text-[11px] text-ink-mute">
        <summary className="cursor-pointer select-none flex items-center gap-1 py-1 hover:text-ink transition">
          <LinkIcon size={10} /> Or paste a URL
        </summary>
        <input
          className="input mt-1.5"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
        />
      </details>

      {uploading && progress > 0 && (
        <div className="h-px w-full bg-ink/10">
          <div className="h-full bg-ink transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
