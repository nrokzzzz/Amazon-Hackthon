import express from 'express';
import { z } from 'zod';
import { StudentEvent } from '../models/StudentEvent.js';
import { Event } from '../models/Event.js';
import { requireAuth } from '../auth/jwt.js';
import { priorityScore, eisenhowerQuadrant, reminderLadderFor } from '../scheduling/priority.js';
import { syncStudentEvent } from '../calendar/sync.js';

export const eventsRouter = express.Router();

// Shape one StudentEvent (+ its Event) for the control center, recomputing the
// live priority score & quadrant against "now" so ordering is always current.
function present(se, now) {
  const ev = se.event_id;
  const score = priorityScore(ev.importance, ev.datetime, now);
  return {
    id: se._id,
    event_id: ev._id,
    title: ev.title,
    description: ev.description,
    type: ev.type,
    course: ev.course,
    datetime: ev.datetime,
    audience: ev.audience,
    importance: ev.importance,
    priority_score: score,
    quadrant: eisenhowerQuadrant(ev.importance, ev.datetime, now),
    reminder_ladder: se.reminder_ladder,
    state: se.state,
    sync_status: se.sync_status,
    gcal_event_id: se.gcal_event_id,
    last_synced: se.last_synced,
  };
}

// GET /events — this student's scheduled items, sorted by live priority (desc).
eventsRouter.get('/', requireAuth, async (req, res) => {
  const now = new Date();
  const ses = await StudentEvent.find({ student_id: req.student._id }).populate('event_id');
  const items = ses
    .filter((se) => se.event_id)
    .map((se) => present(se, now))
    .sort((a, b) => b.priority_score - a.priority_score);
  res.json({ events: items });
});

const updateSchema = z.object({
  // control-center actions
  state: z.enum(['pending', 'confirmed', 'dismissed']).optional(),
  // edits to the underlying event
  title: z.string().min(1).optional(),
  datetime: z.string().datetime().nullable().optional(),
  importance: z.enum(['critical', 'high', 'med', 'low']).optional(),
  course: z.string().optional(),
  // optionally push the change to Google Calendar immediately
  resync: z.boolean().optional(),
});

// PUT /events/:id — confirm / edit / dismiss before or after sync (Feature 10).
eventsRouter.put('/:id', requireAuth, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });

  const se = await StudentEvent.findOne({ _id: req.params.id, student_id: req.student._id }).populate('event_id');
  if (!se || !se.event_id) return res.status(404).json({ error: 'not_found' });

  const { state, resync, ...edits } = parsed.data;
  const ev = se.event_id;

  // Apply event edits
  if (edits.title !== undefined) ev.title = edits.title;
  if (edits.course !== undefined) ev.course = edits.course;
  if (edits.datetime !== undefined) ev.datetime = edits.datetime ? new Date(edits.datetime) : null;
  if (edits.importance !== undefined) {
    ev.importance = edits.importance;
    // Importance drives the ladder -> recompute it.
    se.reminder_ladder = reminderLadderFor(edits.importance);
  }
  await ev.save();

  if (state) se.state = state;
  // Recompute priority after edits.
  se.priority_score = priorityScore(ev.importance, ev.datetime, new Date());
  await se.save();

  // Optionally re-sync to Google Calendar (idempotent: updates if already synced).
  let synced = null;
  if (resync && se.state !== 'dismissed') {
    try {
      const r = await syncStudentEvent(req.student, se);
      synced = { ok: true, simulated: r.simulated };
    } catch (err) {
      synced = { ok: false, message: String(err?.message || err) };
    }
  }

  res.json({ event: present(se, new Date()), synced });
});
