import { useEffect, useState } from 'react';
import { socket } from '../lib/socket.js';
import { api } from '../lib/api.js';
import clsx from 'clsx';

const tone = {
  idle:          'chip-ghost',
  qr:            'chip-ochre',
  authenticated: 'chip-azure',
  ready:         'chip-brand',
  disconnected:  'chip-fail',
};
const label = {
  idle:          'Stand By',
  qr:            'Awaiting QR',
  authenticated: 'Authenticated',
  ready:         'On Wire',
  disconnected:  'Off Wire',
};

export default function StatusPill() {
  const [status, setStatus] = useState('idle');
  useEffect(() => {
    api.whatsapp.status().then((s) => setStatus(s.status || 'idle')).catch(() => {});
    const handler = (s) => setStatus(s.status || 'idle');
    socket.on('wa:status', handler);
    return () => socket.off('wa:status', handler);
  }, []);

  return (
    <span className={clsx(tone[status] || tone.idle)}>
      <span className="size-1.5 rounded-full bg-current animate-pulse-soft" />
      {label[status] || status}
    </span>
  );
}
