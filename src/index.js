import 'dotenv/config';
import express     from 'express';
import cors        from 'cors';
import cookieParser from 'cookie-parser';
import morgan      from 'morgan';

import groupsRouter      from './routes/groups.js';
import playersRouter     from './routes/players.js';
import tournamentsRouter from './routes/tournaments.js';
import matchesRouter     from './routes/matches.js';
import pairsRouter       from './routes/pairs.js';
import readonlyRouter    from './routes/readonly.js';
import authRouter        from './routes/auth.js';
import invitationsRouter    from './routes/invitations.js';
import subscriptionsRouter  from './routes/subscriptions.js';
import { getDb } from './db.js';

const app  = express();
const PORT = process.env.PORT ?? 3001;

const ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',');

app.use(cors({
  origin: (origin, cb) => {
    // Permitir requests sin origin (Postman, curl) en dev
    if (!origin || ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,   // ← necesario para enviar/recibir cookies cross-origin
}));

app.use(morgan('dev'));
app.use(cookieParser());
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api/auth',        authRouter);
app.use('/api/groups',      groupsRouter);
app.use('/api/players',     playersRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/matches',     matchesRouter);
app.use('/api/pairs',       pairsRouter);
app.use('/api/readonly',    readonlyRouter);
app.use('/api/invitations',   invitationsRouter);
app.use('/api/subscriptions', subscriptionsRouter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Error interno' });
});

app.listen(PORT, async () => {
  console.log(`Padeleando API en puerto ${PORT}`);
    try {
      const sql = getDb();
      await sql`SELECT 1`;
      console.log('DB conectada');
    } catch (err) {
      console.error('Error conectando a DB:', err.message);
    }
});