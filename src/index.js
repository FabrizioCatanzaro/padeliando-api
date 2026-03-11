import 'dotenv/config';
import express  from 'express';
import cors     from 'cors';

import groupsRouter      from './routes/groups.js';
import playersRouter     from './routes/players.js';
import tournamentsRouter from './routes/tournaments.js';
import matchesRouter     from './routes/matches.js';
import pairsRouter       from './routes/pairs.js';
import readonlyRouter    from './routes/readonly.js';

const app  = express();
const PORT = process.env.PORT ?? 3001;

// Middlewares
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
app.use(express.json());

// Rutas
app.use('/api/groups',      groupsRouter);
app.use('/api/players',     playersRouter);
app.use('/api/tournaments', tournamentsRouter);
app.use('/api/matches',     matchesRouter);
app.use('/api/pairs',       pairsRouter);
app.use('/api/readonly',    readonlyRouter);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Manejador global de errores
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Error interno' });
});

app.listen(PORT, () => {
  console.log(`🎾 Padeliando API corriendo en http://localhost:${PORT}`);
});
