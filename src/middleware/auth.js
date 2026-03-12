import jwt from 'jsonwebtoken';
import { verifyCsrfToken } from '../utils/tokens.js';

const SECRET = process.env.JWT_SECRET;

/**
 * Obtiene el token de acceso de la request.
 * Prioridad: 1) Cookie, 2) Header Authorization
 */
function getAccessToken(req) {
  // Primero intentar cookie (web)
  if (req.cookies?.access_token) {
    return { token: req.cookies.access_token, source: 'cookie' };
  }
  
  // Fallback a header Authorization (mobile/API)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return { token: authHeader.split(' ')[1], source: 'header' };
  }
  
  return { token: null, source: null };
}

/**
 * Valida CSRF token para requests que modifican datos.
 * Solo aplica cuando la autenticación es via cookies.
 */
function validateCsrf(req, res) {
  // Solo validar CSRF en métodos que modifican datos
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return true;
  }
  
  // Si el token vino de header Authorization, no requerir CSRF
  if (req.tokenSource === 'header') {
    return true;
  }
  
  // Si viene de cookie, validar CSRF
  const csrfToken = req.headers['x-csrf-token'];
  if (!csrfToken) {
    res.status(403).json({ error: 'CSRF token requerido' });
    return false;
  }
  
  if (!verifyCsrfToken(csrfToken, req.user.id)) {
    res.status(403).json({ error: 'CSRF token inválido o expirado' });
    return false;
  }
  
  return true;
}

/**
 * Middleware obligatorio - rechaza si no hay token válido.
 * Lee token de cookie (web) o header Authorization (mobile/API).
 * Valida CSRF para requests mutantes cuando se usa cookie.
 */
export function requireAuth(req, res, next) {
  const { token, source } = getAccessToken(req);
  
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  
  try {
    req.user = jwt.verify(token, SECRET);
    req.tokenSource = source;
    
    // Validar CSRF si es necesario
    if (!validateCsrf(req, res)) {
      return; // La respuesta ya fue enviada
    }
    
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    res.status(401).json({ error: 'Token inválido' });
  }
}

/**
 * Middleware opcional - sigue aunque no haya token.
 * No valida CSRF (es para rutas de lectura públicas).
 */
export function optionalAuth(req, res, next) {
  const { token, source } = getAccessToken(req);
  
  if (token) {
    try {
      req.user = jwt.verify(token, SECRET);
      req.tokenSource = source;
    } catch {
      // Token inválido, continuar sin usuario
    }
  }
  
  next();
}
