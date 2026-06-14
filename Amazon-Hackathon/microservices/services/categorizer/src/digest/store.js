import crypto from 'crypto';
import { CollegeInfo } from '../models/CollegeInfo.js';
import { CATEGORIES } from './categories.js';
import { categorizeEmail } from './categorize.js';

function toDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Common keys the LLM uses for a "last date" / deadline inside details. If the
// top-level datetime is missing, we pull the deadline from here so the item is
// still dated — which is what drives prioritization and the hourly expiry cron.
const DEADLINE_KEYS = [
  'last_date', 'last_date_to_pay', 'due', 'due_date', 'deadline', 'payment_deadline',
  'registration_deadline', 'last_date_of_registration', 'submission_date', 'closing_date',
];

function deadlineFromDetails(details) {
  if (!details || typeof details !== 'object') return undefined;
  for (const k of DEADLINE_KEYS) {
    const d = toDate(details[k]);
    if (d) return d;
  }
  // Catch-all: any field whose name mentions a date/deadline/last-date.
  for (const [k, v] of Object.entries(details)) {
    if (/date|deadline|\blast\b|\bdue\b/i.test(k)) {
      const d = toDate(v);
      if (d) return d;
    }
  }
  return undefined;
}

// The single action-critical date for an item: the explicit datetime, else any
// last date/deadline buried in details.
function resolveDeadline(item) {
  return toDate(item.datetime) ?? deadlineFromDetails(item.details);
}

// Stable fingerprint so the same fact from a re-delivered email isn't stored twice.
function hashItem(category, title, deadline) {
  const key = `${category}|${(title || '').trim().toLowerCase()}|${deadline ? deadline.toISOString() : ''}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Categorize one email's content and merge the resulting items into the
// student's single CollegeInfo document (creating it on first use). Idempotent:
// items already present (by content_hash) are skipped.
//
// In the microservices split this service has no Student model, so we key the
// CollegeInfo document directly by the gateway-forwarded userId string. The
// calendar sync that used to live here now happens in the integration service,
// driven by the 'digest.updated' Kafka event the caller produces — so we just
// return the newly added items (as plain objects) for the caller to publish.
export async function categorizeAndStore(
  userId,
  { text, files = [], source = 'gmail', subject = '', emailId = '' },
  now = new Date()
) {
  const { engine, items } = await categorizeEmail({ text, files, now });
  if (!items.length) return { engine, added: 0, by_category: {}, items: [] };

  const doc = await CollegeInfo.findOneAndUpdate(
    { student_id: userId },
    { $setOnInsert: { student_id: userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  let added = 0;
  const byCategory = {};
  const newItems = []; // references to the subdocs we just pushed

  for (const it of items) {
    const category = CATEGORIES.includes(it.category) ? it.category : 'general';
    // The deadline / last date drives priority + the expiry cron. Pull it from
    // details when the LLM didn't put it at the top level.
    const deadline = resolveDeadline(it);
    const content_hash = hashItem(category, it.title, deadline);

    const bucket = doc[category];
    if (bucket.some((x) => x.content_hash === content_hash)) continue;

    bucket.push({
      category,
      title: it.title,
      summary: it.summary || '',
      datetime: deadline,
      importance: it.importance || 'med',
      action_required: Boolean(it.action_required),
      link: it.link || '',
      amount: it.amount || '',
      location: it.location || '',
      details: it.details || {},
      source,
      source_subject: subject,
      source_email_id: emailId,
      content_hash,
      received_at: now,
    });
    newItems.push(bucket[bucket.length - 1]); // the cast subdocument
    added++;
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  if (added) await doc.save();

  // Plain-object snapshots of just the items we added, for the 'digest.updated'
  // Kafka event (the integration service turns dated ones into calendar entries).
  const addedItems = newItems.map((it) => (typeof it.toObject === 'function' ? it.toObject() : it));

  return { engine, added, by_category: byCategory, items: addedItems };
}
