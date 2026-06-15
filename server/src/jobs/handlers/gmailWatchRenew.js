import { Student } from '../../models/Student.js';
import { startWatch } from '../../gmail/watch.js';

const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000; // renew 24h before expiry
const DISCONNECTED_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const FALLBACK_MS = 6 * 24 * 60 * 60 * 1000; // ~Gmail watch lifetime if no expiry returned

// (Re)register one student's Gmail watch, then return WHEN to renew next: 24h
// before the new expiration. Throwing here is fine — the engine retries with
// exponential backoff. Only runs per-student near expiry, never as a full scan.
export async function runGmailWatchRenew(job, now = new Date()) {
  const student = await Student.findById(job.ref_id);
  // No longer connected -> nothing to renew; drift far out (and removeJob on
  // disconnect handles the common case).
  if (!student || !student.gcal?.refresh_token) {
    return new Date(now.getTime() + DISCONNECTED_RECHECK_MS);
  }

  await startWatch(student); // updates student.gmail.watch_expiration; throws on failure

  const exp = Number(student.gmail?.watch_expiration || 0);
  const next = exp ? exp - RENEW_BEFORE_MS : now.getTime() + FALLBACK_MS;
  // Never schedule in the past (e.g. clock skew / very short-lived watch).
  return new Date(Math.max(next, now.getTime() + 60 * 1000));
}
