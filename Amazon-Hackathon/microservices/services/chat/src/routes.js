import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { isGeminiConfigured } from './config/env.js';
import { geminiGenerate } from './llm/gemini.js';
import { ChatMessage } from './models/ChatMessage.js';
import { fetchContext, fetchProfile } from './upstream.js';

export const router = express.Router();

// The gateway verifies the JWT and forwards x-user-id. Downstream we just read it.
function userIdFrom(req) {
  return req.headers['x-user-id'] || null;
}

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
// Adapted from the monolith's serializeProfile to work off the internal-profile
// shape: { profile, branch, current_year }.
function serializeProfile({ profile = {}, branch = '', current_year = null } = {}) {
  const p = profile || {};
  const lines = [];
  if (branch) lines.push(`Branch: ${branch}, Year ${current_year ?? '?'}`);
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

// The structured buckets every college email is sorted into (mirrors the
// categorizer). Used only to order the keyword fallback's generic scan.
const CATEGORIES = [
  'class_timetable',
  'exam_timetable',
  'assignment_deadlines',
  'fees',
  'attendance',
  'placement_prep',
  'hostel_notices',
  'transport',
  'club_events',
  'general',
];

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
// falls back to (stopword-filtered) keyword overlap.
//
// Adapted from the monolith: operates over the FLAT `items` array returned by
// the categorizer's /internal/context (already live-filtered) instead of a
// Mongo CollegeInfo doc. Items carry a `category` field, so we group on demand.
function keywordAnswer(items, question) {
  const q = question.toLowerCase();
  const all = Array.isArray(items) ? items : [];
  const inCat = (cat) => all.filter((it) => it.category === cat);

  // 1) Category intent — answer from the asked-about bucket(s).
  const intents = [...new Set(INTENT_RULES.filter((r) => r.re.test(q)).map((r) => r.cat))];
  if (intents.length) {
    const out = [];
    for (const cat of intents) out.push(...inCat(cat).slice(0, 5).map((it) => fmtItem(cat, it)));
    if (out.length) return out.join('\n');
    const names = [...new Set(intents.map((c) => CATEGORY_LABEL[c] || c))].join(' / ');
    return `No ${names} updates right now. I'll show them here as soon as a college email about it arrives.`;
  }

  // 2) Generic keyword overlap (stopwords removed).
  const words = q.split(/\W+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const hits = [];
  for (const cat of CATEGORIES) {
    for (const it of inCat(cat)) {
      const hay = `${it.title} ${it.summary}`.toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      if (score > 0) hits.push({ score, cat, it });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  if (!hits.length) return "I don't have that information yet. It'll appear here once a college email about it arrives.";
  return hits.slice(0, 5).map(({ cat, it }) => fmtItem(cat, it)).join('\n');
}

// POST /chat/ask — answer a student question grounded in their college digest.
// Context + profile are pulled from the categorizer/auth services. Persists both
// the question and the answer so history survives reloads.
router.post('/ask', async (req, res) => {
  const userId = userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });
  if (!mongoose.isValidObjectId(String(userId))) return res.status(401).json({ error: 'unauthenticated' });

  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const now = new Date();
  const nowText = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });

  const [{ digestText, prioritiesText, items }, profileResp] = await Promise.all([
    fetchContext(userId),
    fetchProfile(userId),
  ]);
  const profileText = serializeProfile(profileResp);
  const { question } = parsed.data;

  let answer;
  let engine;
  let llmError;

  if (!isGeminiConfigured()) {
    answer = keywordAnswer(items, question);
    engine = 'fallback';
  } else {
    try {
      answer = (
        await geminiGenerate({
          system: CHAT_SYSTEM,
          user: `CURRENT DATE & TIME (IST): ${nowText}\n\nSTUDENT PROFILE & PREFERENCES:\n"""\n${profileText}\n"""\n\nPRIORITIZED TASKS (most important first, only live/upcoming):\n"""\n${prioritiesText}\n"""\n\nSTUDENT'S COLLEGE INFORMATION:\n"""\n${digestText}\n"""\n\nSTUDENT QUESTION: ${question}`,
          maxTokens: 1536,
        })
      ).trim();
      engine = 'gemini';
    } catch (err) {
      // Degrade gracefully to the keyword search instead of failing the chat.
      answer = keywordAnswer(items, question);
      engine = 'fallback';
      llmError = String(err?.message || err);
    }
  }

  // Persist the turn (user first, then assistant) so _id order == chat order.
  let saved = [];
  try {
    saved = await ChatMessage.insertMany([
      { student_id: userId, role: 'user', content: question },
      { student_id: userId, role: 'assistant', content: answer, engine },
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
router.get('/history', async (req, res) => {
  const userId = userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });
  if (!mongoose.isValidObjectId(String(userId))) return res.status(401).json({ error: 'unauthenticated' });

  const limit = Math.min(Math.max(Number(req.query.limit) || HISTORY_PAGE, 1), 50);
  const filter = { student_id: new mongoose.Types.ObjectId(String(userId)) };

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
router.delete('/history', async (req, res) => {
  const userId = userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });
  if (!mongoose.isValidObjectId(String(userId))) return res.status(401).json({ error: 'unauthenticated' });

  await ChatMessage.deleteMany({ student_id: new mongoose.Types.ObjectId(String(userId)) });
  res.json({ ok: true });
});
