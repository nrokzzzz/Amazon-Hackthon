import { runDigestExpiry } from './handlers/digestExpiry.js';
import { runGmailWatchRenew } from './handlers/gmailWatchRenew.js';

// type -> handler(job, now) => returns the next due Date (or null to use the
// job's interval). Add a new recurring job by registering its handler here.
export const HANDLERS = {
  digest_expiry: runDigestExpiry,
  gmail_watch_renew: runGmailWatchRenew,
};
