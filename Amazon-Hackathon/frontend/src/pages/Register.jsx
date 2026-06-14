import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, Card, Field, inputCls } from '../ui.jsx';

const BRANCHES = ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'AIML', 'AIDS'];

export default function Register() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [showEnrich, setShowEnrich] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', password: '',
    branch: 'CSE', roll_no: '', passout_year: 2027, section: '',
  });
  const [enrich, setEnrich] = useState({
    preferable_study_time: '', focus_subjects: '', goals: '', areas_of_interest: '',
  });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const profile = {
        preferable_study_time: enrich.preferable_study_time || undefined,
        focus_subjects: enrich.focus_subjects ? toList(enrich.focus_subjects) : undefined,
        goals: enrich.goals ? toList(enrich.goals) : undefined,
        areas_of_interest: enrich.areas_of_interest ? toList(enrich.areas_of_interest) : undefined,
      };
      const { data } = await api.post('/auth/register', {
        ...form,
        passout_year: Number(form.passout_year),
        section: form.section || undefined,
        profile,
      });
      login(data.token, data.student);
      nav('/profile');
    } catch (err) {
      setError(err?.response?.data?.error || 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold">
            Campus<span className="text-indigo-400">Flow</span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Register once. We watch the chaos and feed your Google Calendar.
          </p>
        </div>

        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name">
                <input className={inputCls} value={form.name} onChange={set('name')} required />
              </Field>
              <Field label="Roll number">
                <input className={inputCls} value={form.roll_no} onChange={set('roll_no')} required />
              </Field>
            </div>

            <Field label="Email">
              <input type="email" className={inputCls} value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="Password" hint="At least 6 characters">
              <input type="password" className={inputCls} value={form.password} onChange={set('password')} required />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Branch">
                <select className={inputCls} value={form.branch} onChange={set('branch')}>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </Field>
              <Field label="Passout year" hint="We derive your year">
                <input type="number" className={inputCls} value={form.passout_year} onChange={set('passout_year')} required />
              </Field>
              <Field label="Section" hint="optional">
                <input className={inputCls} value={form.section} onChange={set('section')} placeholder="A" />
              </Field>
            </div>

            {/* Optional enrichment — skippable to keep the required form short */}
            <button
              type="button"
              onClick={() => setShowEnrich((s) => !s)}
              className="text-sm text-indigo-300 hover:text-indigo-200"
            >
              {showEnrich ? '− Hide' : '+ Add'} optional details (helps us personalize)
            </button>

            {showEnrich && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <Field label="Preferred study time" hint="e.g. evening, 9pm–11pm">
                  <input className={inputCls} value={enrich.preferable_study_time}
                    onChange={(e) => setEnrich({ ...enrich, preferable_study_time: e.target.value })} />
                </Field>
                <Field label="Subjects to focus on / improve" hint="comma-separated">
                  <input className={inputCls} value={enrich.focus_subjects}
                    onChange={(e) => setEnrich({ ...enrich, focus_subjects: e.target.value })} placeholder="DBMS, OS" />
                </Field>
                <Field label="Goals" hint="placement, GATE, higher studies…">
                  <input className={inputCls} value={enrich.goals}
                    onChange={(e) => setEnrich({ ...enrich, goals: e.target.value })} placeholder="placement" />
                </Field>
                <Field label="Areas of interest" hint="comma-separated">
                  <input className={inputCls} value={enrich.areas_of_interest}
                    onChange={(e) => setEnrich({ ...enrich, areas_of_interest: e.target.value })} placeholder="ML, robotics" />
                </Field>
              </div>
            )}

            {error && <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-sm text-slate-400">
          Already have an account? <Link to="/login" className="text-indigo-300">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
