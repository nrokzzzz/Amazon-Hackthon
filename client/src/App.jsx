import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Register from './pages/Register.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import Chat from './pages/Chat.jsx';
import Tasks from './pages/Tasks.jsx';

function Protected({ children }) {
  const { student, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-slate-500">Loading…</div>;
  if (!student) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { student, loading } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={student && !loading ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={student && !loading ? <Navigate to="/" replace /> : <Register />} />

      {/* Today + Priorities are merged into a single "My Tasks" page at "/". */}
      <Route path="/" element={<Protected><Tasks /></Protected>} />
      <Route path="/chat" element={<Protected><Chat /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/tasks" element={<Navigate to="/" replace />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
