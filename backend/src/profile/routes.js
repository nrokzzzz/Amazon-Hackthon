import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/jwt.js';

export const profileRouter = express.Router();

// GET /profile — full profile incl. derived current_year
profileRouter.get('/', requireAuth, (req, res) => {
  res.json({ student: req.student.toJSON() });
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  roll_no: z.string().min(1).optional(),
  passout_year: z.coerce.number().int().min(2020).max(2035).optional(),
  section: z.string().optional(),
  // Enrichment fields are merged into the flexible profile sub-document.
  profile: z.record(z.any()).optional(),
});

// PUT /profile — update essentials and/or enrichment profile
profileRouter.put('/', requireAuth, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }
  const { profile, ...essentials } = parsed.data;
  const student = req.student;

  Object.assign(student, essentials);
  if (profile) {
    // Merge so a partial update doesn't wipe other enrichment keys.
    student.profile = { ...student.profile?.toObject?.() ?? student.profile, ...profile };
    student.markModified('profile');
  }
  await student.save();
  res.json({ student: student.toJSON() });
});
