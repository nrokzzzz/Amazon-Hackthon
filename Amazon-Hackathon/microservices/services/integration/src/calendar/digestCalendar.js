import { calendarForConnection } from '../google/googleClient.js';

// Reminder lead time per category:
//   exams        -> 2 days before
//   everything else with a date -> 1 day before
const REMINDER_DAYS = { exam_timetable: 2, exams: 2, exam: 2 };
const DEFAULT_REMINDER_DAYS = 1;

const PREFIX = {
  exam_timetable: 'Exam',
  exams: 'Exam',
  exam: 'Exam',
  assignment_deadlines: 'Assignment',
  assignments: 'Assignment',
  fees: 'Fee',
  fee: 'Fee',
  placement_prep: 'Placement',
  placements: 'Placement',
  club_events: 'Event',
  events: 'Event',
  attendance: 'Attendance',
  transport: 'Transport',
  hostel_notices: 'Hostel',
  hostel: 'Hostel',
  class_timetable: 'Class',
  general: 'Notice',
};

function reminderMinutes(category) {
  const days = REMINDER_DAYS[category] ?? DEFAULT_REMINDER_DAYS;
  return days * 24 * 60;
}

// Stable key for one digest item so we upsert (never duplicate) its calendar
// event across repeated digest.updated messages: category|title|datetime.
export function itemKey(item) {
  return [item.category || 'general', item.title || '', item.datetime || '']
    .join('|')
    // Mongo Mixed map keys can't contain '.' — sanitize.
    .replace(/\./g, '_');
}

export function buildEventBody(item) {
  const start = new Date(item.datetime);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1h block
  const lead = reminderMinutes(item.category);
  const importance = String(item.importance || '').toUpperCase();

  const extras = [];
  if (item.location) extras.push(`Location: ${item.location}`);
  if (item.amount) extras.push(`Amount: ${item.amount}`);
  if (item.action_required) extras.push(`Action: ${item.action_required}`);
  if (item.details) extras.push(item.details);
  if (item.link) extras.push(item.link);

  const prefix = PREFIX[item.category] || 'CampusFlow';
  const summary = importance
    ? `[${importance}] ${prefix}: ${item.title}`
    : `[${prefix}] ${item.title}`;

  return {
    summary,
    description: [item.summary, extras.join('\n'), '— Auto-added by CampusFlow']
      .filter(Boolean)
      .join('\n\n'),
    start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
    end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: lead },
        { method: 'email', minutes: lead },
      ],
    },
  };
}

// Upsert Google Calendar events for every dated digest item, keyed by itemKey in
// conn.gcal_events for idempotency. Best-effort: logs errors, never throws.
// Returns { created, updated, failed }.
export async function syncDigestItemsToCalendar(conn, items) {
  if (!conn?.refresh_token) {
    return { created: 0, updated: 0, failed: 0, reason: 'not_connected' };
  }

  const dated = (items || []).filter((it) => it && it.datetime);
  if (!dated.length) return { created: 0, updated: 0, failed: 0 };

  const calendar = calendarForConnection(conn);
  const calendarId = conn.calendar_id || 'primary';
  const events = conn.gcal_events || {};

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const item of dated) {
    const key = itemKey(item);
    const body = buildEventBody(item);
    const existingId = events[key];
    try {
      if (existingId) {
        await calendar.events.update({ calendarId, eventId: existingId, requestBody: body });
        updated++;
      } else {
        const resp = await calendar.events.insert({ calendarId, requestBody: body });
        events[key] = resp.data.id;
        created++;
      }
    } catch (err) {
      failed++;
      console.error(`[calendar] upsert failed for "${item.title}":`, err?.message || err);
    }
  }

  conn.gcal_events = events;
  conn.markModified('gcal_events'); // Mixed type — tell mongoose it changed
  await conn.save();

  return { created, updated, failed };
}
