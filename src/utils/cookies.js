const isProduction = process.env.NODE_ENV === 'production';

export const cookieOptions = {
  accessToken: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000, // 15 min
    path: '/'
  },
  refreshToken: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días
    path: '/api/auth' // Accesible en rutas de auth
  },
  csrfToken: {
    httpOnly: false, // JS necesita leerlo
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000,
    path: '/'
  }
};

export function setAuthCookies(res, { accessToken, refreshToken, csrfToken }) {
  res.cookie('access_token', accessToken, cookieOptions.accessToken);
  res.cookie('refresh_token', refreshToken, cookieOptions.refreshToken);
  res.cookie('csrf_token', csrfToken, cookieOptions.csrfToken);
}

export function clearAuthCookies(res) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/api/auth' });
  res.clearCookie('csrf_token', { path: '/' });
}
