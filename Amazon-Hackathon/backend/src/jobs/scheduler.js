import { ScheduledJob } from '../models/ScheduledJob.js';
import { HANDLERS } from './registry.js';

// ---------------------------------------------------------------------------
// MongoDB-native distributed scheduler.
//
// Instead of scanning the whole collection on a timer, each tick runs ONE indexed
// range query for due jobs and atomically leases them. Because the claim is a
// single-document findOneAndUpdate, any number of scheduler/worker processes can
// run this concurrently and never double-process a job. Crashed runs are released
// by lease expiry (reclaim). This needs no Redis/broker — just MongoDB.
// ---------------------------------------------------------------------------

const POLL_MS = Number(process.env.JOB_POLL_MS || 5_000); // how often to look for due jobs
const BATCH = Number(process.env.JOB_BATCH || 200); // max jobs handled per tick
const CONCURRENCY = Number(process.env.JOB_CONCURRENCY || 16); // jobs run in parallel
const LEASE_MS = Number(process.env.JOB_LEASE_MS || 120_000); // claim lease (crash recovery window)
const RECLAIM_MS = Number(process.env.JOB_RECLAIM_MS || 30_000);
const MAX_ATTEMPTS = Number(process.env.JOB_MAX_ATTEMPTS || 6); // give up (DLQ-style) after this many fails

let pollTimer;
let reclaimTimer;
let ticking = false;
let stopped = false;

// Atomically claim the single most-overdue idle job: flips it to 'running' and
// stamps a lease. The unique winner is whichever instance's update lands first.
async function claimOne(now) {
  return ScheduledJob.findOneAndUpdate(
    { status: 'idle', next_run_at: { $lte: now } },
    {
      $set: { status: 'running', locked_until: new Date(now.getTime() + LEASE_MS) },
      $inc: { attempts: 1 },
    },
    { sort: { next_run_at: 1 }, new: true }
  );
}

// Exponential backoff with a 10-minute ceiling.
function backoffMs(attempts) {
  return Math.min(2 ** attempts * 1_000, 10 * 60 * 1_000);
}

// ±10% jitter so jobs that share a cadence don't stampede the same instant.
function jitter(ms) {
  return Math.floor(Math.random() * ms * 0.1);
}

// Run one claimed job and reschedule it (success -> handler's next due time;
// failure -> backoff, or a full interval out once attempts are exhausted).
export async function runJob(job, now = new Date()) {
  const handler = HANDLERS[job.type];
  if (!handler) {
    job.status = 'idle';
    job.locked_until = null;
    job.last_error = `no handler for type "${job.type}"`;
    job.next_run_at = new Date(now.getTime() + 24 * 60 * 60 * 1_000); // park it; don't hot-loop
    await job.save();
    return;
  }

  try {
    const next = await handler(job, now);
    job.status = 'idle';
    job.attempts = 0;
    job.last_run_at = now;
    job.last_error = null;
    job.locked_until = null;
    job.next_run_at =
      next instanceof Date ? next : new Date(now.getTime() + job.interval_ms + jitter(job.interval_ms));
    await job.save();
  } catch (err) {
    job.status = 'idle';
    job.locked_until = null;
    job.last_error = String(err?.message || err);
    if (job.attempts >= MAX_ATTEMPTS) {
      // Dead-letter behaviour: stop hammering, retry next full interval, keep the
      // error for inspection. (Swap for a dead-letter collection if you prefer.)
      console.error(`[jobs] ${job.type} ${job.ref_id} gave up after ${job.attempts} attempts: ${job.last_error}`);
      job.attempts = 0;
      job.next_run_at = new Date(now.getTime() + job.interval_ms);
    } else {
      job.next_run_at = new Date(now.getTime() + backoffMs(job.attempts));
    }
    await job.save();
  }
}

// One pass: claim + run due jobs (up to BATCH) in small concurrent waves.
export async function tick() {
  if (ticking || stopped) return 0;
  ticking = true;
  let processed = 0;
  try {
    while (processed < BATCH && !stopped) {
      const wave = [];
      for (let i = 0; i < CONCURRENCY && processed + wave.length < BATCH; i++) {
        const job = await claimOne(new Date());
        if (!job) break;
        wave.push(job);
      }
      if (!wave.length) break; // nothing due — done for this tick
      await Promise.all(wave.map((j) => runJob(j)));
      processed += wave.length;
    }
  } catch (err) {
    console.error('[jobs] tick error:', err?.message || err);
  } finally {
    ticking = false;
  }
  return processed;
}

// Release jobs whose worker died mid-run (lease expired) back to 'idle'.
export async function reclaim(now = new Date()) {
  const r = await ScheduledJob.updateMany(
    { status: 'running', locked_until: { $lt: now } },
    { $set: { status: 'idle' } }
  );
  if (r.modifiedCount) console.log(`[jobs] reclaimed ${r.modifiedCount} stuck job(s)`);
  return r.modifiedCount || 0;
}

export function startJobScheduler() {
  stopped = false;
  pollTimer = setInterval(() => tick().catch((e) => console.error('[jobs] tick:', e?.message || e)), POLL_MS);
  reclaimTimer = setInterval(() => reclaim().catch((e) => console.error('[jobs] reclaim:', e?.message || e)), RECLAIM_MS);
  if (pollTimer.unref) pollTimer.unref();
  if (reclaimTimer.unref) reclaimTimer.unref();
  console.log(`[jobs] scheduler started (poll ${POLL_MS}ms, batch ${BATCH}, concurrency ${CONCURRENCY})`);
}

export function stopJobScheduler() {
  stopped = true;
  if (pollTimer) clearInterval(pollTimer);
  if (reclaimTimer) clearInterval(reclaimTimer);
}
