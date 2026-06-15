import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { Student } from '../models/Student.js';

export function signToken(student) {
  return jwt.sign({ sub: String(student._id) }, config.jwtSecret, { expiresIn: '30d' });
}

// Express middleware: requires a valid Bearer token; attaches req.student.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing_token' });

    const payload = jwt.verify(token, config.jwtSecret);
    const student = await Student.findById(payload.sub);
    if (!student) return res.status(401).json({ error: 'invalid_token' });

    req.student = student;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}
