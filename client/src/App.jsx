import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Connect from './pages/Connect.jsx';
import Flows from './pages/Flows.jsx';
import FlowBuilder from './pages/FlowBuilder.jsx';
import Contacts from './pages/Contacts.jsx';
import Broadcast from './pages/Broadcast.jsx';
import Inbox from './pages/Inbox.jsx';
import Sequences from './pages/Sequences.jsx';
import SequenceDetail from './pages/SequenceDetail.jsx';
import Lists from './pages/Lists.jsx';
import ListDetail from './pages/ListDetail.jsx';
import Login from './pages/Login.jsx';
import Forgot from './pages/Forgot.jsx';
import Reset from './pages/Reset.jsx';
import { AuthProvider, useAuth } from './lib/auth.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset/:token" element={<Reset />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) {
    return (
      <div className="h-full grid place-items-center text-[13px] text-ink-mute">
        Loading…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  }
  return children;
}

function Shell() {
  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="flex-1 overflow-auto relative">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/flows/:id" element={<FlowBuilder />} />
          <Route path="/sequences" element={<Sequences />} />
          <Route path="/sequences/:id" element={<SequenceDetail />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/lists" element={<Lists />} />
          <Route path="/lists/:id" element={<ListDetail />} />
          <Route path="/broadcast" element={<Broadcast />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
