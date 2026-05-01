import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';

const SECRET = process.env.JWT_SECRET;

export function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export function optionalAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (token) {
    try { req.user = jwt.verify(token, SECRET); } catch {}
  }
  next();
}

// Requiere requireAuth previo. Verifica rol contra la DB para evitar
// confiar en JWTs viejos que no tengan el campo role.
export async function requireAdmin(req, res, next) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'No autenticado' });
    const sql = getDb();
    const [user] = await sql`SELECT role FROM users WHERE id = ${req.user.id}`;
    if (!user || user.role !== 'admin')
      return res.status(403).json({ error: 'Acceso restringido' });
    next();
  } catch (err) { next(err); }
}
