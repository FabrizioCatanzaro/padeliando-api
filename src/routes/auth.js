import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { getDb } from '../db.js';
import { uid } from '../uid.js';

const router = Router();
const SECRET = process.env.JWT_SECRET;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function makeToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, SECRET, { expiresIn: '30d' });
}

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

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password y name son requeridos' });

    const sql = getDb();
    const [existing] = await sql`SELECT id FROM users WHERE email = LOWER(${email})`;
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email' });

    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    const password_hash = await bcrypt.hash(password, 10);
    const username = await generateUsername(sql, name);

    const [user] = await sql`
      INSERT INTO users (id, email, password_hash, name, username)
      VALUES (${uid()}, LOWER(${email}), ${password_hash}, ${name.trim()}, ${username})
      RETURNING id, email, name, username, created_at
    `;
    res.status(201).json({ user, token: makeToken(user) });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const sql = getDb();
    const [user] = await sql`SELECT * FROM users WHERE email = LOWER(${email})`;

    if (!user || !user.password_hash) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, token: makeToken(user) });
  } catch (err) { next(err); }
});

// POST /api/auth/google
router.post('/google', async (req, res, next) => {
  try {
    const { credential } = req.body; // ID token del frontend
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
          WHERE id = ${byEmail.id} RETURNING id, email, name, username, created_at
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
    res.json({ user: safeUser, token: makeToken(user) });
  } catch (err) { next(err); }
});

// GET /api/auth/me — verificar token y devolver usuario actual
router.get('/me', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const sql = getDb();
    const [user] = await sql`SELECT id, email, name, username, created_at FROM users WHERE id = ${id}`;
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch { res.status(401).json({ error: 'Token inválido' }); }
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