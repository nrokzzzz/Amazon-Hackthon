import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const NAV = [
  { to: '/', label: 'Today', icon: '🗓️', end: true },
  { to: '/tasks', label: 'Priorities', icon: '🎯' },
  { to: '/chat', label: 'Assistant', icon: '💬' },
  { to: '/profile', label: 'Profile', icon: '👤' },
];

export default function Layout({ children }) {
  const { student, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false); // mobile drawer

  const Brand = () => (
    <div className="text-xl font-bold tracking-tight">
      Campus<span className="text-indigo-400">Flow</span>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-[#0b0f1a]/95 px-4 py-3 backdrop-blur md:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-lg px-2 py-1 text-xl text-slate-200 hover:bg-white/10"
        >
          ☰
        </button>
        <Brand />
      </div>

      {/* Backdrop when the mobile drawer is open */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}

      {/* Sidebar — static on desktop, slide-over drawer on mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/10 bg-[#0b0f1a] p-4 transition-transform duration-200 md:static md:w-60 md:translate-x-0 md:bg-white/[0.02] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-8 flex items-center justify-between px-2">
          <div>
            <Brand />
            <div className="text-xs text-slate-500">your academic chief-of-staff</div>
          </div>
          {/* Close button (mobile only) */}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 md:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
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

      {/* Content — offset below the fixed top bar on mobile only */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0">{children}</main>
    </div>
  );
}
