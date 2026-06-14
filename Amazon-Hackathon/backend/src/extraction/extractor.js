import { isBedrockConfigured } from '../config/env.js';
import { invokeBedrock } from './bedrock.js';
import { fallbackExtract } from './fallback.js';
import { extractionResultSchema, normalizeYear } from './schema.js';

// Strip accidental markdown fences and grab the first JSON value in the string.
function safeParseJson(text) {
  let t = text.trim();
  // Remove ```json ... ``` fences if the model added them despite instructions.
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If there's leading prose, slice from the first [ or {.
  const start = Math.min(
    ...['[', '{'].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c)))
  );
  if (start !== Infinity) t = t.slice(start);
  return JSON.parse(t);
}

function coerce(events) {
  return events.map((e) => ({
    ...e,
    datetime: e.datetime ? new Date(e.datetime) : null,
    audience: {
      branch: e.audience?.branch || 'all',
      year: normalizeYear(e.audience?.year),
      section: e.audience?.section || 'all',
    },
  }));
}

// Main entry: raw text -> array of validated, coerced event objects.
// Uses Bedrock when configured; otherwise the rule-based fallback. Either way
// the output is validated with zod so bad data never reaches the DB.
export async function extractEvents(rawText, now = new Date()) {
  let parsed;
  let engine;

  if (isBedrockConfigured()) {
    engine = 'bedrock';
    const text = await invokeBedrock(rawText, now);
    const raw = safeParseJson(text);
    parsed = extractionResultSchema.parse(raw);
  } else {
    engine = 'fallback';
    parsed = extractionResultSchema.parse(fallbackExtract(rawText, now));
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed];
  return { engine, events: coerce(arr) };
}
