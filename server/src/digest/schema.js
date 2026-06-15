import { z } from 'zod';
import { CATEGORIES } from './categories.js';

// Coerce the LLM's importance into our 4-level enum (handles "medium", "Medium",
// "normal", unknown -> 'med').
const importanceField = z.preprocess((v) => {
  let s = String(v ?? '').toLowerCase().trim();
  if (s === 'medium' || s === 'normal' || s === '') s = 'med';
  if (s === 'urgent' || s === 'important') s = 'high';
  return s;
}, z.enum(['critical', 'high', 'med', 'low']).catch('med'));

// Accept booleans or stringy booleans ("true"/"yes"/"1"/"required").
const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return /^(true|yes|1|required)$/i.test(v.trim());
  return false;
}, z.boolean());

// Amount may come back as a number or a formatted string ("1200", "₹1200").
const amountField = z.preprocess((v) => (v == null ? '' : String(v)), z.string()).default('');

// Validated shape of ONE item the LLM returns. Unknown categories are coerced
// to 'general' so a hallucinated label can never break storage.
export const categorizedItemSchema = z
  .object({
    category: z.string(),
    title: z.string().min(1),
    summary: z.string().optional().default(''),
    // ISO 8601 string (ideally with +05:30 offset) or null.
    datetime: z.string().nullable().optional(),
    importance: importanceField,
    action_required: boolish.optional().default(false),
    link: z.string().optional().default(''),
    amount: amountField,
    location: z.string().optional().default(''),
    // Free-form, category-specific structured fields (venue, company, route...).
    details: z.record(z.any()).optional().default({}),
  })
  .transform((it) => ({
    ...it,
    category: CATEGORIES.includes(it.category) ? it.category : 'general',
  }));

export const categorizeResultSchema = z.array(categorizedItemSchema);
