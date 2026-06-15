// Ensure a database is available for the dev tunnel — WITHOUT requiring a
// system MongoDB install:
//   - remote URI (Atlas / mongodb+srv)        -> use it, manage nothing
//   - a MongoDB already running on host:port   -> reuse it
//   - otherwise                                -> start a PERSISTENT mongod via
//        mongodb-memory-server pointed at .mongo-data (binary is auto-downloaded
//        & cached; data survives restarts). Overrides MONGODB_URI to point at it.
import net from 'net';
import fs from 'fs';

function parseUri(uri) {
  const host = (uri.match(/mongodb:\/\/([^:/,]+)/) || [])[1] || '127.0.0.1';
  const port = Number((uri.match(/mongodb:\/\/[^/]*?:(\d+)/) || [])[1] || 27017);
  return { host, port };
}

function isPortOpen(host, port, timeout = 800) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

// Returns { managed, stop }. `stop` is a no-op when we didn't start anything.
export async function ensureLocalMongo(uri, dbPath) {
  // Remote DB — nothing to manage.
  if (!uri.startsWith('mongodb://')) return { managed: false, stop: async () => {} };

  const { host, port } = parseUri(uri);
  const isLocal = host === '127.0.0.1' || host === 'localhost';

  // A MongoDB is already up (manual mongod / service) — just use it.
  if (isLocal && (await isPortOpen(host, port))) {
    console.log(`[mongo] using MongoDB already running on ${host}:${port}`);
    return { managed: false, stop: async () => {} };
  }

  // Start our own persistent mongod via mongodb-memory-server.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  fs.mkdirSync(dbPath, { recursive: true });

  const server = await MongoMemoryServer.create({
    instance: { dbName: 'campusflow', dbPath, storageEngine: 'wiredTiger' },
  });
  // Point the app at the instance we just started (persisted under dbPath).
  process.env.MONGODB_URI = server.getUri('campusflow');
  console.log(`[mongo] started persistent MongoDB (data persists in ${dbPath})`);

  return {
    managed: true,
    // doCleanup:false => keep the data files on disk for next run.
    stop: async () => {
      try {
        await server.stop({ doCleanup: false });
      } catch {
        /* ignore */
      }
    },
  };
}
