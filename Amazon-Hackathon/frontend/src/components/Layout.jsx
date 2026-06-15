import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ListChecks, Sparkles, ChevronDown, GraduationCap, User, LogOut, Sun, Moon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';

const NAV = [
  { to: '/', label: 'My Tasks', Icon: ListChecks, end: true },
  { to: '/chat', label: 'Assistant', Icon: Sparkles },
];

export default function Layout({ children }) {
  const { student, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false); // account dropdown

  const initials = (student?.name || '?')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    // Fixed-height column so the Assistant page can own its own scroll (h-full),
    // while every other page scrolls inside <main>.
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="shrink-0 border-b border-white/10 bg-[#0b0f1a]/95 backdrop-blur light:border-slate-900/10 light:bg-white/90">
        {/* Single row: brand (left) · tabs (center) · theme + account (right) */}
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-400 to-fuchsia-500 shadow-lg shadow-indigo-500/20">
              <GraduationCap className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="text-lg font-bold tracking-tight">
                Campus<span className="text-indigo-400">Flow</span>
              </div>
              <div className="hidden text-[11px] text-slate-500 sm:block">your academic chief-of-staff</div>
            </div>
          </div>

          {/* Tabs — centered between the brand and the account menu. */}
          <nav className="flex flex-1 items-center justify-center gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-indigo-500/20 text-white light:bg-indigo-500/15 light:text-indigo-700'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 light:text-slate-500 light:hover:bg-slate-900/[0.04] light:hover:text-slate-700'
                  }`
                }
              >
                <n.Icon className="h-4 w-4" />
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={toggle}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle light/dark theme"
              className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 light:border-slate-900/15 light:bg-slate-900/[0.04] light:text-slate-600 light:hover:bg-slate-900/[0.08]"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* Account menu — Profile lives here now (moved out of the tabs). */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-2.5 text-sm transition hover:bg-white/10 sm:pr-3 light:border-slate-900/15 light:bg-slate-900/[0.04] light:hover:bg-slate-900/[0.08]"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-indigo-500/30 text-xs font-semibold text-indigo-100 light:text-indigo-700">
                  {initials}
                </span>
                <span className="hidden max-w-[120px] truncate text-slate-200 sm:block light:text-slate-700">
                  {student?.name || 'Account'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </button>

              {menuOpen && (
                <>
                  {/* Click-away backdrop */}
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
                  <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#0b0f1a] shadow-xl shadow-black/40 light:border-slate-900/10 light:bg-white light:shadow-slate-900/10">
                    {student && (
                      <div className="border-b border-white/10 px-4 py-3 light:border-slate-900/10">
                        <div className="text-sm font-medium text-slate-100 light:text-slate-800">{student.name}</div>
                        <div className="text-xs text-slate-500">
                          {student.branch} · Year {student.current_year}
                          {student.section ? ` · Sec ${student.section}` : ''}
                        </div>
                      </div>
                    )}
                    <NavLink
                      to="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-300 transition hover:bg-white/5 light:text-slate-600 light:hover:bg-slate-900/[0.04]"
                    >
                      <User className="h-4 w-4" /> Profile
                    </NavLink>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        logout();
                        nav('/login');
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/5 light:text-slate-600 light:hover:bg-slate-900/[0.04]"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
