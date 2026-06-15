import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../auth/jwt.js';
import { isGeminiConfigured } from '../config/env.js';
import { CollegeInfo } from '../models/CollegeInfo.js';
import { categorizeAndStore } from './store.js';
import { digestCounts } from './serialize.js';
import { prioritizeDigest } from './priority.js';
import { CATEGORIES } from './categories.js';
import { extractAttachment, MAX_FILE_BYTES } from '../attachments/extract.js';

export const digestRouter = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

// GET /college-info — the student's full structured digest (all categories).
digestRouter.get('/', requireAuth, async (req, res) => {
  const doc = await CollegeInfo.findOne({ student_id: req.student._id });
  res.json({
    ok: true,
    engine: isGeminiConfigured() ? 'gemini' : 'fallback (rule-based)',
    counts: digestCounts(doc),
    data: doc || Object.fromEntries(CATEGORIES.map((c) => [c, []])),
  });
});

// GET /college-info/tasks — the student's items, prioritized (most important
// first) by deadline urgency + category + their goals/focus, with alerts.
digestRouter.get('/tasks', requireAuth, async (req, res) => {
  const doc = await CollegeInfo.findOne({ student_id: req.student._id });
  const profile = req.student.profile?.toObject?.() ?? req.student.profile ?? {};
  const tasks = prioritizeDigest(doc, profile);
  res.json({
    ok: true,
    tasks,
    alerts: tasks.filter((t) => t.alert),
    overlaps: tasks.filter((t) => t.overlap),
  });
});

// GET /college-info/:category — one bucket (e.g. /college-info/exam_timetable).
digestRouter.get('/:category', requireAuth, async (req, res) => {
  const { category } = req.params;
  if (!CATEGORIES.includes(category)) return res.status(404).json({ error: 'unknown_category' });
  const doc = await CollegeInfo.findOne({ student_id: req.student._id });
  res.json({ ok: true, category, items: doc?.[category] || [] });
});

const ingestSchema = z.object({ text: z.string().min(1), subject: z.string().optional().default('') });

// POST /college-info/ingest — manually categorize+store a pasted email (demo/
// testing path that doesn't require the Gmail webhook).
digestRouter.post('/ingest', requireAuth, async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  try {
    const result = await categorizeAndStore(req.student, {
      text: parsed.data.text,
      source: 'paste',
      subject: parsed.data.subject,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'categorize_failed', message: String(err?.message || err) });
  }
});

// POST /college-info/upload — upload an attachment (PDF/image/docx/xlsx/csv/txt)
// directly, read it the same way the Gmail flow does, and store the results.
// Field name: "file". Optional text fields: subject, text (extra context).
digestRouter.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const extracted = await extractAttachment(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (extracted.skipped) {
      return res.status(415).json({ error: 'unsupported_file', reason: extracted.reason, filename: req.file.originalname });
    }

    const files = extracted.file ? [extracted.file] : [];
    const text = [req.body?.subject ? `Subject: ${req.body.subject}` : '', req.body?.text || '', extracted.text || '']
      .filter(Boolean)
      .join('\n\n') || `(see attached file: ${req.file.originalname})`;

    const result = await categorizeAndStore(req.student, {
      text,
      files,
      source: 'upload',
      subject: req.body?.subject || req.file.originalname,
    });
    res.json({ ok: true, filename: req.file.originalname, kind: extracted.file ? 'native' : 'text', ...result });
  } catch (err) {
    res.status(500).json({ error: 'categorize_failed', message: String(err?.message || err) });
  }
});
