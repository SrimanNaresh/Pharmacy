import jwt from 'jsonwebtoken';

// Falls back to a fixed dev secret so local `npm run dev` works without a .env,
// but production must set JWT_SECRET (see .env.example) — sessions won't survive
// a server restart otherwise, and the fallback is not safe to rely on for real use.
const SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
const EXPIRES_IN = '12h';

export function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
