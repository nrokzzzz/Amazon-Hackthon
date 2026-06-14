import crypto from 'crypto';
import { CollegeInfo } from '../models/CollegeInfo.js';
import { CATEGORIES } from './categories.js';
import { categorizeEmail } from './categorize.js';

// Stable fingerprint so the same fact from a re-delivered email isn't stored twice.
function hashItem(category, item) {
  const key = `${category}|${(item.title || '').trim().toLowerCase()}|${item.datetime || ''}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

function toDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Categorize one email's content and merge the resulting items into the
// student's single CollegeInfo document (creating it on first use). Idempotent:
// items already present (by content_hash) are skipped.
export async function categorizeAndStore(
  student,
  { text, files = [], source = 'gmail', subject = '', emailId = '' },
  now = new Date()
) {
  const { engine, items } = await categorizeEmail({ text, files, now });
  if (!items.length) return { engine, added: 0, by_category: {} };

  const doc = await CollegeInfo.findOneAndUpdate(
    { student_id: student._id },
    { $setOnInsert: { student_id: student._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  let added = 0;
  const byCategory = {};

  for (const it of items) {
    const category = CATEGORIES.includes(it.category) ? it.category : 'general';
    const content_hash = hashItem(category, it);

    const bucket = doc[category];
    if (bucket.some((x) => x.content_hash === content_hash)) continue;

    bucket.push({
      category,
      title: it.title,
      summary: it.summary || '',
      datetime: toDate(it.datetime),
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
    added++;
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  if (added) await doc.save();
  return { engine, added, by_category: byCategory };
}
