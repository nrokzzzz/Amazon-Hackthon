import { GoogleConnection } from '../models/GoogleConnection.js';
import { startWatch } from './watch.js';

// Gmail watches expire after ~7 days. This scheduler keeps email capture fully
// automatic: on boot and on an interval it (re)starts the watch for every
// connected connection whose watch is missing or about to expire. No user action.
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000; // renew when <24h of life remains
const INTERVAL_MS = 12 * 60 * 60 * 1000; // re-check every 12 hours

export async function reconcileWatches(now = Date.now()) {
  const conns = await GoogleConnection.find({ refresh_token: { $exists: true, $ne: null } });

  let started = 0;
  let renewed = 0;
  let failed = 0;

  for (const c of conns) {
    const watching = Boolean(c.gmail?.watching);
    const exp = Number(c.gmail?.watch_expiration || 0);
    const needsStart = !watching;
    const needsRenew = watching && exp - now < RENEW_BEFORE_MS;
    if (!needsStart && !needsRenew) continue;

    try {
      await startWatch(c);
      if (needsStart) started++;
      else renewed++;
    } catch (err) {
      failed++;
      console.error(`[gmail] watch reconcile failed for ${c.googleEmail || c.userId}:`, err?.message || err);
    }
  }

  if (started || renewed || failed) {
    console.log(`[gmail] watch reconcile: ${started} started, ${renewed} renewed, ${failed} failed`);
  }
  return { started, renewed, failed };
}

let timer;

export function startWatchScheduler() {
  // Run once shortly after boot (don't block startup), then on an interval.
  reconcileWatches().catch((e) => console.error('[gmail] initial reconcile error:', e?.message || e));
  timer = setInterval(
    () => reconcileWatches().catch((e) => console.error('[gmail] reconcile error:', e?.message || e)),
    INTERVAL_MS
  );
  if (timer.unref) timer.unref(); // don't keep the process alive just for this
  console.log('[gmail] watch auto-renewal scheduler started (checks every 12h)');
}

export function stopWatchScheduler() {
  if (timer) clearInterval(timer);
}
