import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, Card, Field, Badge, TagInput, inputCls } from '../ui.jsx';
import { Check, AlertTriangle, Zap } from 'lucide-react';

// --- Google account / email-capture connection card -----------------------
function GoogleAccountCard() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [params, setParams] = useSearchParams();

  async function load() {
    try {
      const { data } = await api.get('/gmail/status');
      setSt(data);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    load();
    // Handle the OAuth callback redirect (?gcal=connected|error).
    const gcal = params.get('gcal');
    if (gcal === 'connected') setMsg('Google account connected — now auto-importing college emails.');
    if (gcal === 'error') setMsg('Connection failed. Check the Google credentials and try again.');
    if (gcal) {
      params.delete('gcal');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.get('/auth/google/connect');
      window.location.href = data.url; // off to Google consent
    } catch (err) {
      const e = err?.response?.data;
      setMsg(
        e?.error === 'google_not_configured'
          ? 'Google OAuth is not configured on the server.'
          : 'Could not start the Google connection.'
      );
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect your Google account? Email importing will stop.')) return;
    setBusy(true);
    setMsg('');
    try {
      await api.post('/auth/google/disconnect');
      setMsg('Disconnected.');
      await load();
    } catch {
      setMsg('Could not disconnect.');
    } finally {
      setBusy(false);
    }
  }

  async function startWatch() {
    setBusy(true);
    setMsg('');
    try {
      await api.post('/gmail/watch');
      setMsg('Watching your inbox — college emails will be captured automatically.');
      await load();
    } catch (err) {
      setMsg(err?.response?.data?.message || 'Could not start email capture.');
    } finally {
      setBusy(false);
    }
  }

  const connected = st?.connected;
  const watching = st?.watching;
  const senders = st?.allowed_senders || [];

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium">Google Account</div>
          <div className="text-sm text-slate-400 light:text-slate-500">
            Connect once to auto-import college emails (and sync your calendar).
          </div>
        </div>
        {connected ? (
          <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Connected</Badge>
        ) : (
          <Badge className="bg-slate-500/15 text-slate-300 border-slate-500/30">Not connected</Badge>
        )}
      </div>

      {connected ? (
        <>
          <div className="rounded-lg bg-white/5 light:bg-slate-900/[0.04] px-4 py-3 text-sm">
            <div className="text-slate-200 light:text-slate-800">{st.email || 'Google account'}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge className={st.calendar_connected ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-500/15 text-slate-300 border-slate-500/30'}>
                {st.calendar_connected ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Calendar</span> : 'Calendar off'}
              </Badge>
              <Badge className={watching ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}>
                {watching ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" />Email capture active</span> : <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Email capture off</span>}
              </Badge>
            </div>
            {senders.length > 0 && (
              <div className="mt-3 text-xs text-slate-500">
                Importing emails from: <span className="text-slate-300 light:text-slate-600">{senders.join(', ')}</span>
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-indigo-500/5 px-3 py-2 text-xs text-slate-400 light:text-slate-500">
            <Zap className="h-4 w-4" />
            <span>
              Calendar reminders are set automatically when emails arrive —{' '}
              <span className="text-slate-300 light:text-slate-600">exams 2 days before</span>,{' '}
              <span className="text-slate-300 light:text-slate-600">placements &amp; deadlines 1 day before</span>. No syncing needed.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!watching && (
              <Button onClick={startWatch} disabled={busy} variant="success">
                {busy ? 'Working…' : 'Start email capture'}
              </Button>
            )}
            <Button onClick={disconnect} disabled={busy} variant="danger">
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center gap-3">
          <Button onClick={connect} disabled={busy}>
            {busy ? 'Working…' : 'Connect Google account'}
          </Button>
          {st && !st.google_configured && (
            <span className="text-xs text-amber-300">Server OAuth not configured.</span>
          )}
        </div>
      )}

      {msg && <div className="rounded-lg bg-white/5 light:bg-slate-900/[0.04] px-4 py-3 text-sm text-slate-200 light:text-slate-800">{msg}</div>}
    </Card>
  );
}

export default function Profile() {
  const { student, setStudent } = useAuth();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const p = student?.profile || {};
  const [form, setForm] = useState({
    section: student?.section || '',
    study_times: p.study_times || [],
    focus_subjects: p.focus_subjects || [],
    goals: p.goals || [],
    areas_of_interest: p.areas_of_interest || [],
  });

  const setList = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  async function save() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.put('/profile', {
        section: form.section || undefined,
        profile: {
          study_times: form.study_times,
          focus_subjects: form.focus_subjects,
          goals: form.goals,
          areas_of_interest: form.areas_of_interest,
        },
      });
      setStudent(data.student);
      setMsg('Saved.');
    } catch {
      setMsg('Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!student) return null;

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <h1 className="text-xl font-bold sm:text-2xl">Profile</h1>
      <p className="mt-1 text-slate-400 light:text-slate-500">Private to you. Powers matching and personalization.</p>

      {/* Google account connection (email import + calendar) */}
      <div className="mt-6">
        <GoogleAccountCard />
      </div>

      <Card className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-slate-500">Name</span><div>{student.name}</div></div>
          <div><span className="text-slate-500">Roll no</span><div>{student.roll_no}</div></div>
          <div><span className="text-slate-500">Branch</span><div>{student.branch}</div></div>
          <div>
            <span className="text-slate-500">Year (derived)</span>
            <div>Year {student.current_year} · passout {student.passout_year}</div>
          </div>
        </div>

        <hr className="border-white/10 light:border-slate-900/10" />

        <Field label="Section">
          <input className={inputCls} value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="A" />
        </Field>
        <Field label="Preferred study times" hint="add multiple · the assistant builds study plans around these">
          <TagInput value={form.study_times} onChange={setList('study_times')} placeholder="e.g. evening, 9pm–11pm, early morning" />
        </Field>
        <Field label="Subjects to focus on / find hard" hint="the assistant gives these more prep time">
          <TagInput value={form.focus_subjects} onChange={setList('focus_subjects')} placeholder="e.g. Mathematics, Chemistry" />
        </Field>
        <Field label="Goals" hint="e.g. placement → coding/dev focus; GATE → core subjects">
          <TagInput value={form.goals} onChange={setList('goals')} placeholder="e.g. placement, GATE" />
        </Field>
        <Field label="Areas of interest">
          <TagInput value={form.areas_of_interest} onChange={setList('areas_of_interest')} placeholder="e.g. ML, web development, robotics" />
        </Field>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          {msg && <span className="text-sm text-slate-400 light:text-slate-500">{msg}</span>}
        </div>
      </Card>
    </div>
  );
}
