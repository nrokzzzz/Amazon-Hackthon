import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Badge, ImportanceBadge, formatWhen } from '../ui.jsx';

// Per-category icon + label for the cards.
const CAT = {
  exam_timetable: { icon: '📝', label: 'Exam' },
  assignment_deadlines: { icon: '📄', label: 'Assignment' },
  fees: { icon: '💳', label: 'Fee' },
  attendance: { icon: '📉', label: 'Attendance' },
  placement_prep: { icon: '💼', label: 'Placement' },
  class_timetable: { icon: '🏫', label: 'Class' },
  transport: { icon: '🚌', label: 'Transport' },
  hostel_notices: { icon: '🏠', label: 'Hostel' },
  club_events: { icon: '🎉', label: 'Club / Event' },
  general: { icon: '📌', label: 'Notice' },
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

function TaskCard({ t }) {
  const cat = CAT[t.category] || CAT.general;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xl">{cat.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-100 break-words">{t.title}</span>
            <ImportanceBadge importance={t.importance} />
            <Badge className="border-white/10 bg-white/5 text-slate-300">{cat.label}</Badge>
            {dueChip(t.days_until)}
            {t.on_calendar && (
              <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">📅 calendar</Badge>
            )}
          </div>

          {t.summary && <p className="mt-1 text-sm text-slate-400 break-words">{t.summary}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>🕒 {formatWhen(t.datetime)}</span>
            {t.amount && <span>💰 {t.amount}</span>}
            {t.location && <span>📍 {t.location}</span>}
            {t.action_required && <span className="text-amber-300">● action required</span>}
          </div>

          {t.alert && (
            <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-200">⚠ {t.alert}</div>
          )}
          {t.overlap && <div className="mt-2 text-xs text-amber-300/80">⧉ {t.overlap.note}</div>}
          {t.link && (
            <a
              href={t.link}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-indigo-300 hover:underline"
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

  useEffect(() => {
    api
      .get('/college-info/tasks')
      .then(({ data }) => {
        setTasks(data.tasks || []);
        setAlerts(data.alerts || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6 md:p-8">
      <h1 className="text-xl font-bold sm:text-2xl">Priorities</h1>
      <p className="mt-1 text-sm text-slate-400">
        Everything from your college emails, ranked by what matters most. Past items drop off automatically.
      </p>

      {/* Urgent alerts up top */}
      {alerts.length > 0 && (
        <div className="mt-5 space-y-2">
          {alerts.map((a) => (
            <div
              key={a._id || a.title}
              className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-200"
            >
              ⚠ {a.alert}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {loading ? (
          <div className="text-slate-500">Loading…</div>
        ) : tasks.length === 0 ? (
          <Card className="text-center">
            <div className="text-slate-300">No tasks yet.</div>
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
          tasks.map((t) => <TaskCard key={t._id || t.title} t={t} />)
        )}
      </div>
    </div>
  );
}
