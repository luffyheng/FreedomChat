import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, QrCode, Workflow, Users, Send, MessageSquare,
  Clock, FolderOpen, LogOut,
} from 'lucide-react';
import clsx from 'clsx';
import { socket } from '../lib/socket.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const navItems = [
  { to: '/',          label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/connect',   label: 'Connect',    icon: QrCode },
  { to: '/flows',     label: 'Flows',      icon: Workflow },
  { to: '/sequences', label: 'Sequences',  icon: Clock },
  { to: '/contacts',  label: 'People',     icon: Users },
  { to: '/lists',     label: 'Lists',      icon: FolderOpen },
  { to: '/broadcast', label: 'Broadcasts', icon: Send },
  { to: '/inbox',     label: 'Inbox',      icon: MessageSquare },
];

const statusDot = {
  ready:         'bg-brand-500',
  authenticated: 'bg-blue-500',
  qr:            'bg-amber-500',
  disconnected:  'bg-red-500',
  idle:          'bg-ink-faint',
};
const statusLabel = {
  ready:         'Connected',
  authenticated: 'Authenticated',
  qr:            'Awaiting QR',
  disconnected:  'Disconnected',
  idle:          'Idle',
};

export default function Sidebar() {
  const [waStatus, setWaStatus] = useState('idle');
  const { user, logout } = useAuth();
  const nav = useNavigate();

  useEffect(() => {
    api.whatsapp.status().then((s) => setWaStatus(s.status || 'idle')).catch(() => {});
    const handler = (s) => setWaStatus(s.status || 'idle');
    socket.on('wa:status', handler);
    return () => socket.off('wa:status', handler);
  }, []);

  const signOut = async () => {
    await logout();
    nav('/login', { replace: true });
  };

  return (
    <aside className="w-[224px] shrink-0 border-r border-ink-line bg-paper-50 flex flex-col">
      {/* Wordmark */}
      <div className="px-5 h-14 flex items-center border-b border-ink-line">
        <div className="flex items-center gap-2.5">
          <Mark />
          <div className="text-[14.5px] font-semibold tracking-tight2 text-ink">
            ChatMamba
          </div>
        </div>
      </div>

      {/* Nav list */}
      <nav className="px-2 py-3 flex-1">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-2.5 px-2.5 h-8 text-[13px] rounded-md transition-colors',
                    isActive
                      ? 'text-ink bg-paper-200 font-medium'
                      : 'text-ink-mute hover:text-ink hover:bg-paper-100'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon
                      size={15}
                      strokeWidth={1.75}
                      className={clsx(isActive ? 'text-ink' : 'text-ink-mute group-hover:text-ink-soft')}
                    />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Status footer */}
      <div className="border-t border-ink-line px-3 py-3 space-y-2">
        <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-paper-100 border border-ink-line">
          <span className={clsx('size-1.5 rounded-full', statusDot[waStatus] || statusDot.idle, waStatus === 'ready' && 'animate-pulse-soft')} />
          <span className="text-[12px] text-ink-soft flex-1 truncate">{statusLabel[waStatus] || waStatus}</span>
          <span className="text-[10px] font-medium text-ink-faint">WA</span>
        </div>
        {user && (
          <div className="flex items-center gap-2 px-2">
            <div className="size-6 rounded-full bg-paper-200 text-ink-soft grid place-items-center text-[10.5px] font-semibold uppercase">
              {(user.email || '?').slice(0, 1)}
            </div>
            <span className="text-[11.5px] text-ink-soft flex-1 truncate" title={user.email}>
              {user.email}
            </span>
            <button
              onClick={signOut}
              className="size-6 rounded-md grid place-items-center text-ink-mute hover:text-ink hover:bg-paper-200 transition-colors"
              title="Sign out"
            >
              <LogOut size={13} strokeWidth={1.75} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0">
      <rect width="22" height="22" rx="6" fill="#09090b" />
      <path
        d="M6 15 L6 7.5 L8.5 7.5 L11 12 L13.5 7.5 L16 7.5 L16 15"
        stroke="#10b981"
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
