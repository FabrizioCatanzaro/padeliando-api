import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/players?q=nombre[&groupId=xxx][&mine=true]
// - groupId: filtra jugadores de ese grupo específico.
// - mine=true: filtra jugadores de todos los grupos del usuario autenticado.
// - Sin parámetros: resultados globales (compatibilidad).
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const sql     = getDb();
    const q       = `%${(req.query.q ?? '').trim()}%`;
    const groupId = req.query.groupId;
    const mine    = req.query.mine === 'true' && !!req.user;

    let players;
    if (groupId) {
      players = await sql`
        SELECT p.*
        FROM   players p
        JOIN   group_players gp ON gp.player_id = p.id
        WHERE  gp.group_id = ${groupId}
          AND  p.name ILIKE ${q}
        ORDER  BY p.name ASC
        LIMIT  30`;
    } else if (mine) {
      players = await sql`
        SELECT DISTINCT p.*
        FROM   players p
        JOIN   group_players gp ON gp.player_id = p.id
        JOIN   groups g         ON g.id = gp.group_id
        WHERE  g.user_id = ${req.user.id}
          AND  p.name ILIKE ${q}
        ORDER  BY p.name ASC
        LIMIT  30`;
    } else {
      players = await sql`
        SELECT * FROM players WHERE name ILIKE ${q} ORDER BY name ASC LIMIT 30`;
    }

    res.json(players);
  } catch (err) { next(err); }
});

// GET /api/players/group/:groupId
router.get('/group/:groupId', async (req, res, next) => {
  try {
    const sql = getDb();
    const players = await sql`
      SELECT p.*
      FROM   players p
      JOIN   group_players gp ON gp.player_id = p.id
      WHERE  gp.group_id = ${req.params.groupId}
      ORDER  BY p.name ASC
    `;
    res.json(players);
  } catch (err) { next(err); }
});

// POST /api/players/resolve
// Body: { name, groupId, tournamentId? }
// Busca el jugador dentro del grupo (no globalmente).
// Si existe en ese grupo lo reutiliza; si no, crea uno nuevo aunque el nombre exista en otro grupo.
// Si se pasa tournamentId, también vincula el jugador a esa jornada específica.
router.post('/resolve', async (req, res, next) => {
  try {
    const { name, groupId, tournamentId } = req.body;
    if (!name?.trim())  return res.status(400).json({ error: 'name requerido' });
    if (!groupId)       return res.status(400).json({ error: 'groupId requerido' });

    const sql = getDb();

    // Busca dentro del grupo ignorando mayúsculas
    let [player] = await sql`
      SELECT p.*
      FROM   players p
      JOIN   group_players gp ON gp.player_id = p.id
      WHERE  gp.group_id = ${groupId}
        AND  LOWER(p.name) = LOWER(${name.trim()})
    `;

    if (!player) {
      [player] = await sql`
        INSERT INTO players (id, name) VALUES (${uid()}, ${name.trim()}) RETURNING *
      `;
    }

    // Vincula al grupo (ignora si ya existe)
    await sql`
      INSERT INTO group_players (group_id, player_id)
      VALUES (${groupId}, ${player.id}) ON CONFLICT DO NOTHING
    `;

    // Vincula a la jornada específica si se provee tournamentId
    if (tournamentId) {
      await sql`
        INSERT INTO tournament_players (tournament_id, player_id)
        VALUES (${tournamentId}, ${player.id}) ON CONFLICT DO NOTHING
      `;
    }

    res.status(201).json({ player });
  } catch (err) { next(err); }
});

// DELETE /api/players/:playerId/tournament/:tournamentId
// Elimina al jugador de una jornada específica (no del grupo completo)
router.delete('/:playerId/tournament/:tournamentId', async (req, res, next) => {
  try {
    const { playerId, tournamentId } = req.params;
    const sql = getDb();
    await sql`
      DELETE FROM tournament_players
      WHERE tournament_id = ${tournamentId} AND player_id = ${playerId}
    `;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/players/:playerId/group/:groupId
router.delete('/:playerId/group/:groupId', async (req, res, next) => {
  try {
    const { playerId, groupId } = req.params;
    const sql = getDb();
    await sql`
      DELETE FROM group_players
      WHERE group_id = ${groupId} AND player_id = ${playerId}
    `;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/players/:playerId
// Renombrar un jugador. La colisión ahora se verifica solo dentro del mismo grupo.
// Body: { name, groupId }
router.patch('/:playerId', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const { name, groupId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });

    const sql = getDb();

    if (groupId) {
      // Verifica colisión solo dentro del grupo
      const [collision] = await sql`
        SELECT p.id FROM players p
        JOIN group_players gp ON gp.player_id = p.id
        WHERE gp.group_id = ${groupId}
          AND LOWER(p.name) = LOWER(${name.trim()})
          AND p.id != ${playerId}
      `;
      if (collision) {
        return res.status(409).json({ error: `Ya hay un jugador llamado '${name.trim()}' en este grupo` });
      }
    }

    const [updated] = await sql`
      UPDATE players SET name = ${name.trim()} WHERE id = ${playerId} RETURNING *
    `;
    res.json(updated);
  } catch (err) { next(err); }
});

export default router;
