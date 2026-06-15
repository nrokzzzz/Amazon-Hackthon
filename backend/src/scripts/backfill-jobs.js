// One-time migration: create scheduled jobs for data that already exists, so the
// new scheduler takes over from the old full-scan setInterval loops.
//
//   node src/scripts/backfill-jobs.js
//
// Safe to re-run (idempotent upserts). Uses a streaming cursor + bulkWrite so it
// works even with millions of rows without loading them all into memory. This is
// the ONLY full scan in the system, and it runs once.
import { connectDB } from '../config/db.js';
import mongoose from 'mongoose';
import { CollegeInfo } from '../models/CollegeInfo.js';
import { Student } from '../models/Student.js';
import { ScheduledJob } from '../models/ScheduledJob.js';
import { nextExpiryAt } from '../digest/priority.js';

const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
const BATCH = 1000;

// Upsert a batch of jobs. $setOnInsert keeps existing rows untouched; we only
// seed next_run_at on first creation so a re-run never disturbs live schedules.
async function flush(ops) {
  if (!ops.length) return 0;
  const res = await ScheduledJob.bulkWrite(ops, { ordered: false });
  return res.upsertedCount || 0;
}

async function backfillDigestExpiry(now) {
  let created = 0;
  let ops = [];
  // Stream full docs (we need the dated items to compute the next expiry instant).
  for await (const doc of CollegeInfo.find({}).cursor()) {
    const due = nextExpiryAt(doc, now) || new Date(now.getTime() + 60 * 60 * 1000);
    ops.push({
      updateOne: {
        filter: { type: 'digest_expiry', ref_id: doc.student_id },
        update: { $setOnInsert: { type: 'digest_expiry', ref_id: doc.student_id, status: 'idle', attempts: 0, next_run_at: due } },
        upsert: true,
      },
    });
    if (ops.length >= BATCH) { created += await flush(ops); ops = []; }
  }
  created += await flush(ops);
  return created;
}

async function backfillWatchRenew(now) {
  let created = 0;
  let ops = [];
  const q = { 'gcal.refresh_token': { $exists: true, $ne: null } };
  for await (const s of Student.find(q, { gmail: 1 }).cursor()) {
    const exp = Number(s.gmail?.watch_expiration || 0);
    const due = exp ? new Date(exp - RENEW_BEFORE_MS) : new Date(now.getTime() + 60 * 1000);
    ops.push({
      updateOne: {
        filter: { type: 'gmail_watch_renew', ref_id: s._id },
        update: { $setOnInsert: { type: 'gmail_watch_renew', ref_id: s._id, status: 'idle', attempts: 0, next_run_at: due } },
        upsert: true,
      },
    });
    if (ops.length >= BATCH) { created += await flush(ops); ops = []; }
  }
  created += await flush(ops);
  return created;
}

async function main() {
  await connectDB();
  const now = new Date();
  const expiry = await backfillDigestExpiry(now);
  const watch = await backfillWatchRenew(now);
  console.log(`[backfill] created ${expiry} digest_expiry + ${watch} gmail_watch_renew job(s)`);
  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
