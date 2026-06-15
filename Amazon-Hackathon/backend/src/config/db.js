import mongoose from 'mongoose';
import dns from 'dns';
import { config } from './env.js';

let connected = false;

export async function connectDB() {
  if (connected) return mongoose.connection;

  // mongodb+srv:// resolves via a DNS SRV lookup. Some ISP/router/VPN resolvers
  // refuse SRV queries (querySrv ECONNREFUSED). Point Node at a public resolver
  // for this process so it works without changing OS network settings.
  if (config.dnsServers.length) {
    try {
      dns.setServers(config.dnsServers);
      console.log(`[db] using custom DNS servers for SRV lookup: ${config.dnsServers.join(', ')}`);
    } catch (e) {
      console.error('[db] failed to set custom DNS servers:', e?.message || e);
    }
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, {
    dbName: config.mongoDbName, // pin the DB name (Atlas URIs often omit it)
    serverSelectionTimeoutMS: 8000,
  });
  connected = true;
  console.log(`[db] connected to MongoDB "${config.mongoDbName}" (${redact(config.mongoUri)})`);
  return mongoose.connection;
}

function redact(uri) {
  // Hide credentials when logging the connection string.
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:****@');
}
