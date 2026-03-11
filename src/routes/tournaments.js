import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
 
const router = Router();
 
// GET /api/tournaments/:id
router.get('/:id', async (req, res, next) => {
  try {
    const sql = getDb();
    const { id } = req.params;
 
    const [tournament] = await sql`SELECT * FROM tournaments WHERE id = ${id}`;
    if (!tournament) return res.status(404).json({ error: 'Torneo no encontrado' });
 
    const pairs = await sql`SELECT * FROM pairs WHERE tournament_id = ${id}`;
 
    const matches = await sql`
      SELECT * FROM matches WHERE tournament_id = ${id} ORDER BY created_at DESC
    `;
 
    const players = await sql`
      SELECT p.* FROM players p
      INNER JOIN group_players gp ON gp.player_id = p.id
      WHERE gp.group_id = ${tournament.group_id}
    `;
 
    res.json({ ...tournament, players, pairs, matches });
  } catch (err) { next(err); }
});
 
// POST /api/tournaments
// Body: { groupId, name, mode, playerNames[], pairs?: [{p1Name,p2Name}] }
router.post('/', async (req, res, next) => {
  try {
    const {
      groupId, name, mode = 'free',
      playerNames = [], pairs: pairsInput = []
    } = req.body;
 
    if (!groupId)      return res.status(400).json({ error: 'groupId requerido' });
    if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });
 
    const sql  = getDb();
    const tId  = uid();
 
    // Resolver jugadores
    const players = [];
    for (const rawName of playerNames.filter(Boolean)) {
      let [player] = await sql`SELECT * FROM players WHERE LOWER(name) = LOWER(${rawName.trim()})`;
      if (!player) {
        [player] = await sql`
          INSERT INTO players (id, name) VALUES (${uid()}, ${rawName.trim()}) RETURNING *
        `;
      }
      await sql`INSERT INTO group_players (group_id, player_id)
        VALUES (${groupId}, ${player.id}) ON CONFLICT DO NOTHING
      `;
      players.push(player);
    }
 
    const [tournament] = await sql`
        INSERT INTO tournaments (id, group_id, name, mode)
        VALUES (${tId}, ${groupId}, ${name.trim()}, ${mode})
      RETURNING *`;
 
    // Crear parejas fijas si modo=pairs
    const pairs = [];
    for (const { p1Name, p2Name } of pairsInput) {
      const p1 = players.find((p) => p.name.toLowerCase() === p1Name.toLowerCase());
      const p2 = players.find((p) => p.name.toLowerCase() === p2Name.toLowerCase());
      if (!p1 || !p2) continue;
      const [pair] = await sql`
        INSERT INTO pairs (id, tournament_id, p1_id, p2_id)
        VALUES (${uid()}, ${tId}, ${p1.id}, ${p2.id}) RETURNING *
      `;
      pairs.push(pair);
    }
 
    res.status(201).json({ ...tournament, players, pairs, matches: [] });
  } catch (err) { next(err); }
});
 
// PATCH /api/tournaments/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { id }           = req.params;
    const { name, status } = req.body;
    const sql = getDb();
    const [updated] = await sql`
      UPDATE tournaments
      SET name   = COALESCE(${name   ?? null}, name),
          status = COALESCE(${status ?? null}, status)
      WHERE id = ${id} RETURNING *
    `;
    if (!updated) return res.status(404).json({ error: 'Torneo no encontrado' });
    res.json(updated);
  } catch (err) { next(err); }
});
 
// DELETE /api/tournaments/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const sql = getDb();
    await sql`DELETE FROM tournaments WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/tournaments/:id/matches  — reiniciar scores
router.delete('/:id/matches', async (req, res, next) => {
  try {
    const sql = getDb();
    await sql`DELETE FROM matches WHERE tournament_id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});
 
export default router;
