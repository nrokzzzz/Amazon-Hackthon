import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';

import { config } from './config/env.js';
import { digestRouter, internalRouter } from './digest/routes.js';
import { startPriorityScheduler } from './digest/priorityScheduler.js';
import { connectProducer } from './kafka/producer.js';
import { startConsumer } from './kafka/consumer.js';

const PORT = config.port;

const app = express();
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'categorizer' }));

// Behind the gateway these are mounted at /college-info* and /internal*.
app.use('/college-info', digestRouter);
app.use('/internal', internalRouter);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Connect the Kafka producer + consumer in the background. Kafka may boot after
// us, so we retry forever — the HTTP API stays up regardless, and we never crash
// if the broker is briefly unavailable.
async function startKafka() {
  for (let attempt = 1; ; attempt++) {
    try {
      await connectProducer();
      await startConsumer();
      return;
    } catch (err) {
      const wait = Math.min(30000, 2 ** Math.min(attempt, 5) * 1000);
      console.error(`[categorizer] kafka init failed (attempt ${attempt}): ${err?.message || err} — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
}

async function start() {
  await mongoose.connect(config.mongoUri);
  console.log('[categorizer] connected to MongoDB');

  app.listen(PORT, () => {
    console.log(`[categorizer] listening on :${PORT}`);
  });

  // Background work — never blocks the HTTP server from coming up.
  startKafka().catch((err) => console.error('[categorizer] kafka fatal:', err?.message || err));
  startPriorityScheduler();
}

start().catch((err) => {
  console.error('[categorizer] failed to start', err);
  process.exit(1);
});
