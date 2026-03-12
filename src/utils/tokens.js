import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.JWT_SECRET;

export function generateAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    SECRET,
    { expiresIn: '15m' }
  );
}

export function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function generateCsrfToken(userId) {
  const timestamp = Date.now().toString();
  const data = `${userId}:${timestamp}`;
  const signature = crypto.createHmac('sha256', CSRF_SECRET).update(data).digest('hex');
  return `${timestamp}.${signature}`;
}

export function verifyCsrfToken(token, userId) {
  if (!token || !userId) return false;
  
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  
  const [timestamp, signature] = parts;
  const data = `${userId}:${timestamp}`;
  const expectedSig = crypto.createHmac('sha256', CSRF_SECRET).update(data).digest('hex');
  
  // Verificar firma usando comparación de tiempo constante
  if (signature.length !== expectedSig.length) return false;
  
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSig, 'hex')
  );
  
  // Verificar que no haya expirado (15 min)
  const notExpired = Date.now() - parseInt(timestamp, 10) < 15 * 60 * 1000;
  
  return isValid && notExpired;
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyAccessToken(token) {
  return jwt.verify(token, SECRET);
}
