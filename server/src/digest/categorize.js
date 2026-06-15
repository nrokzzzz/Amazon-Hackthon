import { isGeminiConfigured } from '../config/env.js';
import { geminiGenerate } from '../llm/gemini.js';
import { CATEGORIZE_SYSTEM, buildCategorizeUser } from './prompt.js';
import { categorizeResultSchema } from './schema.js';
import { fallbackCategorize } from './fallback.js';

// Strip accidental ```json fences and slice from the first JSON bracket.
function safeParseJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = Math.min(
    ...['[', '{'].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c)))
  );
  if (start !== Infinity) t = t.slice(start);
  return JSON.parse(t);
}

// raw email text (+ optional PDF files) -> validated array of categorized items.
// Uses Gemini when configured; otherwise the rule-based fallback.
export async function categorizeEmail({ text, files = [], now = new Date() }) {
  if (isGeminiConfigured()) {
    const out = await geminiGenerate({
      system: CATEGORIZE_SYSTEM,
      user: buildCategorizeUser(text, now),
      files,
      json: true,
      maxTokens: 4096,
    });
    const raw = safeParseJson(out);
    const arr = Array.isArray(raw) ? raw : [raw];
    return { engine: 'gemini', items: categorizeResultSchema.parse(arr) };
  }
  return { engine: 'fallback', items: categorizeResultSchema.parse(fallbackCategorize(text, now)) };
}
