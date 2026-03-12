import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

// Middleware obligatorio — rechaza si no hay token válido
export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

// Middleware opcional — sigue aunque no haya token
export function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try { req.user = jwt.verify(token, SECRET); } catch {}
  }
  next();
}