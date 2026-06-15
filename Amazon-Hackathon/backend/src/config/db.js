import mongoose from 'mongoose';
import { config } from './env.js';

let connected = false;

export async function connectDB() {
  if (connected) return mongoose.connection;
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
