import { CollegeInfo } from '../../models/CollegeInfo.js';
import { expireDigest, nextExpiryAt } from '../../digest/priority.js';

// If the student has no upcoming dated items there's nothing to expire soon, so
// we only re-check this slowly instead of every hour.
const IDLE_RECHECK_MS = 6 * 60 * 60 * 1000; // 6h
const GONE_RECHECK_MS = 24 * 60 * 60 * 1000; // doc missing — back off a day

// Prune one student's past-day tasks, then return WHEN to run next: exactly when
// the student's soonest remaining deadline dies (so it fires once, on time), or a
// slow re-check if nothing is dated. Idempotent — re-running is a harmless no-op.
export async function runDigestExpiry(job, now = new Date()) {
  const doc = await CollegeInfo.findOne({ student_id: job.ref_id });
  if (!doc) return new Date(now.getTime() + GONE_RECHECK_MS);

  const removed = expireDigest(doc, now);
  if (removed > 0) await doc.save();

  const next = nextExpiryAt(doc, now);
  return next || new Date(now.getTime() + IDLE_RECHECK_MS);
}
