// Standalone job-worker process. Run one or many of these (e.g. as separate
// Docker/K8s pods) to process the scheduled jobs independently of the API tier.
//
//   INLINE_JOBS=false  on the API  (so API replicas don't also run jobs)
//   npm run worker                  on each worker pod
//
// Many workers can run at once safely — claims are atomic and leased.
import { connectDB } from '../config/db.js';
import { startJobScheduler, stopJobScheduler } from './scheduler.js';

async function main() {
  await connectDB();
  startJobScheduler();
  console.log('[worker] job worker running — Ctrl+C to stop');

  const shutdown = (sig) => {
    console.log(`[worker] ${sig} received, stopping…`);
    stopJobScheduler();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
