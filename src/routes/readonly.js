import { Router } from 'express';
import { getDb }  from '../db.js';
 
const router = Router();
 
// GET /api/readonly/:tournamentId  — endpoint público sin autenticación
router.get('/:tournamentId', async (req, res, next) => {
  try {
    const sql = getDb();
    const { tournamentId } = req.params;
 
    const [tournament] = await sql`
      SELECT * FROM tournaments WHERE id = ${tournamentId}
    `;
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
 
    const pairs = await sql`SELECT * FROM pairs WHERE tournament_id = ${tournamentId}`;
 
    const matches = await sql`
      SELECT * FROM matches
      WHERE tournament_id = ${tournamentId}
      ORDER BY created_at DESC
    `;
 
    const playerIds = [
      ...new Set([
        ...pairs.flatMap((p) => [p.p1_id, p.p2_id]),
        ...matches.flatMap((m) => [m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2]),
      ]),
    ];

        const players = playerIds.length
      ? await sql`SELECT id, name FROM players WHERE id = ANY(${playerIds})`
      : [];
 
    res.json({
      id:         tournament.id,
      name:       tournament.name,
      mode:       tournament.mode,
      created_at: tournament.created_at,
      players,
      pairs,
      matches,
    });
  } catch (err) { next(err); }
});
 
export default router;
