import jwt from 'jsonwebtoken';

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