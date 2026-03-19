import { Router } from 'express';
import { getDb }  from '../db.js';
 
const router = Router();
 
// GET /api/readonly/:tournamentId  — endpoint público sin autenticación
router.get('/:tournamentId', async (req, res, next) => {
  try {
    const sql = getDb();
    const { tournamentId } = req.params;
 
    const [tournament] = await sql`
      SELECT t.*, u.username AS owner_username
      FROM   tournaments t
      JOIN   groups g ON g.id = t.group_id
      JOIN   users  u ON u.id = g.user_id
      WHERE  t.id = ${tournamentId}
    `;
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
 
    const pairs = await sql`SELECT * FROM pairs WHERE tournament_id = ${tournamentId}`;
 
    const matches = await sql`
      SELECT * FROM matches
      WHERE tournament_id = ${tournamentId}
      ORDER BY created_at DESC
    `;
 
    // Canonical player list from tournament_players table
    const tpPlayers = await sql`
      SELECT p.id, p.name FROM players p
      INNER JOIN tournament_players tp ON tp.player_id = p.id AND tp.tournament_id = ${tournamentId}
    `;

    // Backward-compat: also include any players from matches/pairs not in tournament_players
    const tpIds = new Set(tpPlayers.map((p) => p.id));
    const extraIds = [
      ...new Set([
        ...pairs.flatMap((p) => [p.p1_id, p.p2_id]),
        ...matches.flatMap((m) => [m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2]),
      ]),
    ].filter((id) => id && !tpIds.has(id));

    const extraPlayers = extraIds.length
      ? await sql`SELECT id, name FROM players WHERE id = ANY(${extraIds})`
      : [];

    const players = [...tpPlayers, ...extraPlayers];
 
    res.json({
      id:             tournament.id,
      name:           tournament.name,
      mode:           tournament.mode,
      status:         tournament.status,
      live_match:     tournament.live_match ?? null,
      group_id:       tournament.group_id,
      owner_username: tournament.owner_username,
      created_at:     tournament.created_at,
      players,
      pairs,
      matches,
    });
  } catch (err) { next(err); }
});
 
export default router;
