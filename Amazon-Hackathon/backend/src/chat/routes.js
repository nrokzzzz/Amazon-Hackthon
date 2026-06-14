import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../auth/jwt.js';
import { isGeminiConfigured } from '../config/env.js';
import { geminiGenerate } from '../llm/gemini.js';
import { CollegeInfo } from '../models/CollegeInfo.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { serializeDigest } from '../digest/serialize.js';
import { prioritizeDigest, prioritySummaryText, isLive } from '../digest/priority.js';
import { CATEGORIES } from '../digest/categories.js';

export const chatRouter = express.Router();

const askSchema = z.object({ question: z.string().min(1) });

const HISTORY_PAGE = 20;

const CHAT_SYSTEM = `You are CampusFlow Assistant, a helpful chatbot for a college student.
You answer using the student's stored COLLEGE INFORMATION and personalize advice using their PROFILE & PREFERENCES (both provided below).

Rules:
- Be concise and direct. For factual questions (dates, venues, fees, deadlines) use ONLY the college information; never invent dates or facts. Mention the date/time (IST) and any consequence (deadline, fee, debarment).
- If a fact isn't in the college information, say you don't have it yet and suggest what email/notice would carry it.
- The CURRENT DATE & TIME (IST) is given below. Interpret "today / tomorrow / this week / next" relative to it, and compute "in N days" from it.
- Everything listed is LIVE and still upcoming — tasks whose time has already passed are automatically removed. So NEVER describe a listed item as already over, and never claim a past event is upcoming.

When the student asks for a STUDY PLAN, TIMETABLE, "when should I study", or exam preparation:
- Build a personalized schedule around their PREFERRED STUDY TIMES.
- Anchor it to the real upcoming EXAM TIMETABLE and ASSIGNMENT DEADLINES from the college information (use the actual dates).
- Give MORE time / earlier start to their FOCUS SUBJECTS (subjects they find hard, e.g. they may fear Mathematics or Chemistry); give less to their STRENGTHS.
- Tailor to their GOALS: if a goal is placement, emphasize coding/development, DSA, aptitude and the relevant technologies/areas of interest; if GATE/exams, emphasize core subjects.
- Present it as a clear, day-by-day or slot-by-slot plan. If they haven't set preferences, give sensible defaults and suggest they fill in their profile.

PRIORITIZATION (this app's core): a PRIORITIZED TASKS list is provided, already ordered most-important-first. When asked "what's important", "what should I do", "what's next", or to plan, follow that order. Rules to honor:
- Surface attendance below 75% (tell them to attend classes to recover) and transport updates as URGENT.
- Deadlines drive urgency: assignment/fee due tomorrow → do it today; placement drive → prepare the day before; first exam → start 2 days before.
- Respect goals on a clash: if two things overlap and the student's goal is NOT placement, recommend the club/event/activity they value; if their goal IS placement, recommend the placement. The list's notes already reflect this.
- Mention the calendar reminders are set automatically (assignments & placements 1 day before, exams 2 days before).`;

// Flatten the student's preferences into a compact block for the LLM context,
// so it can personalize study plans (preferred times, goals, focus subjects…).
function serializeProfile(student) {
  const p = student?.profile?.toObject?.() ?? student?.profile ?? {};
  const lines = [];
  if (student?.branch) lines.push(`Branch: ${student.branch}, Year ${student.currentYear?.() ?? '?'}`);
  const list = (label, arr) => {
    if (Array.isArray(arr) && arr.length) lines.push(`${label}: ${arr.join(', ')}`);
  };
  list('Preferred study times', p.study_times);
  list('Goals', p.goals);
  list('Focus subjects (finds hard / wants to improve)', p.focus_subjects);
  list('Strengths', p.strengths);
  list('Areas of interest', p.areas_of_interest);
  list('Hobbies', p.hobbies);
  return lines.length ? lines.join('\n') : '(student has not set any preferences yet)';
}

// Map a question to the category the student is asking about (used by the
// offline / quota-exhausted fallback so it answers from the RIGHT bucket).
const INTENT_RULES = [
  { cat: 'placement_prep', re: /placement|intern|recruit|company|drive|hiring|pre-?placement|\bppt\b|ctc|package|off-?campus|on-?campus|\bjob\b/ },
  { cat: 'exam_timetable', re: /exam|hall ?ticket|mid-?sem|end-?sem|semester|\btest\b|viva|practical/ },
  { cat: 'fees', re: /\bfee\b|fees|payment|fine|tuition|supplementary fee|\bpay\b/ },
  { cat: 'attendance', re: /attendance|present|absent|shortage|debar|condonation|\d+\s*%/ },
  { cat: 'assignment_deadlines', re: /assignment|submission|lab record|\bproject\b|deadline|\bdue\b/ },
  { cat: 'transport', re: /\bbus\b|transport|\broute\b|shuttle|pick-?up|\bdrop\b/ },
  { cat: 'hostel_notices', re: /hostel|\bmess\b|warden|room allot/ },
  { cat: 'class_timetable', re: /class|time ?table|lecture|period|reschedul/ },
  { cat: 'club_events', re: /\bclub\b|\bfest\b|\bevent\b|hackathon|workshop|cultural|sports|competition/ },
  { cat: 'general', re: /holiday|circular|announcement|\bnotice\b/ },
];

const CATEGORY_LABEL = {
  placement_prep: 'placement', exam_timetable: 'exam', fees: 'fee', attendance: 'attendance',
  assignment_deadlines: 'assignment', transport: 'transport', hostel_notices: 'hostel',
  class_timetable: 'class timetable', club_events: 'club/event', general: 'general notice',
};

// Filler words that should NOT drive keyword matching.
const STOPWORDS = new Set([
  'any', 'the', 'for', 'and', 'about', 'regarding', 'update', 'updates', 'give', 'tell', 'what',
  'whats', 'are', 'have', 'there', 'this', 'week', 'today', 'please', 'show', 'latest', 'new',
  'some', 'campus', 'college', 'info', 'information', 'related', 'anything', 'something',
]);

function fmtItem(cat, it) {
  const when = it.datetime
    ? ` (${new Date(it.datetime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })})`
    : '';
  return `• [${cat}] ${it.title}${when}: ${it.summary || ''}`.trim();
}

// Rule-based fallback (used when Gemini is unconfigured or quota-exhausted).
// First tries to answer from the category the question is ABOUT; only then
// falls back to (stopword-filtered) keyword overlap. Live items only.
function keywordAnswer(doc, question, now = new Date()) {
  const q = question.toLowerCase();
  const live = (cat) => (doc?.[cat] || []).filter((it) => isLive(it, now));

  // 1) Category intent — answer from the asked-about bucket(s).
  const intents = [...new Set(INTENT_RULES.filter((r) => r.re.test(q)).map((r) => r.cat))];
  if (intents.length) {
    const out = [];
    for (const cat of intents) out.push(...live(cat).slice(0, 5).map((it) => fmtItem(cat, it)));
    if (out.length) return out.join('\n');
    const names = [...new Set(intents.map((c) => CATEGORY_LABEL[c] || c))].join(' / ');
    return `No ${names} updates right now. I'll show them here as soon as a college email about it arrives.`;
  }

  // 2) Generic keyword overlap (stopwords removed), live items only.
  const words = q.split(/\W+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const hits = [];
  for (const cat of CATEGORIES) {
    for (const it of live(cat)) {
      const hay = `${it.title} ${it.summary}`.toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      if (score > 0) hits.push({ score, cat, it });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) return "I don't have that information yet. It'll appear here once a college email about it arrives.";
  return hits.slice(0, 5).map(({ cat, it }) => fmtItem(cat, it)).join('\n');
}

// POST /chat/ask — answer a student question grounded in their CollegeInfo doc.
// Persists both the question and the answer so history survives reloads.
chatRouter.post('/ask', requireAuth, async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const now = new Date();
  const nowText = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
  const doc = await CollegeInfo.findOne({ student_id: req.student._id });
  const context = serializeDigest(doc, now);
  const profileText = serializeProfile(req.student);
  const profileObj = req.student.profile?.toObject?.() ?? req.student.profile ?? {};
  const priorities = prioritySummaryText(prioritizeDigest(doc, profileObj, now));
  const { question } = parsed.data;

  let answer;
  let engine;
  let llmError;

  if (!isGeminiConfigured()) {
    answer = keywordAnswer(doc, question, now);
    engine = 'fallback';
  } else {
    try {
      answer = (
        await geminiGenerate({
          system: CHAT_SYSTEM,
          user: `CURRENT DATE & TIME (IST): ${nowText}\n\nSTUDENT PROFILE & PREFERENCES:\n"""\n${profileText}\n"""\n\nPRIORITIZED TASKS (most important first, only live/upcoming):\n"""\n${priorities}\n"""\n\nSTUDENT'S COLLEGE INFORMATION:\n"""\n${context}\n"""\n\nSTUDENT QUESTION: ${question}`,
          maxTokens: 1536,
        })
      ).trim();
      engine = 'gemini';
    } catch (err) {
      // Degrade gracefully to the keyword search instead of failing the chat.
      answer = keywordAnswer(doc, question, now);
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
