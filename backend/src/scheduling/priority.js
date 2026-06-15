// Prioritization & reminder-ladder logic (Section 6 of spec).
// IMPORTANCE is fixed (property of the event type). URGENCY is dynamic (rises as
// the deadline nears). The ladder is set once; Google Calendar fires it natively.

export const IMPORTANCE_WEIGHT = { critical: 4, high: 3, med: 2, low: 1 };

// IMPORTANCE tier -> REMINDER LADDER (minutes-before). Google Calendar allows a
// MAXIMUM of 5 reminders/event — the CRITICAL ladder uses exactly 5.
export const REMINDER_LADDERS = {
  critical: [
    7 * 24 * 60, // 1 week
    3 * 24 * 60, // 3 days
    1 * 24 * 60, // 1 day
    3 * 60, // 3 hours
    1 * 60, // 1 hour
  ],
  high: [
    2 * 24 * 60, // 2 days
    1 * 24 * 60, // 1 day
    2 * 60, // 2 hours
  ],
  med: [
    1 * 24 * 60, // 1 day
    1 * 60, // 1 hour
  ],
  low: [
    1 * 60, // 1 hour
  ],
};

export function reminderLadderFor(importance) {
  return REMINDER_LADDERS[importance] || REMINDER_LADDERS.low;
}

// urgency_factor increases as datetime approaches (inverse of hours-left).
// Bounded so a far-off event doesn't go to ~0 and a passed/imminent event
// doesn't blow up to Infinity.
export function urgencyFactor(datetime, now = new Date()) {
  if (!datetime) return 1;
  const hoursLeft = (new Date(datetime).getTime() - now.getTime()) / 3.6e6;
  if (hoursLeft <= 0) return 10; // already due / overdue -> max urgency
  // 1 + (24 / hoursLeft), capped at 10. ~1h left => high; weeks away => ~1.
  return Math.min(1 + 24 / hoursLeft, 10);
}

// priority = importance_weight * urgency_factor (Section 6, Step 4).
export function priorityScore(importance, datetime, now = new Date()) {
  const w = IMPORTANCE_WEIGHT[importance] || 1;
  return Math.round(w * urgencyFactor(datetime, now) * 100) / 100;
}

// Eisenhower quadrant label (Step 3) — drives UI behavior / study blocks.
export function eisenhowerQuadrant(importance, datetime, now = new Date()) {
  const important = importance === 'critical' || importance === 'high';
  const urgent = urgencyFactor(datetime, now) >= 4; // ~within ~8h or overdue-ish
  if (important && urgent) return 'important_urgent';
  if (important && !urgent) return 'important_not_urgent';
  if (!important && urgent) return 'not_important_urgent';
  return 'not_important_not_urgent';
}
