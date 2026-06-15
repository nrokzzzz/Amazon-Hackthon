// Zero-setup dev launcher: boots the real Express app against an in-memory
// MongoDB. No MongoDB install, no Atlas signup. Data resets on each restart —
// fine for a demo/dev session.  Run:  npm run dev:mem
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri('campusflow');
console.log('[dev:mem] started in-memory MongoDB (data is NOT persisted across restarts)');

// Import AFTER setting MONGODB_URI so config picks it up, then start the server.
const { start } = await import('../server.js');
await start();

async function shutdown() {
  console.log('\n[dev:mem] shutting down in-memory MongoDB…');
  try { await mongod.stop(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
