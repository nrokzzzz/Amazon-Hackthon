import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Card } from '../ui.jsx';

export default function Connect() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();

  async function loadStatus() {
    const { data } = await api.get('/calendar/status');
    setStatus(data);
  }

  useEffect(() => {
    loadStatus();
    // Handle OAuth callback redirect (?gcal=connected|error)
    const gcal = params.get('gcal');
    if (gcal === 'connected') setMsg('✅ Google Calendar connected!');
    if (gcal === 'error') setMsg('⚠️ Connection failed — check your Google credentials and try again.');
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
      if (e?.error === 'google_not_configured') {
        setMsg('⚙️ Google OAuth isn\'t configured. Calendar sync will run in simulation mode — the full pipeline still works for the demo.');
      } else {
        setMsg('Could not start Google connection.');
      }
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post('/calendar/sync');
      setMsg(
        `Synced ${data.synced}/${data.total} events${data.simulated ? ' (simulation mode)' : ' to Google Calendar'}.`
      );
    } catch {
      setMsg('Sync failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Connect your Google Calendar</h1>
      <p className="mt-1 text-slate-400">
        Connect once. After that, CampusFlow keeps pushing prioritized events with native reminders —
        you never have to open this app again.
      </p>

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Google Calendar</div>
            <div className="text-sm text-slate-400">
              {status?.connected
                ? `Connected${status.email ? ` as ${status.email}` : ''}`
                : status?.configured
                ? 'Not connected'
                : 'OAuth not configured — sync runs in simulation mode'}
            </div>
          </div>
          {status?.connected ? (
            <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-sm text-emerald-300">Connected</span>
          ) : (
            <Button onClick={connect} disabled={busy}>Connect</Button>
          )}
        </div>
      </Card>

      <Card className="mt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Push events now</div>
            <div className="text-sm text-slate-400">
              Sync all matched, prioritized events with their reminder ladders.
            </div>
          </div>
          <Button variant="success" onClick={syncNow} disabled={busy}>Sync now</Button>
        </div>
      </Card>

      {msg && <div className="mt-4 rounded-lg bg-white/5 px-4 py-3 text-sm text-slate-200">{msg}</div>}

      <div className="mt-8 flex gap-3">
        <Button variant="ghost" onClick={() => nav('/ingest')}>Next: bring in your notices →</Button>
        <Button variant="ghost" onClick={() => nav('/')}>Go to Today</Button>
      </div>
    </div>
  );
}
