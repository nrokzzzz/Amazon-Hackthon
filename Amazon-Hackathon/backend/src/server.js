import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config, isBedrockConfigured, isGoogleConfigured, isGmailConfigured, isGeminiConfigured, isDeepgramConfigured } from './config/env.js';
import { connectDB } from './config/db.js';

import { authRouter } from './auth/routes.js';
import { profileRouter } from './profile/routes.js';
import { portalRouter } from './portal/routes.js';
import { eventsRouter } from './events/routes.js';
import { calendarRouter } from './calendar/routes.js';
import { gmailRouter } from './gmail/routes.js';
import { digestRouter } from './digest/routes.js';
import { chatRouter } from './chat/routes.js';
import { voiceRouter } from './voice/routes.js';
import { attachVoiceStream } from './voice/stream.js';
import { startWatchScheduler } from './gmail/scheduler.js';
import { startPriorityScheduler } from './digest/priorityScheduler.js';

const app = express();

// --- Request logging (Morgan) ---------------------------------------------
// Logs EVERY incoming request (users + the Pub/Sub webhook) on response.
// We redact the ?token=... secret from the Gmail webhook URL, show who made
// the request (auth user / Google Pub/Sub UA), and the request body size.
morgan.token('url-clean', (req) => req.originalUrl.replace(/([?&]token=)[^&]+/i, '$1***'));
morgan.token('actor', (req) => {
  const ua = req.headers['user-agent'] || '';
  if (/APIs-Google|PubSub|Google-Cloud-PubSub/i.test(ua)) return 'pubsub';
  return req.headers.authorization ? 'auth-user' : 'anon';
});
app.use(
  morgan(
    ':date[iso] :actor :method :url-clean :status :res[content-length]b :response-time ms ":user-agent"'
  )
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

// Health + capability probe (handy for the frontend banner).
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'campusflow-backend',
    extraction: isBedrockConfigured() ? 'bedrock' : 'fallback (rule-based)',
    google_calendar: isGoogleConfigured() ? 'configured' : 'simulation',
    gmail_push: isGmailConfigured() ? 'configured' : 'disabled',
    categorizer: isGeminiConfigured() ? 'gemini' : 'fallback (rule-based)',
    voice: isDeepgramConfigured() ? 'deepgram' : 'disabled',
  });
});

// Feature routers
app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/portal', portalRouter);
app.use('/events', eventsRouter);
app.use('/gmail', gmailRouter);
app.use('/college-info', digestRouter); // structured per-student college digest
app.use('/chat', chatRouter); // chatbot grounded in the digest
app.use('/voice', voiceRouter); // Deepgram speech-to-text + text-to-speech
app.use('/', calendarRouter); // /auth/google/* and /calendar/* (absolute paths)

// 404
app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error', message: String(err?.message || err) });
});

export async function start() {
  await connectDB();
  const server = app.listen(config.port, () => {
    console.log(`[server] CampusFlow backend on http://localhost:${config.port}`);
    console.log(`[server] extraction: ${isBedrockConfigured() ? 'Bedrock' : 'rule-based fallback'}`);
    console.log(`[server] google calendar: ${isGoogleConfigured() ? 'configured' : 'simulation mode'}`);
    console.log(`[server] gmail push: ${isGmailConfigured() ? 'configured' : 'disabled'}`);
    console.log(`[server] voice: ${isDeepgramConfigured() ? 'deepgram (live STT + TTS)' : 'disabled'}`);
  });

  // Live speech-to-text WebSocket proxy (/voice/stream).
  attachVoiceStream(server);

  // Keep Gmail watches alive automatically (no user action needed).
  if (isGmailConfigured()) startWatchScheduler();

  // Hourly: re-prioritize + drop tasks whose time has passed (per student).
  startPriorityScheduler();

  return server;
}

// Only auto-start when run directly (e.g. `node src/server.js`), not on import
// (so tests can mount the app against their own DB without racing start()).
const runDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (runDirectly) {
  start().catch((err) => {
    console.error('[fatal] failed to start:', err);
    process.exit(1);
  });
}

export { app };
