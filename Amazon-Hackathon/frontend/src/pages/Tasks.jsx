import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, FileText, CreditCard, TrendingDown, Briefcase, School, Bus, Home,
  PartyPopper, Pin, Clock, IndianRupee, MapPin, AlertTriangle, CalendarCheck, Layers, Bell,
} from 'lucide-react';
import { api } from '../api.js';
import { Card, Badge, ImportanceBadge, formatWhen, formatLadder, Button, TYPE_ICONS } from '../ui.jsx';

// Per-category icon (lucide component) + label for the cards.
const CAT = {
  exam_timetable: { Icon: ClipboardList, label: 'Exam' },
  assignment_deadlines: { Icon: FileText, label: 'Assignment' },
  fees: { Icon: CreditCard, label: 'Fee' },
  attendance: { Icon: TrendingDown, label: 'Attendance' },
  placement_prep: { Icon: Briefcase, label: 'Placement' },
  class_timetable: { Icon: School, label: 'Class' },
  transport: { Icon: Bus, label: 'Transport' },
  hostel_notices: { Icon: Home, label: 'Hostel' },
  club_events: { Icon: PartyPopper, label: 'Club / Event' },
  general: { Icon: Pin, label: 'Notice' },
};

const QUADRANT_LABEL = {
  important_urgent: 'Do now',
  important_not_urgent: 'Plan / prep',
  not_important_urgent: 'Quick ack',
  not_important_not_urgent: 'FYI',
};

// "today" / "tomorrow" / "in 3d" / "past" pill from days_until.
function dueChip(d) {
  if (d == null) return null;
  const { text, cls } =
    d < 0
      ? { text: 'past', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' }
      : d === 0
      ? { text: 'today', cls: 'bg-red-500/15 text-red-300 border-red-500/30' }
      : d === 1
      ? { text: 'tomorrow', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' }
      : d <= 3
      ? { text: `in ${d}d`, cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
      : { text: `in ${d}d`, cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' };
  return <Badge className={cls}>{text}</Badge>;
}

// One scheduled event: confirm / edit priority / dismiss, optionally re-syncing
// to Google Calendar. Operates on the /events (StudentEvent) control center.
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
  const TypeIcon = TYPE_ICONS[ev.type] || Pin;

  return (
    <div
      className={`rounded-xl border border-white/10 p-4 light:border-slate-900/10 ${
        dimmed ? 'opacity-40' : 'bg-white/[0.02] light:bg-white light:shadow-sm'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TypeIcon className="h-4 w-4 text-slate-300 light:text-slate-500" />
            <span className="font-medium text-slate-100 light:text-slate-800">{ev.title}</span>
            <ImportanceBadge importance={ev.importance} />
            {ev.state === 'confirmed' && <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">confirmed</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 light:text-slate-500">
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatWhen(ev.datetime)}</span>
            {ev.course && <span>· {ev.course}</span>}
            <span>· {QUADRANT_LABEL[ev.quadrant]}</span>
            <span>· priority {ev.priority_score}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><Bell className="h-3.5 w-3.5" />reminders: {formatLadder(ev.reminder_ladder) || '—'}</span>
            {ev.sync_status === 'synced' && <span className="ml-2 text-emerald-400">· synced</span>}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex items-center gap-2">
          <select
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm light:border-slate-900/15 light:bg-white light:text-slate-900"
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

function TaskCard({ t }) {
  const cat = CAT[t.category] || CAT.general;
  return (
    <Card className="h-full p-4">
      <div className="flex items-start gap-3">
        <cat.Icon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-100 break-words light:text-slate-800">{t.title}</span>
            <ImportanceBadge importance={t.importance} />
            <Badge className="border-white/10 bg-white/5 text-slate-300 light:border-slate-900/10 light:bg-slate-900/[0.04] light:text-slate-600">{cat.label}</Badge>
            {dueChip(t.days_until)}
            {t.on_calendar && (
              <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                <CalendarCheck className="h-3 w-3" /> calendar
              </Badge>
            )}
          </div>

          {t.summary && <p className="mt-1 text-sm text-slate-400 break-words light:text-slate-500">{t.summary}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 light:text-slate-500">
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatWhen(t.datetime)}</span>
            {t.amount && <span className="inline-flex items-center gap-1"><IndianRupee className="h-3.5 w-3.5" />{t.amount}</span>}
            {t.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{t.location}</span>}
            {t.action_required && (
              <span className="inline-flex items-center gap-1.5 text-amber-300 light:text-amber-600">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />action required
              </span>
            )}
          </div>

          {t.alert && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-200 light:text-red-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{t.alert}
            </div>
          )}
          {t.overlap && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-300/80 light:text-amber-600">
              <Layers className="h-3.5 w-3.5 shrink-0" />{t.overlap.note}
            </div>
          )}
          {t.link && (
            <a
              href={t.link}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-indigo-300 hover:underline light:text-indigo-600"
            >
              Open link →
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Scheduled-events control center (from the old Today page).
  const [events, setEvents] = useState([]);

  const loadTasks = useCallback(async () => {
    try {
      const { data } = await api.get('/college-info/tasks');
      setTasks(data.tasks || []);
      setAlerts(data.alerts || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const { data } = await api.get('/events');
      setEvents(data.events || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => { loadTasks(); loadEvents(); }, [loadTasks, loadEvents]);

  const activeEvents = events.filter((e) => e.state !== 'dismissed');
  const dismissedEvents = events.filter((e) => e.state === 'dismissed');

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">My Tasks</h1>
        <p className="mt-1 text-sm text-slate-400 light:text-slate-500">
          Today's priorities and everything from your college emails, ranked by what matters most.
        </p>
      </div>

      {/* Urgent alerts up top */}
      {alerts.length > 0 && (
        <div className="mt-5 space-y-2">
          {alerts.map((a) => (
            <div
              key={a._id || a.title}
              className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200 light:text-red-700"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />{a.alert}
            </div>
          ))}
        </div>
      )}

      {/* Priorities — 3 cards per row, already priority-sorted by the API. */}
      {loading ? (
        <div className="mt-6 text-slate-500">Loading…</div>
      ) : tasks.length === 0 ? (
        <Card className="mt-6 text-center">
          <div className="text-slate-300 light:text-slate-700">No tasks yet.</div>
          <p className="mt-1 text-sm text-slate-500">
            Connect your Google account so college emails are imported and prioritized automatically.
          </p>
          <Link
            to="/profile"
            className="mt-4 inline-block rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Connect account
          </Link>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tasks.map((t) => <TaskCard key={t._id || t.title} t={t} />)}
        </div>
      )}

      {/* Scheduled events & calendar — confirm / edit / dismiss / sync. */}
      {events.length > 0 && (
        <details className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-4 light:border-slate-900/10 light:bg-white light:shadow-sm">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-200 light:text-slate-700">
            Scheduled events &amp; calendar <span className="text-slate-500">({activeEvents.length})</span>
          </summary>
          <p className="mt-1 text-xs text-slate-500">
            Confirm, edit priority, dismiss, or push these to your Google Calendar.
          </p>
          <div className="mt-4 space-y-3">
            {activeEvents.map((ev) => <EventRow key={ev.id} ev={ev} onChange={loadEvents} />)}
            {dismissedEvents.length > 0 && (
              <div>
                <div className="mb-2 mt-6 text-xs uppercase tracking-wide text-slate-500">Dismissed</div>
                {dismissedEvents.map((ev) => <EventRow key={ev.id} ev={ev} onChange={loadEvents} />)}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
