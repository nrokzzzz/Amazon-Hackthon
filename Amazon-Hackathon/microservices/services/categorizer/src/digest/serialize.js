import { CATEGORIES } from './categories.js';
import { isLive } from './priority.js';

const LABELS = {
  class_timetable: 'CLASS TIMETABLE',
  exam_timetable: 'EXAM TIMETABLE',
  assignment_deadlines: 'ASSIGNMENT DEADLINES',
  fees: 'FEES & PAYMENTS',
  attendance: 'ATTENDANCE',
  placement_prep: 'PLACEMENT PREP',
  hostel_notices: 'HOSTEL NOTICES',
  transport: 'TRANSPORT',
  club_events: 'CLUB EVENTS',
  general: 'GENERAL NOTICES',
};

function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

// Flatten the CollegeInfo document into a compact, readable text block that we
// feed to the chatbot as grounding context.
export function serializeDigest(doc, now = new Date()) {
  if (!doc) return '(no college information stored yet)';
  const lines = [];
  for (const cat of CATEGORIES) {
    // Only show LIVE items — past/expired tasks are dropped so the assistant
    // never treats a dead deadline as upcoming.
    const items = (doc[cat] || []).filter((it) => isLive(it, now));
    if (!items.length) continue;
    lines.push(`## ${LABELS[cat]}`);
    for (const it of items) {
      const when = fmtDate(it.datetime);
      const extra = [];
      if (it.amount) extra.push(`amount: ${it.amount}`);
      if (it.location) extra.push(`location: ${it.location}`);
      if (it.link) extra.push(`link: ${it.link}`);
      if (it.action_required) extra.push('action required');
      if (it.details && typeof it.details === 'object') {
        for (const [k, v] of Object.entries(it.details)) {
          if (v != null && v !== '') extra.push(`${k}: ${v}`);
        }
      }
      const tag = it.importance && it.importance !== 'med' ? `(${it.importance}) ` : '';
      const meta = extra.length ? ` [${extra.join(', ')}]` : '';
      lines.push(`- ${tag}${it.title}${when ? ` (${when})` : ''}: ${it.summary || ''}${meta}`.trim());
    }
    lines.push('');
  }
  return lines.length ? lines.join('\n').trim() : '(no college information stored yet)';
}

// Count items per category — used by the /college-info summary.
export function digestCounts(doc) {
  const counts = {};
  for (const cat of CATEGORIES) counts[cat] = doc?.[cat]?.length || 0;
  return counts;
}
