import { CollegeInfo } from '../models/CollegeInfo.js';
import { expireDigest } from './priority.js';

// Hourly per-student maintenance: a task only lives for its lifetime (through
// the end of its day). Once that's passed it's dead, so we prune it from the
// student's digest. This keeps the prioritized list fresh and accurate — only
// what's still actionable remains. Scoring itself is recomputed live on every
// request, so removing dead items is the recurring work needed here.
const INTERVAL_MS = 60 * 60 * 1000; // every hour

export async function runExpiry(now = new Date()) {
  const docs = await CollegeInfo.find({});
  let removed = 0;
  let students = 0;
  for (const doc of docs) {
    const n = expireDigest(doc, now);
    if (n > 0) {
      await doc.save();
      removed += n;
      students += 1;
    }
  }
  if (removed) console.log(`[priority] expired ${removed} past task(s) for ${students} student(s)`);
  return { removed, students };
}

let timer;

export function startPriorityScheduler() {
  // Run once on boot, then hourly. Errors are logged, never fatal.
  runExpiry().catch((e) => console.error('[priority] initial expiry error:', e?.message || e));
  timer = setInterval(
    () => runExpiry().catch((e) => console.error('[priority] expiry error:', e?.message || e)),
    INTERVAL_MS
  );
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
  console.log('[priority] hourly prioritization + expiry scheduler started');
}

export function stopPriorityScheduler() {
  if (timer) clearInterval(timer);
}
