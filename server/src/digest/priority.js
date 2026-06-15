import { CATEGORIES } from './categories.js';

// ---------------------------------------------------------------------------
// Prioritization engine — the core of CampusFlow.
// Every stored college item is scored so the student always sees what matters
// most first. Score = category importance + deadline urgency + alignment with
// the student's goals & focus subjects + urgent alerts (attendance, transport).
// ---------------------------------------------------------------------------

// How important each category is by its nature.
const CATEGORY_WEIGHT = {
  attendance: 95, // shortage can debar you — very important
  exam_timetable: 90,
  fees: 85, // missing a fee deadline blocks exams
  placement_prep: 80,
  assignment_deadlines: 78,
  transport: 70,
  hostel_notices: 50,
  class_timetable: 45,
  club_events: 40,
  general: 30,
};

const IMPORTANCE_WEIGHT = { critical: 40, high: 25, med: 10, low: 0 };

// ---- Lifetime / expiry ----------------------------------------------------
// A task lives only for its lifetime: through the END of its day (IST). Once
// that day has fully passed the task is "dead" and is dropped from the live
// prioritized list (and physically pruned hourly by the scheduler). Undated
// notices have no deadline so they stay until replaced/removed.
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

function endOfIstDay(datetime) {
  const t = new Date(datetime).getTime();
  if (Number.isNaN(t)) return null;
  const ist = new Date(t + IST_OFFSET_MS); // shift so UTC getters read IST wall-clock
  const endWall = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 23, 59, 59, 999);
  return endWall - IST_OFFSET_MS; // back to a real UTC instant
}

// Is this task still relevant (alive) at `now`?
export function isLive(item, now = new Date()) {
  if (!item?.datetime) return true; // undated notice — keep until removed
  const end = endOfIstDay(item.datetime);
  if (end == null) return true;
  return now.getTime() <= end;
}

// The soonest instant at which some dated item in this doc will expire (the end
// of its IST day), strictly after `now` — i.e. when the expiry job next needs to
// run for this student. null when nothing dated remains, so the caller can fall
// back to a slow re-check instead of running hourly for no reason.
export function nextExpiryAt(doc, now = new Date()) {
  if (!doc) return null;
  const t = now.getTime();
  let soonest = null;
  for (const cat of CATEGORIES) {
    const arr = doc[cat];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      if (!it?.datetime) continue;
      const end = endOfIstDay(it.datetime);
      if (end == null || end <= t) continue; // already dead or undatable
      if (soonest == null || end < soonest) soonest = end;
    }
  }
  return soonest == null ? null : new Date(soonest);
}

// Remove dead (past-day) dated items from a CollegeInfo doc IN PLACE.
// Returns how many were removed. Undated items are kept.
export function expireDigest(doc, now = new Date()) {
  if (!doc) return 0;
  let removed = 0;
  for (const cat of CATEGORIES) {
    const arr = doc[cat];
    if (!Array.isArray(arr) || !arr.length) continue;
    const kept = arr.filter((it) => isLive(it, now));
    if (kept.length !== arr.length) {
      removed += arr.length - kept.length;
      doc[cat] = kept;
    }
  }
  return removed;
}

function daysUntil(datetime, now) {
  if (!datetime) return null;
  const d = new Date(datetime);
  if (Number.isNaN(d.getTime())) return null;
  return (d - now) / 86400000;
}

// Deadline proximity -> urgency points. Closer = higher (dominant factor).
function urgencyScore(days) {
  if (days == null) return 10; // undated notice
  if (days < 0) return 20; // already passed (less actionable)
  if (days <= 1) return 60; // due today/tomorrow
  if (days <= 2) return 50;
  if (days <= 4) return 38;
  if (days <= 7) return 28;
  if (days <= 14) return 16;
  return 8;
}

// Boost/penalty based on how well an item matches the student's goals.
function goalAlignment(item, profile) {
  const goals = (profile?.goals || []).map((g) => String(g).toLowerCase());
  const interests = (profile?.areas_of_interest || []).map((s) => String(s).toLowerCase());
  const hasGoals = goals.length > 0;
  const hay = `${item.title} ${item.summary}`.toLowerCase();

  const placementGoal = goals.some((g) =>
    /placement|job|intern|company|sde|develop|coding|software|gate|higher\s*stud/.test(g)
  );
  const eventGoal = goals
    .concat(interests)
    .some((g) => /event|club|sport|game|dance|cultural|music|fest|drama|hobby|art/.test(g));

  // Placement vs non-placement goal steering (drives overlap resolution).
  if (item.category === 'placement_prep') {
    if (!hasGoals) return 0;
    return placementGoal ? 22 : -12; // if goal isn't placement, deprioritize it
  }
  if (item.category === 'club_events') {
    return eventGoal ? 18 : 0; // boost clubs/events for event-oriented students
  }

  let s = 0;
  if (goals.some((g) => g && hay.includes(g))) s += 12;
  if (interests.some((i) => i && hay.includes(i))) s += 6;
  return s;
}

// Boost items tied to subjects the student finds hard / wants to focus on.
function focusBoost(item, profile) {
  const focus = (profile?.focus_subjects || []).map((s) => String(s).toLowerCase());
  if (!focus.length) return 0;
  const hay = `${item.title} ${item.summary} ${item.details?.subject || ''} ${item.details?.course || ''}`.toLowerCase();
  return focus.some((s) => s && hay.includes(s)) ? 12 : 0;
}

// Pull an attendance percentage out of the item if present.
function attendancePct(item) {
  const p = item.details?.percentage;
  if (typeof p === 'number') return p;
  const m = `${p ?? ''} ${item.summary ?? ''} ${item.title ?? ''}`.match(/(\d{1,3})\s*%/);
  return m ? Number(m[1]) : null;
}

// Score a single item. Returns { score, reasons, days_until, alert }.
export function scoreItem(item, profile, now = new Date()) {
  const reasons = [];
  let score = CATEGORY_WEIGHT[item.category] ?? 30;

  score += IMPORTANCE_WEIGHT[item.importance] ?? 10;

  const days = daysUntil(item.datetime, now);
  score += urgencyScore(days);
  if (days != null) {
    if (days < 0) reasons.push('deadline passed');
    else if (days <= 1) reasons.push('due within a day');
    else if (days <= 2) reasons.push('due in ~2 days');
    else if (days <= 7) reasons.push('this week');
  }

  const ga = goalAlignment(item, profile);
  if (ga > 0) reasons.push('matches your goals/interests');
  else if (ga < 0) reasons.push('outside your stated goals');
  score += ga;

  const fb = focusBoost(item, profile);
  if (fb) reasons.push('a subject you focus on');
  score += fb;

  if (item.action_required) {
    score += 8;
    reasons.push('action required');
  }

  // Urgent, always-surface alerts.
  let alert = null;
  if (item.category === 'attendance') {
    const pct = attendancePct(item);
    if (pct != null && pct < 75) {
      score += 35;
      alert = `Attendance ${pct}% — attend upcoming classes to get above 75%`;
      reasons.push('attendance below 75%');
    }
  }
  if (item.category === 'transport') {
    score += 12;
    alert = alert || 'Transport update — check the new timing/route';
    reasons.push('transport update');
  }

  return { score: Math.round(score), goal_score: ga, reasons, days_until: days == null ? null : Math.round(days), alert };
}

// Items within ~2h of each other clash. The winner is decided by GOAL ALIGNMENT
// (e.g. a placement student keeps the placement; an events student keeps the
// club/event over a placement), then by score. The loser is demoted below the
// winner and annotated, so the prioritized list reflects the student's goals.
function resolveOverlaps(scored) {
  const dated = scored.filter((t) => t.datetime);
  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i];
      const b = dated[j];
      if (Math.abs(new Date(a.datetime).getTime() - new Date(b.datetime).getTime()) > 2 * 3600 * 1000) continue;

      const ga = a.goal_score ?? 0;
      const gb = b.goal_score ?? 0;
      const hi = ga !== gb ? (ga > gb ? a : b) : a.score >= b.score ? a : b;
      const lo = hi === a ? b : a;

      lo.overlap = { conflicts_with: hi.title, note: `Clashes with "${hi.title}" — prioritized per your goals` };
      if (lo.score >= hi.score) lo.score = hi.score - 1; // make the goal-preferred one rank higher
    }
  }
}

// Flatten a CollegeInfo doc into a single, priority-sorted task list.
export function prioritizeDigest(doc, profile, now = new Date()) {
  const items = [];
  // Only LIVE tasks make the active list — dead/past-day ones are dropped.
  for (const cat of CATEGORIES) for (const it of doc?.[cat] || []) if (isLive(it, now)) items.push(it);

  const scored = items.map((it) => {
    const s = scoreItem(it, profile, now);
    return {
      _id: it._id,
      category: it.category,
      title: it.title,
      summary: it.summary,
      datetime: it.datetime,
      importance: it.importance,
      amount: it.amount,
      location: it.location,
      link: it.link,
      action_required: it.action_required,
      on_calendar: Boolean(it.gcal_event_id),
      ...s,
    };
  });

  resolveOverlaps(scored);
  scored.sort((a, b) => b.score - a.score || (a.days_until ?? 1e9) - (b.days_until ?? 1e9));
  return scored;
}

// Compact, priority-ordered text block for the chatbot's grounding context.
export function prioritySummaryText(tasks, max = 12) {
  if (!tasks.length) return '(no tasks yet)';
  const fmt = (d) =>
    d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'no date';
  return tasks
    .slice(0, max)
    .map((t, i) => {
      const bits = [];
      if (t.datetime) bits.push(fmt(t.datetime));
      if (t.days_until != null) {
        bits.push(t.days_until < 0 ? 'past' : t.days_until === 0 ? 'today' : t.days_until === 1 ? 'tomorrow' : `in ${t.days_until}d`);
      }
      if (t.alert) bits.push(`ALERT: ${t.alert}`);
      if (t.overlap) bits.push(t.overlap.note);
      return `${i + 1}. [${t.category}] ${t.title}${bits.length ? ` — ${bits.join(' · ')}` : ''}`;
    })
    .join('\n');
}
