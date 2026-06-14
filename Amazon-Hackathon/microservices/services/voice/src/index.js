import http from 'http';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config, isDeepgramConfigured } from './config/env.js';
import { router } from './routes.js';
import { attachVoiceStream } from './stream.js';

const app = express();
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json({ limit: '25mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'voice' }));

// Mounted at /voice so behind the gateway paths are /voice/*.
app.use('/voice', router);

// Explicit HTTP server so we can attach the WebSocket upgrade handler.
const server = http.createServer(app);

// Live speech-to-text WebSocket proxy (/voice/stream).
attachVoiceStream(server);

server.listen(config.port, () => {
  console.log(`voice listening on :${config.port}`);
  console.log(`voice: ${isDeepgramConfigured() ? 'deepgram (live STT + TTS)' : 'disabled (no DEEPGRAM_API_KEY)'}`);
});
