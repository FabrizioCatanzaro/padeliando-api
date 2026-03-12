import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { uid } from '../uid.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookies.js';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  generateCsrfToken,
  hashToken,
  generateResetToken,
  verifyAccessToken
} from '../utils/tokens.js';
import { sendPasswordResetEmail } from '../services/email.js';

const router = Router();
const SECRET = process.env.JWT_SECRET;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generar username único a partir del nombre
async function generateUsername(sql, name) {
  const base = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  let candidate = base;
  let i = 2;
  while (true) {
    const [existing] = await sql`SELECT id FROM users WHERE username = ${candidate}`;
    if (!existing) return candidate;
    candidate = `${base}_${i++}`;
  }
}

function validatePassword(password) {
  if (!password || password.length < 8)
    return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(password))
    return 'La contraseña debe tener al menos una mayúscula';
  if (!/[a-z]/.test(password))
    return 'La contraseña debe tener al menos una minúscula';
  if (!/[0-9]/.test(password))
    return 'La contraseña debe tener al menos un número';
  return null;
}

/**
 * Genera tokens y los guarda como cookies HTTP-only.
 * Retorna el usuario y CSRF token para el cliente.
 */
async function createAuthSession(res, user, sql) {
  // Generar tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken();
  const csrfToken = generateCsrfToken(user.id);
  
  // Guardar refresh token hasheado en DB (expira en 30 días)
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  
  await sql`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (${uuidv4()}, ${user.id}, ${tokenHash}, ${expiresAt})
  `;
  
  // Setear cookies HTTP-only
  setAuthCookies(res, { accessToken, refreshToken, csrfToken });
  
  // Limpiar datos sensibles del usuario
  const { password_hash, ...safeUser } = user;
  
  return { user: safeUser, csrfToken };
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password y name son requeridos' });
    }

    const sql = getDb();
    const [existing] = await sql`SELECT id FROM users WHERE email = LOWER(${email})`;
    if (existing) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
    }

    const pwError = validatePassword(password);
    if (pwError) {
      return res.status(400).json({ error: pwError });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const username = await generateUsername(sql, name);

    const [user] = await sql`
      INSERT INTO users (id, email, password_hash, name, username)
      VALUES (${uid()}, LOWER(${email}), ${password_hash}, ${name.trim()}, ${username})
      RETURNING id, email, name, username, created_at
    `;
    
    const authData = await createAuthSession(res, user, sql);
    res.status(201).json(authData);
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email y password son requeridos' });
    }
    
    const sql = getDb();
    const [user] = await sql`SELECT * FROM users WHERE email = LOWER(${email})`;

    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const authData = await createAuthSession(res, user, sql);
    res.json(authData);
  } catch (err) { next(err); }
});

// POST /api/auth/google
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'credential es requerido' });
    }
    
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: google_id, email, name } = ticket.getPayload();

    const sql = getDb();
    let [user] = await sql`SELECT * FROM users WHERE google_id = ${google_id}`;

    if (!user) {
      // Primera vez con Google — crear cuenta
      const [byEmail] = await sql`SELECT * FROM users WHERE email = LOWER(${email})`;
      if (byEmail) {
        // Ya existe cuenta con ese email — vincular Google
        [user] = await sql`
          UPDATE users SET google_id = ${google_id}
          WHERE id = ${byEmail.id} 
          RETURNING *
        `;
      } else {
        const username = await generateUsername(sql, name);
        [user] = await sql`
          INSERT INTO users (id, email, google_id, name, username)
          VALUES (${uid()}, LOWER(${email}), ${google_id}, ${name}, ${username})
          RETURNING *
        `;
      }
    }

    const authData = await createAuthSession(res, user, sql);
    res.json(authData);
  } catch (err) { next(err); }
});

// POST /api/auth/refresh — renovar access token
router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'No hay refresh token' });
    }
    
    const sql = getDb();
    const tokenHash = hashToken(refreshToken);
    
    // Buscar refresh token válido
    const [storedToken] = await sql`
      SELECT rt.*, u.id as user_id, u.email, u.name, u.username
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = ${tokenHash}
        AND rt.expires_at > NOW()
        AND rt.revoked_at IS NULL
    `;
    
    if (!storedToken) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Refresh token inválido o expirado' });
    }
    
    // Revocar el token actual (rotación de tokens)
    await sql`
      UPDATE refresh_tokens 
      SET revoked_at = NOW() 
      WHERE id = ${storedToken.id}
    `;
    
    // Crear nueva sesión
    const user = { 
      id: storedToken.user_id, 
      email: storedToken.email, 
      name: storedToken.name,
      username: storedToken.username
    };
    
    const authData = await createAuthSession(res, user, sql);
    res.json(authData);
  } catch (err) { next(err); }
});

// POST /api/auth/logout — cerrar sesión
router.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refresh_token;
    
    if (refreshToken) {
      const sql = getDb();
      const tokenHash = hashToken(refreshToken);
      
      // Revocar refresh token
      await sql`
        UPDATE refresh_tokens 
        SET revoked_at = NOW() 
        WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      `;
    }
    
    clearAuthCookies(res);
    res.json({ message: 'Sesión cerrada correctamente' });
  } catch (err) { next(err); }
});

// POST /api/auth/forgot-password — solicitar recuperación
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email es requerido' });
    }
    
    const sql = getDb();
    const [user] = await sql`SELECT id, email FROM users WHERE email = LOWER(${email})`;
    
    // Siempre responder igual para no revelar si el email existe
    if (!user) {
      return res.json({ message: 'Si el email existe, recibirás un enlace de recuperación' });
    }
    
    // Invalidar tokens anteriores
    await sql`
      UPDATE password_reset_tokens 
      SET used_at = NOW() 
      WHERE user_id = ${user.id} AND used_at IS NULL
    `;
    
    // Generar nuevo token (expira en 1 hora)
    const resetToken = generateResetToken();
    const tokenHash = hashToken(resetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    
    await sql`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
      VALUES (${uuidv4()}, ${user.id}, ${tokenHash}, ${expiresAt})
    `;
    
    // Enviar email
    try {
      await sendPasswordResetEmail(user.email, resetToken);
    } catch (emailErr) {
      console.error('Error enviando email:', emailErr);
      // No revelar el error al usuario
    }
    
    res.json({ message: 'Si el email existe, recibirás un enlace de recuperación' });
  } catch (err) { next(err); }
});

// POST /api/auth/reset-password — cambiar contraseña
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'token y newPassword son requeridos' });
    }
    
    const pwError = validatePassword(newPassword);
    if (pwError) {
      return res.status(400).json({ error: pwError });
    }
    
    const sql = getDb();
    const tokenHash = hashToken(token);
    
    // Buscar token válido
    const [resetToken] = await sql`
      SELECT * FROM password_reset_tokens
      WHERE token_hash = ${tokenHash}
        AND expires_at > NOW()
        AND used_at IS NULL
    `;
    
    if (!resetToken) {
      return res.status(400).json({ error: 'Token inválido o expirado' });
    }
    
    // Actualizar contraseña
    const password_hash = await bcrypt.hash(newPassword, 10);
    
    await sql`UPDATE users SET password_hash = ${password_hash} WHERE id = ${resetToken.user_id}`;
    
    // Marcar token como usado
    await sql`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ${resetToken.id}`;
    
    // Revocar todos los refresh tokens del usuario (forzar re-login)
    await sql`
      UPDATE refresh_tokens 
      SET revoked_at = NOW() 
      WHERE user_id = ${resetToken.user_id} AND revoked_at IS NULL
    `;
    
    res.json({ message: 'Contraseña actualizada correctamente. Por favor inicia sesión.' });
  } catch (err) { next(err); }
});

// GET /api/auth/me — verificar token y devolver usuario actual
router.get('/me', async (req, res, next) => {
  try {
    // Intentar obtener token de cookie o header
    let token = req.cookies?.access_token;
    if (!token) {
      token = req.headers.authorization?.split(' ')[1];
    }
    
    if (!token) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    
    const { id } = verifyAccessToken(token);
    const sql = getDb();
    const [user] = await sql`SELECT id, email, name, username, created_at FROM users WHERE id = ${id}`;
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json(user);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
    }
    res.status(401).json({ error: 'Token inválido' });
  }
});

// GET /api/auth/search?q=username — buscar perfiles
router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const sql = getDb();
    const users = await sql`
      SELECT id, name, username, created_at FROM users
      WHERE username ILIKE ${'%' + q + '%'} OR name ILIKE ${'%' + q + '%'}
      LIMIT 10
    `;
    res.json(users);
  } catch (err) { next(err); }
});

export default router;
