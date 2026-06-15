// Helpers to create / move a scheduled job. Kept dependency-light (imports only
// the model) so lifecycle hooks in store.js / watch.js can call them WITHOUT
// pulling in the handlers — avoiding an import cycle (watch -> handler -> watch).
import { ScheduledJob } from '../models/ScheduledJob.js';

// Ensure a job exists and is due NO LATER than `nextRunAt`. Uses $min, so a newly
// arrived (sooner) deadline pulls the job earlier, but a later one never delays an
// already-pending run. Ideal for "fire when the next thing expires" (digest).
export async function ensureJobEarliest(type, refId, nextRunAt, intervalMs) {
  await ScheduledJob.updateOne(
    { type, ref_id: refId },
    {
      $min: { next_run_at: nextRunAt },
      $setOnInsert: {
        type,
        ref_id: refId,
        status: 'idle',
        attempts: 0,
        ...(intervalMs ? { interval_ms: intervalMs } : {}),
      },
    },
    { upsert: true }
  );
}

// Set a job's next run to an exact instant (create if missing). Use when the next
// time is known precisely — e.g. renew a Gmail watch 24h before it expires.
export async function setJobNextRun(type, refId, nextRunAt, intervalMs) {
  await ScheduledJob.updateOne(
    { type, ref_id: refId },
    {
      $set: { next_run_at: nextRunAt, ...(intervalMs ? { interval_ms: intervalMs } : {}) },
      $setOnInsert: { type, ref_id: refId, status: 'idle', attempts: 0 },
    },
    { upsert: true }
  );
}

// Stop a recurring job (e.g. the student disconnected Google).
export async function removeJob(type, refId) {
  await ScheduledJob.deleteOne({ type, ref_id: refId });
}
