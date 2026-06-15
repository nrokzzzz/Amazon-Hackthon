// Standalone test for the MongoDB-native scheduler. Boots an in-memory MongoDB
// (no install needed) and exercises the engine end-to-end:
//   - due jobs are claimed + run; future jobs are left alone
//   - the digest-expiry handler prunes past tasks and reschedules to the next one
//   - failures retry with backoff (attempts increment, error recorded)
//   - crashed runs (expired lease) are reclaimed
//   - a batch of due jobs is processed in one tick
//
//   npm run test:jobs
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri('campusflow');

// Import AFTER setting MONGODB_URI so config picks it up.
const { connectDB } = await import('../config/db.js');
const { ScheduledJob } = await import('../models/ScheduledJob.js');
const { CollegeInfo } = await import('../models/CollegeInfo.js');
const { nextExpiryAt } = await import('../digest/priority.js');
const { HANDLERS } = await import('../jobs/registry.js');
const { tick, reclaim } = await import('../jobs/scheduler.js');

let passed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

const DAY = 24 * 60 * 60 * 1000;
const oid = () => new mongoose.Types.ObjectId();

async function main() {
  await connectDB();
  await ScheduledJob.syncIndexes();
  const now = new Date();

  // --- 1. digest_expiry: prune past task, reschedule to next deadline ---------
  console.log('\n[1] digest_expiry claims, prunes & reschedules');
  const sid = oid();
  await CollegeInfo.create({
    student_id: sid,
    exam_timetable: [{ category: 'exam_timetable', title: 'Old exam', datetime: new Date(now.getTime() - 2 * DAY) }],
    assignment_deadlines: [{ category: 'assignment_deadlines', title: 'Future assignment', datetime: new Date(now.getTime() + 2 * DAY) }],
  });
  await ScheduledJob.create({ type: 'digest_expiry', ref_id: sid, status: 'idle', next_run_at: new Date(now.getTime() - 1000) });

  await tick();

  const doc = await CollegeInfo.findOne({ student_id: sid });
  const job = await ScheduledJob.findOne({ type: 'digest_expiry', ref_id: sid });
  assert(doc.exam_timetable.length === 0, 'past task pruned');
  assert(doc.assignment_deadlines.length === 1, 'future task kept');
  assert(job.status === 'idle', 'job released to idle');
  assert(job.attempts === 0, 'attempts reset to 0 on success');
  assert(job.last_error == null, 'no error recorded');
  const expected = nextExpiryAt(doc, now);
  assert(job.next_run_at.getTime() === expected.getTime(), 'rescheduled to next deadline expiry');

  // --- 2. future jobs are not claimed ----------------------------------------
  console.log('\n[2] future jobs are left alone');
  const fid = oid();
  const futureAt = new Date(now.getTime() + 60 * 60 * 1000);
  await ScheduledJob.create({ type: 'digest_expiry', ref_id: fid, status: 'idle', next_run_at: futureAt });
  await tick();
  const futureJob = await ScheduledJob.findOne({ type: 'digest_expiry', ref_id: fid });
  assert(futureJob.status === 'idle' && futureJob.attempts === 0, 'future job untouched');
  assert(futureJob.next_run_at.getTime() === futureAt.getTime(), 'future job not rescheduled');

  // --- 3. failures retry with backoff ----------------------------------------
  console.log('\n[3] failing handler retries with backoff');
  HANDLERS.test_fail = async () => { throw new Error('boom'); };
  const failId = oid();
  await ScheduledJob.create({ type: 'test_fail', ref_id: failId, status: 'idle', next_run_at: new Date(now.getTime() - 1000) });
  await tick();
  const failJob = await ScheduledJob.findOne({ type: 'test_fail', ref_id: failId });
  assert(failJob.status === 'idle', 'failed job released to idle');
  assert(failJob.attempts === 1, 'attempts incremented on failure');
  assert(/boom/.test(failJob.last_error || ''), 'error message recorded');
  assert(failJob.next_run_at.getTime() > now.getTime(), 'rescheduled into the future (backoff)');

  // --- 4. crashed runs are reclaimed -----------------------------------------
  console.log('\n[4] expired-lease jobs are reclaimed');
  const stuckId = oid();
  await ScheduledJob.create({
    type: 'digest_expiry', ref_id: stuckId, status: 'running',
    next_run_at: new Date(now.getTime() + DAY), locked_until: new Date(now.getTime() - 1000),
  });
  const reclaimed = await reclaim(new Date());
  const stuck = await ScheduledJob.findOne({ type: 'digest_expiry', ref_id: stuckId });
  assert(reclaimed >= 1, 'reclaim reported >=1');
  assert(stuck.status === 'idle', 'stuck job returned to idle');

  // --- 5. a batch of due jobs runs in one tick -------------------------------
  console.log('\n[5] batch of due jobs processed together');
  HANDLERS.test_ok = async (_job, n) => new Date(n.getTime() + DAY);
  const ids = [oid(), oid(), oid()];
  for (const id of ids) {
    await ScheduledJob.create({ type: 'test_ok', ref_id: id, status: 'idle', next_run_at: new Date(now.getTime() - 1000) });
  }
  await tick();
  const okJobs = await ScheduledJob.find({ type: 'test_ok' });
  assert(okJobs.length === 3 && okJobs.every((j) => j.status === 'idle'), 'all batch jobs idle');
  assert(okJobs.every((j) => j.next_run_at.getTime() > now.getTime()), 'all batch jobs rescheduled');

  console.log(`\n✅ ALL ${passed} ASSERTIONS PASSED`);
}

main()
  .then(async () => { await mongoose.connection.close(); await mongod.stop(); process.exit(0); })
  .catch(async (err) => {
    console.error('\n❌', err.message);
    try { await mongoose.connection.close(); await mongod.stop(); } catch {}
    process.exit(1);
  });
