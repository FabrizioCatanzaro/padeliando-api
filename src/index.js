import 'dotenv/config';
import express  from 'express';
import cors     from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import groupsRouter      from './routes/groups.js';
import playersRouter     from './routes/players.js';
import tournamentsRouter from './routes/tournaments.js';
import matchesRouter     from './routes/matches.js';
import pairsRouter       from './routes/pairs.js';
import readonlyRouter    from './routes/readonly.js';
import authRouter from './routes/auth.js';

const app  = express();
const PORT = process.env.PORT ?? 3001;

// Rate limiter para login (5 intentos por IP cada 15 minutos)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  message: { error: 'Demasiados intentos de login. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combinar IP con email para rate limit más granular
    const email = req.body?.email || 'unknown';
    return `${req.ip}:${email}`;
  },
  skip: (req) => req.method !== 'POST' // Solo aplicar a POST
});

// Middlewares
app.use(cors({ 
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true // Permitir cookies cross-origin
}));
app.use(cookieParser());
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Aplicar rate limiter solo a login
app.use('/api/auth/login', loginLimiter);
// Rutas
app.use('/api/groups',      groupsRouter);
app.use('/api/players',     playersRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/matches',     matchesRouter);
app.use('/api/pairs',       pairsRouter);
app.use('/api/readonly',    readonlyRouter);
app.use('/api/auth', authRouter);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Manejador global de errores
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`🎾 Padeliando API corriendo en ${process.env.BACK_URL ? process.env.BACK_URL : `http://localhost:${PORT}`}`);
});
