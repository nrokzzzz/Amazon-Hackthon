import crypto from 'crypto';
import { StudentEvent } from '../models/StudentEvent.js';
import { calendarForStudent } from './googleClient.js';

// Build the Google Calendar event body, including reminders.overrides = ladder.
function buildEventBody(event, ladder) {
  const start = event.datetime ? new Date(event.datetime) : new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000); // default 1h block

  // Google allows max 5 overrides. Ladder is already capped, but be safe.
  const overrides = ladder.slice(0, 5).map((minutes) => ({ method: 'popup', minutes }));

  return {
    summary: `[${event.importance.toUpperCase()}] ${event.title}`,
    description:
      (event.description || '') +
      `\n\n— Synced by CampusFlow (type: ${event.type}${event.course ? `, ${event.course}` : ''})`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    reminders: {
      useDefault: false,
      overrides: overrides.length ? overrides : [{ method: 'popup', minutes: 60 }],
    },
  };
}

// Idempotent sync of ONE StudentEvent to the student's Google Calendar.
// If gcal_event_id exists -> update; else -> insert. Returns the updated SE.
export async function syncStudentEvent(student, studentEvent) {
  const event = studentEvent.event_id; // expected populated
  const body = buildEventBody(event, studentEvent.reminder_ladder);

  // SIMULATION MODE: when the student hasn't connected Google (or no creds),
  // we simulate a successful sync so the full pipeline is demoable offline.
  if (!student.gcal?.connected || !student.gcal?.refresh_token) {
    studentEvent.gcal_event_id =
      studentEvent.gcal_event_id || `sim_${crypto.randomBytes(8).toString('hex')}`;
    studentEvent.sync_status = 'synced';
    studentEvent.sync_error = undefined;
    studentEvent.last_synced = new Date();
    await studentEvent.save();
    return { studentEvent, simulated: true };
  }

  try {
    const calendar = calendarForStudent(student);
    const calendarId = student.gcal.calendar_id || 'primary';
    let resp;
    if (studentEvent.gcal_event_id) {
      resp = await calendar.events.update({
        calendarId,
        eventId: studentEvent.gcal_event_id,
        requestBody: body,
      });
    } else {
      resp = await calendar.events.insert({ calendarId, requestBody: body });
      studentEvent.gcal_event_id = resp.data.id;
    }
    studentEvent.sync_status = 'synced';
    studentEvent.sync_error = undefined;
    studentEvent.last_synced = new Date();
    await studentEvent.save();
    return { studentEvent, simulated: false };
  } catch (err) {
    studentEvent.sync_status = 'failed';
    studentEvent.sync_error = String(err?.message || err);
    await studentEvent.save();
    throw err;
  }
}

// Sync all of a student's non-dismissed events. Returns a summary.
export async function syncAllForStudent(student) {
  const ses = await StudentEvent.find({
    student_id: student._id,
    state: { $ne: 'dismissed' },
  }).populate('event_id');

  let synced = 0;
  let failed = 0;
  let simulated = false;
  for (const se of ses) {
    if (!se.event_id) continue;
    try {
      const r = await syncStudentEvent(student, se);
      simulated = simulated || r.simulated;
      synced++;
    } catch {
      failed++;
    }
  }
  return { total: ses.length, synced, failed, simulated };
}
