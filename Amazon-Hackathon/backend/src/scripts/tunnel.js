// Starts the CampusFlow backend AND opens a public HTTPS tunnel with ngrok, then
// prints the exact URLs to paste into Google Cloud (Pub/Sub push + OAuth).
//
//   npm run dev:tunnel       -> uses your real MONGODB_URI (data persists)
//   npm run dev:tunnel:mem   -> zero-setup in-memory MongoDB (resets each restart)
//
// Needs an ngrok authtoken (free): https://dashboard.ngrok.com/get-started/your-authtoken
//   - put it in backend/.env as NGROK_AUTHTOKEN=...
//   - optional NGROK_DOMAIN=your-static-domain.ngrok-free.app for a STABLE url
//     (so you only configure Pub/Sub once instead of after every restart).
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import ngrok from '@ngrok/ngrok';
import { ensureLocalMongo } from './mongoLocal.js';

const useMem = process.argv.includes('--mem') || process.env.USE_MEMORY_DB === '1';

const authtoken = process.env.NGROK_AUTHTOKEN || '';
if (!authtoken) {
  console.error(
    '\n[tunnel] NGROK_AUTHTOKEN is not set in backend/.env.\n' +
      '         Get a free token at https://dashboard.ngrok.com/get-started/your-authtoken\n'
  );
  process.exit(1);
}

// 0) Make sure a database is available BEFORE importing the app (config/env.js
//    reads MONGODB_URI at import time).
//    --mem  -> ephemeral in-memory DB (resets each restart)
//    else   -> auto-start a persistent local mongod against .mongo-data
//              (or reuse one that's already running)
let mongod; // in-memory handle
let localMongo; // spawned mongod handle
if (useMem) {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('campusflow');
  console.log('[tunnel] using in-memory MongoDB (data is NOT persisted across restarts)');
} else {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusflow';
  const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.mongo-data');
  try {
    localMongo = await ensureLocalMongo(uri, dbPath);
  } catch (err) {
    console.error('\n[tunnel] ' + (err?.message || err) + '\n');
    process.exit(1);
  }
}

// 1) Boot the Express app (connects DB + listens on config.port).
const { start } = await import('../server.js');
const { config } = await import('../config/env.js');

try {
  await start();
} catch (err) {
  console.error('\n[tunnel] backend failed to start:', err?.message || err);
  if (!useMem && /ECONNREFUSED|ServerSelection/i.test(String(err?.message || err))) {
    console.error(
      '         MongoDB is not reachable. Either start MongoDB, or run a zero-setup\n' +
        '         in-memory DB instead:  npm run dev:tunnel:mem\n'
    );
  }
  process.exit(1);
}

// 2) Open the tunnel to the local port.
let listener;
try {
  listener = await ngrok.connect({
    addr: config.port,
    authtoken,
    ...(process.env.NGROK_DOMAIN ? { domain: process.env.NGROK_DOMAIN } : {}),
  });
} catch (err) {
  console.error('[tunnel] failed to start ngrok:', err?.message || err);
  process.exit(1);
}

const url = listener.url();
const token = config.gmail.pubsubToken;
const bar = '─'.repeat(64);

console.log(`\n${bar}`);
console.log(`  Public HTTPS URL : ${url}`);
console.log(`  Health check     : ${url}/health`);
console.log(`  Gmail webhook    : ${url}/gmail/pubsub${token ? `?token=${token}` : ''}`);
console.log(`                     ^ set this as the Pub/Sub push subscription endpoint`);
console.log(`  OAuth redirect   : ${url}/auth/google/callback`);
console.log(`                     ^ add to Google console + GOOGLE_REDIRECT_URI if connecting via the tunnel`);
console.log(`${bar}\n`);

// Keep the process alive and shut things down cleanly on Ctrl+C.
const shutdown = async () => {
  console.log('\n[tunnel] closing…');
  try {
    await ngrok.disconnect();
  } catch {
    /* ignore */
  }
  try {
    if (mongod) await mongod.stop();
    if (localMongo) await localMongo.stop();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
