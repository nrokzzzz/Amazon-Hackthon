import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../auth/jwt.js';
import { isGeminiConfigured } from '../config/env.js';
import { geminiGenerate } from '../llm/gemini.js';
import { CollegeInfo } from '../models/CollegeInfo.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { serializeDigest } from '../digest/serialize.js';
import { CATEGORIES } from '../digest/categories.js';

export const chatRouter = express.Router();

const askSchema = z.object({ question: z.string().min(1) });

const HISTORY_PAGE = 20;

const CHAT_SYSTEM = `You are CampusFlow Assistant, a helpful chatbot for a college student.
You answer questions ONLY using the student's stored college information provided below.
Rules:
- Be concise and direct. Use the student's data; do not invent dates, venues, or facts.
- If the answer is not in the provided information, say you don't have that information yet and suggest what email/notice would contain it.
- When relevant, mention the specific date/time (IST) and any consequence (deadline, fee, debarment).`;

// Rule-based fallback: rank stored items by keyword overlap with the question.
function keywordAnswer(doc, question) {
  const q = question.toLowerCase();
  const words = q.split(/\W+/).filter((w) => w.length > 2);
  const hits = [];
  for (const cat of CATEGORIES) {
    for (const it of doc?.[cat] || []) {
      const hay = `${it.title} ${it.summary}`.toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      if (score > 0) hits.push({ score, cat, it });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) return "I don't have that information yet. It may arrive in a future college email or notice.";
  return hits
    .slice(0, 5)
    .map(({ cat, it }) => {
      const when = it.datetime ? ` (${new Date(it.datetime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })})` : '';
      return `• [${cat}] ${it.title}${when}: ${it.summary || ''}`.trim();
    })
    .join('\n');
}

// POST /chat/ask — answer a student question grounded in their CollegeInfo doc.
// Persists both the question and the answer so history survives reloads.
chatRouter.post('/ask', requireAuth, async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const doc = await CollegeInfo.findOne({ student_id: req.student._id });
  const context = serializeDigest(doc);
  const { question } = parsed.data;

  let answer;
  let engine;
  let llmError;

  if (!isGeminiConfigured()) {
    answer = keywordAnswer(doc, question);
    engine = 'fallback';
  } else {
    try {
      answer = (
        await geminiGenerate({
          system: CHAT_SYSTEM,
          user: `STUDENT'S COLLEGE INFORMATION:\n"""\n${context}\n"""\n\nSTUDENT QUESTION: ${question}`,
          maxTokens: 1024,
        })
      ).trim();
      engine = 'gemini';
    } catch (err) {
      // Degrade gracefully to the keyword search instead of failing the chat.
      answer = keywordAnswer(doc, question);
      engine = 'fallback';
      llmError = String(err?.message || err);
    }
  }

  // Persist the turn (user first, then assistant) so _id order == chat order.
  let saved = [];
  try {
    saved = await ChatMessage.insertMany([
      { student_id: req.student._id, role: 'user', content: question },
      { student_id: req.student._id, role: 'assistant', content: answer, engine },
    ]);
  } catch {
    /* don't fail the response if persistence hiccups */
  }

  res.json({
    ok: true,
    engine,
    answer,
    ...(llmError ? { llm_error: llmError } : {}),
    message_id: saved[1]?._id,
  });
});

// GET /chat/history?before=<id>&limit=20 — paginate chat history for scroll-up.
// Returns a window of messages in chronological order (oldest -> newest):
//   - no `before`  => the most recent page
//   - with `before`=> the page of messages immediately OLDER than that id
// `nextCursor` is the oldest id in the page (pass it back as `before`), and
// `hasMore` tells the UI whether older messages still exist.
chatRouter.get('/history', requireAuth, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || HISTORY_PAGE, 1), 50);
  const filter = { student_id: req.student._id };

  const { before } = req.query;
  if (before) {
    if (!mongoose.isValidObjectId(String(before))) {
      return res.status(400).json({ error: 'invalid_cursor' });
    }
    filter._id = { $lt: new mongoose.Types.ObjectId(String(before)) };
  }

  // Fetch newest-first (so `before` works), grab one extra to detect hasMore.
  const rows = await ChatMessage.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse(); // back to chronological order

  res.json({
    ok: true,
    messages: page.map((m) => ({
      _id: m._id,
      role: m.role,
      content: m.content,
      engine: m.engine,
      created_at: m.created_at,
    })),
    nextCursor: page.length ? page[0]._id : null,
    hasMore,
  });
});

// DELETE /chat/history — clear the student's chat history.
chatRouter.delete('/history', requireAuth, async (req, res) => {
  await ChatMessage.deleteMany({ student_id: req.student._id });
  res.json({ ok: true });
});
