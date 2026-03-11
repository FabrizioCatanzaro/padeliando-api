import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
 
const router = Router();
 
// POST /api/matches
router.post('/', async (req, res, next) => {
  try {
    const { tournamentId, team1, team2, score1, score2, playedAt, duration_seconds } = req.body;
 
    if (!tournamentId || !team1?.[0] || !team1?.[1] || !team2?.[0] || !team2?.[1]) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }
    if (new Set([...team1, ...team2]).size !== 4) {
      return res.status(400).json({ error: 'Los 4 jugadores deben ser distintos' });
    }
 
    const sql = getDb();
    const today = new Date().toISOString().slice(0, 10);
 
    const [match] = await sql`
      INSERT INTO matches
        (id, tournament_id, team1_p1, team1_p2, team2_p1, team2_p2,
         score1, score2, played_at, duration_seconds)
      VALUES
        (${uid()}, ${tournamentId},
         ${team1[0]}, ${team1[1]}, ${team2[0]}, ${team2[1]},
         ${score1}, ${score2}, ${playedAt ?? today}, ${duration_seconds})
      RETURNING *
    `;
    res.status(201).json(match);
  } catch (err) { next(err); }
});
 
// PUT /api/matches/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { team1, team2, score1, score2, playedAt, duration_seconds } = req.body;
    const sql = getDb();
    const [match] = await sql`
      UPDATE matches SET
        team1_p1  = ${team1[0]}, team1_p2 = ${team1[1]},
        team2_p1  = ${team2[0]}, team2_p2 = ${team2[1]},
        score1    = ${score1},   score2   = ${score2},
        played_at = ${playedAt},
        duration_seconds = ${duration_seconds}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!match) return res.status(404).json({ error: 'Partido no encontrado' });
    res.json(match);
  } catch (err) { next(err); }
});
 
// DELETE /api/matches/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const sql = getDb();
    await sql`DELETE FROM matches WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});
 
export default router;
