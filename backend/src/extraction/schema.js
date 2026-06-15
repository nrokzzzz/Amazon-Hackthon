import { z } from 'zod';

// Strict shape we expect back from the LLM (after parsing). We coerce/validate
// here so a malformed LLM response can't poison the DB.
export const extractedEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  type: z
    .enum([
      'exam',
      'exam_fee',
      'assignment',
      'lab',
      'project',
      'registration',
      'class',
      'workshop',
      'placement',
      'attendance',
      'notice',
      'event',
    ])
    .default('notice'),
  course: z.string().optional().default(''),
  // ISO 8601 string (with optional tz offset, e.g. +05:30) or null.
  datetime: z.string().datetime({ offset: true }).nullable().optional(),
  audience: z
    .object({
      branch: z.string().default('all'),
      // number or "all"
      year: z.union([z.number(), z.literal('all'), z.string()]).default('all'),
      section: z.string().default('all'),
    })
    .default({ branch: 'all', year: 'all', section: 'all' }),
  importance: z.enum(['critical', 'high', 'med', 'low']).default('low'),
});

// The LLM may return a single object or an array (a notice can hold many events).
export const extractionResultSchema = z.union([
  extractedEventSchema,
  z.array(extractedEventSchema),
]);

export function normalizeYear(year) {
  if (year === 'all') return 'all';
  const n = Number(year);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 'all';
}
