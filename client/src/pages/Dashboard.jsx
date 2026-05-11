import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Workflow, Users, Send, MessageSquare, ArrowUpRight } from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../lib/api.js';

export default function Dashboard() {
  const [stats, setStats] = useState({ flows: 0, contacts: 0, broadcasts: 0, threads: 0 });

  useEffect(() => {
    Promise.all([
      api.flows.list(),
      api.contacts.list(),
      api.broadcasts.list(),
      api.messages.threads(),
    ])
      .then(([flows, contacts, broadcasts, threads]) =>
        setStats({
          flows: flows.length,
          contacts: contacts.length,
          broadcasts: broadcasts.length,
          threads: threads.length,
        })
      )
      .catch(() => {});
  }, []);

  const cards = [
    { label: 'Flows',         value: stats.flows,      icon: Workflow,       to: '/flows' },
    { label: 'Contacts',      value: stats.contacts,   icon: Users,          to: '/contacts' },
    { label: 'Broadcasts',    value: stats.broadcasts, icon: Send,           to: '/broadcast' },
    { label: 'Conversations', value: stats.threads,    icon: MessageSquare,  to: '/inbox' },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview of your WhatsApp automation." />
      <div className="p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link
            to={c.to}
            key={c.label}
            className="card p-5 hover:border-ink-soft/30 hover:shadow-stamp transition group"
          >
            <div className="flex items-center justify-between">
              <div className="inline-flex p-1.5 rounded-md bg-paper-200 text-ink-soft">
                <c.icon size={15} strokeWidth={1.75} />
              </div>
              <ArrowUpRight size={15} className="text-ink-faint group-hover:text-ink transition-colors" />
            </div>
            <div className="mt-5">
              <div className="text-[28px] font-semibold tracking-tightest text-ink leading-none num">{c.value}</div>
              <div className="text-[12.5px] text-ink-mute mt-1.5">{c.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="px-8 pb-8">
        <div className="card p-6">
          <h3 className="text-[14px] font-semibold text-ink mb-3">Quick start</h3>
          <ol className="text-[13px] text-ink-soft space-y-1.5 list-decimal list-inside marker:text-ink-faint">
            <li>Go to <Link to="/connect" className="text-ink underline underline-offset-4 decoration-ink-faint hover:decoration-ink">Connect</Link> and scan the QR with your WhatsApp.</li>
            <li>Create a flow in <Link to="/flows" className="text-ink underline underline-offset-4 decoration-ink-faint hover:decoration-ink">Flows</Link> — drag nodes, set a keyword trigger, save.</li>
            <li>Import contacts in <Link to="/contacts" className="text-ink underline underline-offset-4 decoration-ink-faint hover:decoration-ink">Contacts</Link> (CSV with <code className="font-mono text-[12px] px-1 bg-paper-200 rounded">name,phone</code>).</li>
            <li>Compose a <Link to="/broadcast" className="text-ink underline underline-offset-4 decoration-ink-faint hover:decoration-ink">Broadcast</Link> and hit start.</li>
          </ol>
        </div>
      </div>
    </>
  );
}
