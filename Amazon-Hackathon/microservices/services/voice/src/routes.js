import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { isDeepgramConfigured } from './config/env.js';
import { transcribe, synthesize } from './deepgram.js';

export const router = express.Router();

// The gateway verifies the JWT and forwards x-user-id. Downstream we just read it.
function requireAuth(req, res, next) {
  if (!req.headers['x-user-id']) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /voice/status — does the UI show mic/speaker controls?
router.get('/status', requireAuth, (_req, res) => {
  res.json({ configured: isDeepgramConfigured() });
});

// POST /voice/transcribe — multipart audio (field "audio") -> { transcript }.
router.post('/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  if (!isDeepgramConfigured()) return res.status(503).json({ error: 'voice_not_configured' });
  if (!req.file) return res.status(400).json({ error: 'no_audio' });
  try {
    const transcript = await transcribe(req.file.buffer, req.file.mimetype || 'audio/webm');
    res.json({ ok: true, transcript });
  } catch (err) {
    res.status(500).json({ error: 'transcribe_failed', message: String(err?.message || err) });
  }
});

const speakSchema = z.object({ text: z.string().min(1).max(2000) });

// POST /voice/speak — { text } -> MP3 audio (audio/mpeg).
router.post('/speak', requireAuth, async (req, res) => {
  if (!isDeepgramConfigured()) return res.status(503).json({ error: 'voice_not_configured' });
  const parsed = speakSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  try {
    const audio = await synthesize(parsed.data.text);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(audio);
  } catch (err) {
    res.status(500).json({ error: 'speak_failed', message: String(err?.message || err) });
  }
});
