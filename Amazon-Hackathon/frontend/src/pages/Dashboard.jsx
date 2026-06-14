import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import {
  Button, Card, ImportanceBadge, Badge, TYPE_ICONS,
  formatWhen, formatLadder,
} from '../ui.jsx';

const QUADRANT_LABEL = {
  important_urgent: 'Do now',
  important_not_urgent: 'Plan / prep',
  not_important_urgent: 'Quick ack',
  not_important_not_urgent: 'FYI',
};

function AttendanceWidget() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get('/portal/attendance').then(({ data }) => setRows(data.attendance)).catch(() => {});
  }, []);
  const shortage = rows.filter((r) => r.status !== 'ok');
  if (!shortage.length) return null;
  return (
    <Card className="border-red-500/20 bg-red-500/[0.04]">
      <div className="mb-2 flex items-center gap-2 font-medium text-red-200">📉 Attendance watch</div>
      <div className="space-y-2">
        {shortage.map((r) => (
          <div key={r.code} className="flex items-center justify-between text-sm">
            <span className="text-slate-200">{r.course}</span>
            <span className={r.status === 'shortage' ? 'text-red-300' : 'text-orange-300'}>
              {r.percent}%{' '}
              {r.status === 'shortage'
                ? `— below the ${r.threshold}% requirement, debarment risk`
                : `— close to the ${r.threshold}% limit`}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EventRow({ ev, onChange }) {
  const [editing, setEditing] = useState(false);
  const [imp, setImp] = useState(ev.importance);
  const [busy, setBusy] = useState(false);

  async function act(body) {
    setBusy(true);
    try {
      await api.put(`/events/${ev.id}`, body);
      await onChange();
    } finally {
      setBusy(false);
      setEditing(false);
    }
  }

  const dimmed = ev.state === 'dismissed';

  return (
    <div className={`rounded-xl border border-white/10 p-4 ${dimmed ? 'opacity-40' : 'bg-white/[0.02]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg">{TYPE_ICONS[ev.type] || '📌'}</span>
            <span className="font-medium text-slate-100">{ev.title}</span>
            <ImportanceBadge importance={ev.importance} />
            {ev.state === 'confirmed' && <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">confirmed</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>🕒 {formatWhen(ev.datetime)}</span>
            {ev.course && <span>· {ev.course}</span>}
            <span>· {QUADRANT_LABEL[ev.quadrant]}</span>
            <span>· priority {ev.priority_score}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            🔔 reminders: {formatLadder(ev.reminder_ladder) || '—'}
            {ev.sync_status === 'synced' && <span className="ml-2 text-emerald-400">· synced</span>}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex items-center gap-2">
          <select
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm"
            value={imp}
            onChange={(e) => setImp(e.target.value)}
          >
            {['critical', 'high', 'med', 'low'].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <Button onClick={() => act({ importance: imp, resync: true })} disabled={busy}>Save & re-sync</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {ev.state !== 'confirmed' && (
            <Button variant="success" onClick={() => act({ state: 'confirmed', resync: true })} disabled={busy}>Confirm & sync</Button>
          )}
          <Button variant="ghost" onClick={() => setEditing(true)} disabled={busy}>Edit priority</Button>
          {ev.state !== 'dismissed' ? (
            <Button variant="ghost" onClick={() => act({ state: 'dismissed' })} disabled={busy}>Dismiss</Button>
          ) : (
            <Button variant="ghost" onClick={() => act({ state: 'pending' })} disabled={busy}>Restore</Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/events');
    setEvents(data.events);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function syncAll() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { data } = await api.post('/calendar/sync');
      setSyncMsg(`Synced ${data.synced}/${data.total}${data.simulated ? ' (simulation)' : ' to Google Calendar'}.`);
      await load();
    } catch {
      setSyncMsg('Sync failed.');
    } finally {
      setSyncing(false);
    }
  }

  const active = events.filter((e) => e.state !== 'dismissed');
  const dismissed = events.filter((e) => e.state === 'dismissed');

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">Today</h1>
          <p className="text-sm text-slate-400 sm:text-base">What matters to you, ranked. Highest priority first.</p>
        </div>
        <Button variant="success" onClick={syncAll} disabled={syncing || !active.length}>
          {syncing ? 'Syncing…' : 'Sync all to Calendar'}
        </Button>
      </div>

      {syncMsg && <div className="mt-3 rounded-lg bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">{syncMsg}</div>}

      <div className="mt-6 space-y-4">
        <AttendanceWidget />

        {loading ? (
          <div className="text-slate-500">Loading…</div>
        ) : (
          active.map((ev) => <EventRow key={ev.id} ev={ev} onChange={load} />)
        )}

        {dismissed.length > 0 && (
          <div>
            <div className="mb-2 mt-6 text-xs uppercase tracking-wide text-slate-500">Dismissed</div>
            {dismissed.map((ev) => <EventRow key={ev.id} ev={ev} onChange={load} />)}
          </div>
        )}
      </div>
    </div>
  );
}
