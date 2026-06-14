import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, Card, Field, inputCls } from '../ui.jsx';

export default function Login() {
  const { login } = useAuth();
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
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold">
            Campus<span className="text-indigo-400">Flow</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">Welcome back.</p>
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
            {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-sm text-slate-400">
          New here? <Link to="/register" className="text-indigo-300">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
