import { NavLink } from 'react-router-dom';
import { Zap, MessageSquare, Send, LayoutDashboard } from 'lucide-react';

const tabs = [
  { to: '/quick-replies', icon: Zap,           label: 'Quick Send' },
  { to: '/inbox',         icon: MessageSquare, label: 'Inbox' },
  { to: '/broadcast',     icon: Send,          label: 'Broadcast' },
  { to: '/',              icon: LayoutDashboard, label: 'Dashboard', end: true },
];

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 flex"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {tabs.map(({ to, icon: Icon, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center pt-2 pb-1.5 gap-0.5 text-[10px] font-medium transition-colors ${
              isActive ? 'text-[#075e54]' : 'text-gray-400'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
