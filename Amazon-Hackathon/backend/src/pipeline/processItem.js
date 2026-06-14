import { RawItem } from '../models/RawItem.js';
import { Event } from '../models/Event.js';
import { StudentEvent } from '../models/StudentEvent.js';
import { Student } from '../models/Student.js';
import { extractEvents } from '../extraction/extractor.js';
import { matchesStudent } from '../matching/match.js';
import { priorityScore, reminderLadderFor } from '../scheduling/priority.js';

// Process one RawItem end-to-end:
//   extract -> persist Events -> match against students -> create StudentEvents
//   with priority score + reminder ladder.
// `scope` controls which students we match against:
//   - if the raw item belongs to a student, match only that student
//   - if global (portal), match against ALL students
export async function processRawItem(rawItem, now = new Date()) {
  try {
    const { engine, events } = await extractEvents(rawItem.raw_text, now);

    const createdEvents = [];
    for (const e of events) {
      const ev = await Event.create({
        raw_item_id: rawItem._id,
        title: e.title,
        description: e.description,
        type: e.type,
        course: e.course,
        datetime: e.datetime,
        audience: e.audience,
        importance: e.importance,
      });
      createdEvents.push(ev);
    }

    // Which students to consider?
    const students = rawItem.student_id
      ? await Student.find({ _id: rawItem.student_id })
      : await Student.find({});

    let matchCount = 0;
    for (const ev of createdEvents) {
      for (const student of students) {
        if (!matchesStudent(ev, student, now)) continue;
        await upsertStudentEvent(student, ev, now);
        matchCount++;
      }
    }

    rawItem.status = 'done';
    rawItem.error = undefined;
    await rawItem.save();

    return { engine, events: createdEvents.length, matches: matchCount };
  } catch (err) {
    rawItem.status = 'failed';
    rawItem.error = String(err?.message || err);
    await rawItem.save();
    throw err;
  }
}

export async function upsertStudentEvent(student, event, now = new Date()) {
  const score = priorityScore(event.importance, event.datetime, now);
  const ladder = reminderLadderFor(event.importance);

  return StudentEvent.findOneAndUpdate(
    { student_id: student._id, event_id: event._id },
    {
      $set: { priority_score: score, reminder_ladder: ladder },
      $setOnInsert: { state: 'pending', sync_status: 'unsynced' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// Re-score all of a student's events (urgency drifts as the clock ticks).
export async function rescoreStudent(studentId, now = new Date()) {
  const ses = await StudentEvent.find({ student_id: studentId }).populate('event_id');
  for (const se of ses) {
    if (!se.event_id) continue;
    se.priority_score = priorityScore(se.event_id.importance, se.event_id.datetime, now);
    await se.save();
  }
  return ses.length;
}
