import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';

// Sign a 30-day token. Payload carries sub + email so the gateway can forward
// identity headers downstream without a DB lookup.
export function signToken(student) {
  return jwt.sign(
    { sub: String(student._id), email: student.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
