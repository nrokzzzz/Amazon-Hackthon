import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { Button, Card, Field, inputCls } from '../ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const { theme, toggle } = useTheme();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/login', form);
      login(data.token, data.student);
      nav('/');
    } catch (err) {
      setError(err?.response?.data?.error || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <button
        onClick={toggle}
        aria-label="Toggle light/dark theme"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="fixed right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 light:border-slate-900/15 light:bg-slate-900/[0.04] light:text-slate-600 light:hover:bg-slate-900/[0.08]"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* Left — image / branding panel (hidden on small screens) */}
      <div className="relative hidden overflow-hidden lg:block">
        <img
          src="https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80"
          alt="Students collaborating on campus"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-900/75" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <div className="text-2xl font-bold">
            Campus<span className="text-indigo-300">Flow</span>
          </div>
          <div>
            <h2 className="max-w-md text-3xl font-bold leading-tight">
              Your personalized campus advisor.
            </h2>
            <p className="mt-3 max-w-md text-sm text-slate-200/90">
              Priority notifications and student support at scale — never miss what matters.
            </p>
          </div>
        </div>
      </div>

      {/* Right — login form */}
      <div className="grid place-items-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="text-4xl font-bold">
              Campus<span className="text-indigo-400">Flow</span>
            </div>
            <p className="mt-1 text-sm text-slate-400 light:text-slate-500">Welcome back.</p>
          </div>
          <Card>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Email">
                <input type="email" className={inputCls} value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              </Field>
              <Field label="Password">
                <input type="password" className={inputCls} value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </Field>
              {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 light:text-red-700">{error}</div>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </Card>
          <p className="mt-4 text-center text-sm text-slate-400 light:text-slate-500">
            New here? <Link to="/register" className="text-indigo-300 light:text-indigo-600">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
