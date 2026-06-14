import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const NAV = [
  { to: '/', label: 'Today', icon: '🗓️', end: true },
  { to: '/chat', label: 'Assistant', icon: '💬' },
  { to: '/profile', label: 'Profile', icon: '👤' },
];

export default function Layout({ children }) {
  const { student, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — the OS-like home shell */}
      <aside className="flex w-60 flex-col border-r border-white/10 bg-white/[0.02] p-4">
        <div className="mb-8 px-2">
          <div className="text-xl font-bold tracking-tight">
            Campus<span className="text-indigo-400">Flow</span>
          </div>
          <div className="text-xs text-slate-500">your academic chief-of-staff</div>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-300 hover:bg-white/5'
                }`
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-white/10 pt-4">
          {student && (
            <div className="mb-3 px-2">
              <div className="text-sm font-medium">{student.name}</div>
              <div className="text-xs text-slate-500">
                {student.branch} · Year {student.current_year}
                {student.section ? ` · Sec ${student.section}` : ''}
              </div>
            </div>
          )}
          <button
            onClick={() => {
              logout();
              nav('/login');
            }}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-400 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
