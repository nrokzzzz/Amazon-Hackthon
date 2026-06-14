import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import { router } from './routes.js';
import { initProducer, initConsumer } from './kafka/kafka.js';
import { onDigestUpdated } from './calendar/consumer.js';
import { startWatchScheduler } from './gmail/scheduler.js';

const app = express();

app.use(cors());
app.use(morgan('tiny'));
// Pub/Sub envelopes carry base64 file payloads inside email bodies indirectly,
// and digest items can be large — allow a generous JSON limit.
app.use(express.json({ limit: '25mb' }));

// Health check.
app.get('/health', (_req, res) => res.json({ ok: true, service: 'integration' }));

// All feature routes are mounted at root (paths are absolute, as seen behind
// the gateway: /auth/google/*, /gmail/*, /calendar/*).
app.use('/', router);

// Initialize Kafka (producer + consumer) in the BACKGROUND so a slow/booting
// Kafka never blocks or crashes the service. Each has its own retry loop.
function initKafkaBackground() {
  initProducer().catch((err) => console.error('[kafka] producer init error:', err?.message || err));
  initConsumer(onDigestUpdated).catch((err) =>
    console.error('[kafka] consumer init error:', err?.message || err)
  );
}

async function start() {
  // Connect Mongo BEFORE listening so handlers have a live connection.
  await mongoose.connect(config.mongoUri);
  console.log(`[mongo] connected: ${config.mongoUri}`);

  const port = config.port;
  app.listen(port, () => {
    console.log(`integration listening on :${port}`);
    // Kick off Kafka init + the watch auto-renew scheduler after we're up.
    initKafkaBackground();
    startWatchScheduler();
  });
}

start().catch((err) => {
  console.error('[integration] fatal startup error:', err?.message || err);
  process.exit(1);
});
