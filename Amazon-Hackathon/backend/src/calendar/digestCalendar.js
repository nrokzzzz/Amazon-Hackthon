import { calendarForStudent } from './googleClient.js';
import { CollegeInfo } from '../models/CollegeInfo.js';
import { CATEGORIES } from '../digest/categories.js';

// Reminder lead time per category:
//   exams        -> 2 days before
//   everything else with a date -> 1 day before
const REMINDER_DAYS = { exam_timetable: 2 };
const DEFAULT_REMINDER_DAYS = 1;

const PREFIX = {
  exam_timetable: 'Exam',
  assignment_deadlines: 'Assignment',
  fees: 'Fee',
  placement_prep: 'Placement',
  club_events: 'Event',
  attendance: 'Attendance',
  transport: 'Transport',
  hostel_notices: 'Hostel',
  class_timetable: 'Class',
  general: 'Notice',
};

function reminderMinutes(category) {
  const days = REMINDER_DAYS[category] ?? DEFAULT_REMINDER_DAYS;
  return days * 24 * 60;
}

export function buildEventBody(item) {
  const start = new Date(item.datetime);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1h block
  const lead = reminderMinutes(item.category);

  const extras = [];
  if (item.location) extras.push(`Location: ${item.location}`);
  if (item.amount) extras.push(`Amount: ${item.amount}`);
  if (item.link) extras.push(item.link);

  return {
    summary: `[${PREFIX[item.category] || 'CampusFlow'}] ${item.title}`,
    description: [item.summary, extras.join('\n'), '— Auto-added by CampusFlow'].filter(Boolean).join('\n\n'),
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

// Auto-create a Google Calendar event (with reminder) for each NEW dated item.
// No user action, no sync button. Sets item.gcal_event_id so it never duplicates.
// `items` are CollegeInfo subdocuments, mutated in place — the caller saves the doc.
export async function syncDigestItemsToCalendar(student, items) {
  if (!student?.gcal?.connected || !student?.gcal?.refresh_token) {
    return { created: 0, reason: 'not_connected' };
  }

  const dated = items.filter((it) => it.datetime && !it.gcal_event_id);
  if (!dated.length) return { created: 0 };

  const calendar = calendarForStudent(student);
  const calendarId = student.gcal.calendar_id || 'primary';

  let created = 0;
  for (const item of dated) {
    try {
      const resp = await calendar.events.insert({ calendarId, requestBody: buildEventBody(item) });
      item.gcal_event_id = resp.data.id;
      created++;
    } catch (err) {
      console.error(`[calendar] auto-add failed for "${item.title}":`, err?.message || err);
    }
  }
  return { created };
}

// Backfill: add every dated, not-yet-synced digest item for a student to their
// Google Calendar. Called right after the student connects Google so items that
// were captured *before* connecting also land on the calendar automatically.
export async function backfillDigestCalendar(student) {
  if (!student?.gcal?.connected || !student?.gcal?.refresh_token) {
    return { created: 0, reason: 'not_connected' };
  }
  const doc = await CollegeInfo.findOne({ student_id: student._id });
  if (!doc) return { created: 0 };

  const items = [];
  for (const cat of CATEGORIES) for (const it of doc[cat] || []) items.push(it);

  const r = await syncDigestItemsToCalendar(student, items); // mutates gcal_event_id in place
  if (r.created) await doc.save();
  return r;
}
