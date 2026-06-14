import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { RawItem, hashContent } from '../models/RawItem.js';
import { requireAuth } from '../auth/jwt.js';
import { processRawItem } from '../pipeline/processItem.js';
import { notices } from '../portal/data.js';

export const ingestRouter = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// Create a RawItem (deduped by content_hash) and run it through the pipeline.
// Returns { skipped } when the same content was already ingested for this student.
async function ingestOne(student, source, rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { skipped: true, reason: 'empty' };

  const content_hash = hashContent(text);
  const existing = await RawItem.findOne({ student_id: student._id, content_hash });
  if (existing) return { skipped: true, reason: 'duplicate', raw_item_id: existing._id };

  const item = await RawItem.create({
    student_id: student._id,
    source,
    raw_text: text,
    content_hash,
    status: 'pending',
  });

  const result = await processRawItem(item);
  return { skipped: false, raw_item_id: item._id, ...result };
}

const pasteSchema = z.object({
  text: z.string().min(1),
  source: z.enum(['email', 'notice', 'upload', 'portal']).optional().default('notice'),
});

// POST /ingest/paste — student pastes an email/notice as text.
ingestRouter.post('/paste', requireAuth, async (req, res) => {
  const parsed = pasteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  try {
    const result = await ingestOne(req.student, parsed.data.source, parsed.data.text);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'processing_failed', message: String(err?.message || err) });
  }
});

// POST /ingest/upload — upload a .eml / .txt file (multipart field "file").
ingestRouter.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const text = req.file.buffer.toString('utf-8');
  try {
    const result = await ingestOne(req.student, 'email', text);
    res.json({ ok: true, filename: req.file.originalname, ...result });
  } catch (err) {
    res.status(500).json({ error: 'processing_failed', message: String(err?.message || err) });
  }
});

// POST /ingest/portal — pull the mock college portal notices and run them all
// through the pipeline for this student. The big "drop in the pile" demo moment.
ingestRouter.post('/portal', requireAuth, async (req, res) => {
  const results = [];
  for (const n of notices()) {
    try {
      results.push({ id: n.id, ...(await ingestOne(req.student, 'portal', n.text)) });
    } catch (err) {
      results.push({ id: n.id, error: String(err?.message || err) });
    }
  }
  const totals = results.reduce(
    (acc, r) => {
      if (r.skipped) acc.skipped++;
      else if (r.error) acc.failed++;
      else {
        acc.ingested++;
        acc.events += r.events || 0;
        acc.matches += r.matches || 0;
      }
      return acc;
    },
    { ingested: 0, skipped: 0, failed: 0, events: 0, matches: 0 }
  );
  res.json({ ok: true, totals, results });
});
