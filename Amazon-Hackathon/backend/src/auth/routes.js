import express from 'express';
import { z } from 'zod';
import { Student } from '../models/Student.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken, requireAuth } from './jwt.js';

export const authRouter = express.Router();

const registerSchema = z.object({
  name: z.string().min(1),
  // Normalize email (trim + lowercase) so login always matches what we stored,
  // regardless of how the user typed it.
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(6),
  // TIER 1 essentials
  branch: z.string().min(1),
  roll_no: z.string().min(1),
  passout_year: z.coerce.number().int().min(2020).max(2035),
  section: z.string().optional(),
  // TIER 2 enrichment (optional / skippable)
  profile: z
    .object({
      preferable_study_time: z.string().optional(),
      focus_subjects: z.array(z.string()).optional(),
      strengths: z.array(z.string()).optional(),
      goals: z.array(z.string()).optional(),
      areas_of_interest: z.array(z.string()).optional(),
      hobbies: z.array(z.string()).optional(),
      prefs: z.record(z.any()).optional(),
    })
    .partial()
    .optional(),
});

// POST /auth/register — create student + profile (Feature 3)
authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const exists = await Student.findOne({ email: data.email });
  if (exists) return res.status(409).json({ error: 'email_taken' });

  const student = await Student.create({
    name: data.name,
    email: data.email,
    passwordHash: hashPassword(data.password),
    branch: data.branch,
    roll_no: data.roll_no,
    passout_year: data.passout_year,
    section: data.section,
    profile: data.profile || {},
  });

  const token = signToken(student);
  res.status(201).json({ token, student: student.toJSON() });
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string(),
});

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const student = await Student.findOne({ email: parsed.data.email });
  if (!student || !verifyPassword(parsed.data.password, student.passwordHash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = signToken(student);
  res.json({ token, student: student.toJSON() });
});

// GET /auth/me
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ student: req.student.toJSON() });
});
