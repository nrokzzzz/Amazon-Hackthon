import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { config } from './config/env.js';
import { router } from './routes.js';

const app = express();
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'chat' }));

// Mounted at /chat so behind the gateway paths are /chat/*.
app.use('/chat', router);

async function start() {
  await mongoose.connect(config.mongoUri);
  console.log('chat: connected to MongoDB');
  app.listen(config.port, () => {
    console.log(`chat listening on :${config.port}`);
  });
}

start().catch((err) => {
  console.error('chat: failed to start', err);
  process.exit(1);
});
