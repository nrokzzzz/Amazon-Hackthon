import express from 'express';
import { z } from 'zod';
import { Student } from './models/Student.js';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';

export const router = express.Router();

// The gateway verifies the JWT and forwards x-user-id. Downstream we just read it.
function userIdFrom(req) {
  return req.headers['x-user-id'] || null;
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
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

// POST /auth/register — create student + profile
router.post('/auth/register', async (req, res) => {
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
router.post('/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const student = await Student.findOne({ email: parsed.data.email });
  if (!student || !verifyPassword(parsed.data.password, student.passwordHash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = signToken(student);
  res.json({ token, student: student.toJSON() });
});

// GET /auth/me — identity from the gateway-forwarded header.
router.get('/auth/me', async (req, res) => {
  const userId = userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });
  const student = await Student.findById(userId);
  if (!student) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ student: student.toJSON() });
});

// ---------------------------------------------------------------------------
// PROFILE
// ---------------------------------------------------------------------------

// GET /profile — full profile incl. derived current_year
router.get('/profile', async (req, res) => {
  const userId = userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });
  const student = await Student.findById(userId);
  if (!student) return res.status(401).json({ error: 'unauthenticated' });
  res.json({ student: student.toJSON() });
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
router.put('/profile', async (req, res) => {
  const userId = userIdFrom(req);
  if (!userId) return res.status(401).json({ error: 'unauthenticated' });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const student = await Student.findById(userId);
  if (!student) return res.status(401).json({ error: 'unauthenticated' });

  const { profile, ...essentials } = parsed.data;
  Object.assign(student, essentials);
  if (profile) {
    // Merge so a partial update doesn't wipe other enrichment keys.
    student.profile = { ...(student.profile?.toObject?.() ?? student.profile), ...profile };
    student.markModified('profile');
  }
  await student.save();
  res.json({ student: student.toJSON() });
});

// ---------------------------------------------------------------------------
// INTERNAL (service-to-service; no header auth required)
// ---------------------------------------------------------------------------

// GET /internal/profile?userId=... — lets other services read a student's
// enrichment profile + a few essentials without their own DB access.
router.get('/internal/profile', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId_required' });

  const student = await Student.findById(userId);
  if (!student) return res.status(404).json({ error: 'not_found' });

  const profile = student.profile?.toObject?.() ?? student.profile ?? {};
  res.json({
    ok: true,
    profile,
    branch: student.branch,
    current_year: student.currentYear(),
    name: student.name,
  });
});
