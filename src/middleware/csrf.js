import { verifyCsrfToken } from '../utils/tokens.js';

/**
 * Middleware para validar CSRF token en requests que modifican datos.
 * Solo aplica si el usuario está autenticado via cookies.
 */
export function requireCsrf(req, res, next) {
  // Solo validar en métodos que modifican datos
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  // Si hay header Authorization, es una API key/mobile - no requerir CSRF
  if (req.headers.authorization) {
    return next();
  }
  
  // Si no hay usuario autenticado, no hay nada que proteger con CSRF
  if (!req.user) {
    return next();
  }
  
  const csrfToken = req.headers['x-csrf-token'];
  
  if (!csrfToken) {
    return res.status(403).json({ error: 'CSRF token requerido' });
  }
  
  if (!verifyCsrfToken(csrfToken, req.user.id)) {
    return res.status(403).json({ error: 'CSRF token inválido o expirado' });
  }
  
  next();
}
