// Small shared UI primitives + importance/quadrant styling helpers.

export const IMPORTANCE_STYLES = {
  critical: { label: 'CRITICAL', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  high: { label: 'HIGH', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  med: { label: 'MEDIUM', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  low: { label: 'LOW', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
};

export const TYPE_ICONS = {
  exam: '📝', exam_fee: '💳', assignment: '📄', lab: '🧪', project: '📊',
  registration: '🖊️', class: '🏫', workshop: '🛠️', placement: '💼',
  attendance: '📉', notice: '📌', event: '🎉',
};

export function Badge({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export function ImportanceBadge({ importance }) {
  const s = IMPORTANCE_STYLES[importance] || IMPORTANCE_STYLES.low;
  return <Badge className={s.cls}>{s.label}</Badge>;
}

export function Button({ children, variant = 'primary', className = '', ...rest }) {
  const variants = {
    primary: 'bg-indigo-500 hover:bg-indigo-400 text-white',
    ghost: 'bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10',
    danger: 'bg-red-500/80 hover:bg-red-500 text-white',
    success: 'bg-emerald-500 hover:bg-emerald-400 text-white',
  };
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>{children}</div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400';

// Human-readable "in 2 days" / "tomorrow 9:00 AM".
export function formatWhen(datetime) {
  if (!datetime) return 'No date';
  const d = new Date(datetime);
  const now = new Date();
  const diffMs = d - now;
  const diffDays = Math.round(diffMs / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  let rel;
  if (diffMs < 0) rel = 'overdue';
  else if (diffDays === 0) rel = 'today';
  else if (diffDays === 1) rel = 'tomorrow';
  else rel = `in ${diffDays} days`;
  return `${date}, ${time} · ${rel}`;
}

// "1 week, 3 days, 1 day, 3h, 1h"
export function formatLadder(minutes = []) {
  return minutes
    .map((m) => {
      if (m % (7 * 24 * 60) === 0) return `${m / (7 * 24 * 60)}w`;
      if (m % (24 * 60) === 0) return `${m / (24 * 60)}d`;
      if (m % 60 === 0) return `${m / 60}h`;
      return `${m}m`;
    })
    .join(' · ');
}
