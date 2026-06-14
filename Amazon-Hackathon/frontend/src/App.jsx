import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Register from './pages/Register.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
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

      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/tasks" element={<Protected><Tasks /></Protected>} />
      <Route path="/chat" element={<Protected><Chat /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
