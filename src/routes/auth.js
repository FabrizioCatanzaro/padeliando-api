import { Router }        from 'express';
import bcrypt            from 'bcrypt';
import jwt               from 'jsonwebtoken';
import crypto            from 'crypto';
import { OAuth2Client }  from 'google-auth-library';
import rateLimit         from 'express-rate-limit';
import { Resend } from 'resend';
import { getDb }         from '../db.js';
import { uid }           from '../uid.js';
import { requireAuth } from '../middleware/auth.js';

const router       = Router();
const SECRET       = process.env.JWT_SECRET;
const IS_PROD      = process.env.NODE_ENV === 'production';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Mailer ────────────────────────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Rate limiting — máx 10 intentos por IP cada 15 min ────────────────────────
const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Demasiados intentos. Esperá 15 minutos.' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function cookieOpts(maxAge) {
  return {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'strict',
    maxAge,
  };
}

function setAuthCookies(res, user) {
  // Access token: corta duración (15 min)
  const accessToken = jwt.sign(
    { id: user.id, email: user.email, name: user.name, username: user.username },
    SECRET,
    { expiresIn: '15m' }
  );
  // Refresh token: larga duración (30 días), opaco
  const refreshToken = crypto.randomBytes(40).toString('hex');

  res.cookie('access_token',  accessToken,  cookieOpts(15 * 60 * 1000));
  res.cookie('refresh_token', refreshToken, cookieOpts(30 * 24 * 60 * 60 * 1000));

  return refreshToken;
}

async function saveRefreshToken(sql, userId, rawToken) {
  const hash      = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await sql`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (${uid()}, ${userId}, ${hash}, ${expiresAt})
  `;
}

async function generateUsername(sql, name, excludeId = null) {
  const base = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  let candidate = base || 'user';
  let i = 2;
  while (true) {
    const [ex] = excludeId
      ? await sql.query('SELECT id FROM users WHERE username = $1 AND id != $2', [candidate, excludeId])
      : await sql`SELECT id FROM users WHERE username = ${candidate}`;
    if (!ex) return candidate;
    candidate = `${base}_${i++}`;
  }
}

function validatePassword(password) {
  if (!password || password.length < 8)  return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(password))           return 'La contraseña debe tener al menos una mayúscula';
  if (!/[a-z]/.test(password))           return 'La contraseña debe tener al menos una minúscula';
  if (!/[0-9]/.test(password))           return 'La contraseña debe tener al menos un número';
  return null;
}

function validateUser(user) {
  if (!user || user.length < 6)  return 'El nombre debe tener al menos 6 caracteres';
  if (user.length >= 20) return 'El nombre tiene un límite de 20 caracteres';
  return null;
}

// Bloquea si hay 5+ intentos fallidos del mismo email en los últimos 15 min
async function checkLoginAttempts(sql, email) {
  const since = new Date(Date.now() - 15 * 60 * 1000);
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM login_attempts
    WHERE identifier = LOWER(${email}) AND created_at > ${since}
  `;
  return count >= 5;
}

async function recordFailedAttempt(sql, email) {
  await sql`INSERT INTO login_attempts (id, identifier) VALUES (${uid()}, LOWER(${email}))`;
}

async function clearLoginAttempts(sql, email) {
  await sql`DELETE FROM login_attempts WHERE identifier = LOWER(${email})`;
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name)
      return res.status(400).json({ error: 'Email, Contraseña y Nombre son requeridos' });

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });
    
    const sql = getDb();
    const [existing] = await sql`SELECT id FROM users WHERE email = LOWER(${email})`;
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email. Intente recuperar la contraseña si no la recuerda.' });
    
    const password_hash = await bcrypt.hash(password, 10);
    const userError = validateUser(name)
    if (userError) return res.status(400).json({ error: userError });

    const username      = await generateUsername(sql, name);

    const [user] = await sql`
      INSERT INTO users (id, email, password_hash, name, username)
      VALUES (${uid()}, LOWER(${email}), ${password_hash}, ${name.trim()}, ${username})
      RETURNING id, email, name, username, created_at
    `;

    const refreshToken = setAuthCookies(res, user);
    await saveRefreshToken(sql, user.id, refreshToken);

    res.status(201).json({ user });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const sql = getDb();

    const blocked = await checkLoginAttempts(sql, email);
    if (blocked)
      return res.status(429).json({ error: 'Cuenta bloqueada temporalmente. Esperá 15 minutos.' });

    const [user] = await sql`SELECT * FROM users WHERE email = LOWER(${email})`;

    if (!user || !user.password_hash) {
      await recordFailedAttempt(sql, email);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordFailedAttempt(sql, email);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }

    await clearLoginAttempts(sql, email);

    const { password_hash, ...safeUser } = user;
    const refreshToken = setAuthCookies(res, safeUser);
    await saveRefreshToken(sql, user.id, refreshToken);

    res.json({ user: safeUser });
  } catch (err) { next(err); }
});

// ── POST /api/auth/google ─────────────────────────────────────────────────────
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { sub: google_id, email, name } = ticket.getPayload();

    const sql = getDb();
    let [user] = await sql`SELECT * FROM users WHERE google_id = ${google_id}`;

    if (!user) {
      const [byEmail] = await sql`SELECT * FROM users WHERE email = LOWER(${email})`;
      if (byEmail) {
        [user] = await sql`
          UPDATE users SET google_id = ${google_id}
          WHERE id = ${byEmail.id}
          RETURNING id, email, name, username, created_at
        `;
      } else {
        const username = await generateUsername(sql, name);
        [user] = await sql`
          INSERT INTO users (id, email, google_id, name, username)
          VALUES (${uid()}, LOWER(${email}), ${google_id}, ${name}, ${username})
          RETURNING id, email, name, username, created_at
        `;
      }
    }

    const { password_hash, ...safeUser } = user;
    const refreshToken = setAuthCookies(res, safeUser);
    await saveRefreshToken(sql, user.id, refreshToken);

    res.json({ user: safeUser });
  } catch (err) { next(err); }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) return res.status(401).json({ error: 'No hay refresh token' });

    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const sql  = getDb();

    const [stored] = await sql`
      SELECT * FROM refresh_tokens
      WHERE token_hash = ${hash} AND expires_at > NOW()
    `;
    if (!stored) return res.status(401).json({ error: 'Refresh token inválido o expirado' });

    // Rotar — borrar el viejo, crear uno nuevo
    await sql`DELETE FROM refresh_tokens WHERE id = ${stored.id}`;

    const [user] = await sql`
      SELECT id, email, name, username FROM users WHERE id = ${stored.user_id}
    `;
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

    const newRefreshToken = setAuthCookies(res, user);
    await saveRefreshToken(sql, user.id, newRefreshToken);

    res.json({ user });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (rawToken) {
      const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sql  = getDb();
      await sql`DELETE FROM refresh_tokens WHERE token_hash = ${hash}`;
    }
    res.clearCookie('access_token',  cookieOpts(0));
    res.clearCookie('refresh_token', cookieOpts(0));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  try {
    const token = req.cookies?.access_token;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const { id } = jwt.verify(token, SECRET);
    const sql = getDb();
    const [user] = await sql`
      SELECT id, email, name, username, created_at FROM users WHERE id = ${id}
    `;
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch { res.status(401).json({ error: 'Token inválido' }); }
});

// ── GET /api/auth/search?q= ───────────────────────────────────────────────────
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

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    const sql = getDb();
    const [user] = await sql`SELECT id, name FROM users WHERE email = LOWER(${email})`;

    // Siempre responder igual para no revelar si el email existe
    if (!user) return res.json({ ok: true });

    // Invalidar tokens anteriores
    await sql`DELETE FROM password_resets WHERE user_id = ${user.id}`;

    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await sql`
      INSERT INTO password_resets (id, user_id, token_hash, expires_at)
      VALUES (${uid()}, ${user.id}, ${tokenHash}, ${expiresAt})
    `;

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`;

    await resend.emails.send({
      from:    'Padeleando <onboarding@resend.dev>',
      to:      email,
      subject: 'Recuperá tu contraseña',
      html: `
        <p>Hola ${user.name},</p>
        <p>Hacé click en el siguiente enlace para resetear tu contraseña.
          El enlace expira en 1 hora.</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>Si no solicitaste esto, ignorá este mail.</p>
      `,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ error: 'token y password son requeridos' });

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sql       = getDb();

    const [reset] = await sql`
      SELECT * FROM password_resets
      WHERE token_hash = ${tokenHash} AND used = false AND expires_at > NOW()
    `;
    if (!reset) return res.status(400).json({ error: 'El enlace es inválido o ya expiró' });

    const password_hash = await bcrypt.hash(password, 10);

    await sql`UPDATE users SET password_hash = ${password_hash} WHERE id = ${reset.user_id}`;
    await sql`UPDATE password_resets SET used = true WHERE id = ${reset.id}`;
    // Invalidar todas las sesiones activas del usuario
    await sql`DELETE FROM refresh_tokens WHERE user_id = ${reset.user_id}`;

    res.clearCookie('access_token',  cookieOpts(0));
    res.clearCookie('refresh_token', cookieOpts(0));

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PATCH /api/auth/me ────────────────────────────────────────────
router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { name, current_password, new_password } = req.body;
    const sql = getDb();

    const [user] = await sql`SELECT * FROM users WHERE id = ${req.user.id}`;
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updates = {};

    // Cambio de nombre
    if (name !== undefined) {
      const trimmed = name.trim();
      const userError = validateUser(name)
      if (userError) return res.status(400).json({ error: userError });
      if (!trimmed) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      updates.name = trimmed;
      updates.username = await generateUsername(sql, trimmed, req.user.id);
    }

    // Cambio de contraseña
    if (new_password !== undefined) {
      if (!current_password)
        return res.status(400).json({ error: 'Ingresá tu contraseña actual' });

      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid)
        return res.status(400).json({ error: 'La contraseña actual es incorrecta' });

      const pwError = validatePassword(new_password);
      if (pwError) return res.status(400).json({ error: pwError });

      updates.password_hash = await bcrypt.hash(new_password, 10);
    }

    if (Object.keys(updates).length === 0)
      return res.json({ id: user.id, name: user.name, username: user.username });

    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const [updated] = await sql.query(
      `UPDATE users SET ${setClauses} WHERE id = $${keys.length + 1} RETURNING id, name, username`,
      [...values, req.user.id]
    );

    res.json(updated);
  } catch (err) { next(err); }
});

export default router;