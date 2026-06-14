import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import { router } from './routes.js';

const PORT = process.env.PORT || 8080;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusflow_auth';

const app = express();
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'auth' }));

app.use('/', router);

async function start() {
  await mongoose.connect(MONGO_URI);
  console.log('auth: connected to MongoDB');
  app.listen(PORT, () => {
    console.log(`auth listening on :${PORT}`);
  });
}

start().catch((err) => {
  console.error('auth: failed to start', err);
  process.exit(1);
});
