import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
import { optionalAuth } from '../middleware/auth.js';

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
 
    // Incluir info de vinculación: usuario registrado + invitación pendiente si aplica
    // Solo jugadores explícitamente agregados a esta jornada (tournament_players)
    const players = await sql`
      SELECT
        p.*,
        u.username   AS linked_username,
        u.name       AS linked_name,
        pi.id        AS invitation_id,
        pi.status    AS invitation_status,
        pi.invited_identifier
      FROM players p
      INNER JOIN tournament_players tp ON tp.player_id = p.id AND tp.tournament_id = ${id}
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN player_invitations pi
        ON pi.player_id = p.id AND pi.group_id = ${tournament.group_id} AND pi.status = 'pending'
    `;
 
    res.json({ ...tournament, players, pairs, matches });
  } catch (err) { next(err); }
});
 
// POST /api/tournaments
// Body: { groupId, name, mode, playerNames[], pairs?: [{p1Name,p2Name}] }
// playerNames puede incluir entradas @username para vincular a usuarios registrados.
router.post('/', optionalAuth, async (req, res, next) => {
  try {
    const {
      groupId, name, mode = 'free',
      playerNames = [], pairs: pairsInput = []
    } = req.body;

    if (!groupId)      return res.status(400).json({ error: 'groupId requerido' });
    if (!name?.trim()) return res.status(400).json({ error: 'nombre requerido' });
    if (name.trim().length < 2) return res.status(400).json({ error: 'El nombre la jornada tiene que tener mas de 2 caracteres' });
    if (name.trim().length > 30) return res.status(400).json({ error: 'El nombre la jornada no puede superar los 30 caracteres' });

    const sql  = getDb();
    const tId  = uid();

    const players = [];
    const nameMap = {};           // rawName.toLowerCase() → player (para matching de parejas)
    const pendingInvitations = []; // { player, inviteUserId, inviteUsername }

    for (const rawName of playerNames.filter(Boolean)) {
      const trimmed = rawName.trim();
      let resolvedName = trimmed;
      let inviteUserId   = null;
      let inviteUsername = null;

      // Resolver @username → nombre real del usuario
      if (trimmed.startsWith('@')) {
        const username = trimmed.slice(1);
        if (!username) continue;
        const [foundUser] = await sql`SELECT id, name, username FROM users WHERE username = ${username}`;
        if (!foundUser) return res.status(404).json({ error: `No existe el usuario @${username}` });
        resolvedName   = foundUser.name;
        inviteUserId   = foundUser.id;
        inviteUsername = foundUser.username;
      }

      let [player] = await sql`
        SELECT p.* FROM players p
        JOIN group_players gp ON gp.player_id = p.id
        WHERE gp.group_id = ${groupId} AND LOWER(p.name) = LOWER(${resolvedName})
      `;
      if (!player) {
        [player] = await sql`
          INSERT INTO players (id, name) VALUES (${uid()}, ${resolvedName}) RETURNING *
        `;
      }
      await sql`INSERT INTO group_players (group_id, player_id)
        VALUES (${groupId}, ${player.id}) ON CONFLICT DO NOTHING
      `;
      players.push(player);
      nameMap[trimmed.toLowerCase()] = player;

      if (inviteUserId && !player.user_id && req.user) {
        pendingInvitations.push({ player, inviteUserId, inviteUsername });
      }
    }

    const [tournament] = await sql`
        INSERT INTO tournaments (id, group_id, name, mode)
        VALUES (${tId}, ${groupId}, ${name.trim()}, ${mode})
      RETURNING *`;

    for (const player of players) {
      await sql`
        INSERT INTO tournament_players (tournament_id, player_id)
        VALUES (${tId}, ${player.id}) ON CONFLICT DO NOTHING
      `;
    }

    // Crear parejas — el nameMap permite que @username matchee con el jugador resuelto
    const pairs = [];
    for (const { p1Name, p2Name } of pairsInput) {
      const p1 = nameMap[p1Name.toLowerCase()] ?? players.find((p) => p.name.toLowerCase() === p1Name.toLowerCase());
      const p2 = nameMap[p2Name.toLowerCase()] ?? players.find((p) => p.name.toLowerCase() === p2Name.toLowerCase());
      if (!p1 || !p2) continue;
      const [pair] = await sql`
        INSERT INTO pairs (id, tournament_id, p1_id, p2_id)
        VALUES (${uid()}, ${tId}, ${p1.id}, ${p2.id}) RETURNING *
      `;
      pairs.push(pair);
    }

    // Crear invitaciones para jugadores agregados por @username
    for (const { player, inviteUserId, inviteUsername } of pendingInvitations) {
      const [existing] = await sql`
        SELECT id FROM player_invitations WHERE player_id = ${player.id} AND status = 'pending'
      `;
      if (!existing) {
        await sql`
          INSERT INTO player_invitations
            (id, player_id, group_id, invited_by, invited_identifier, invited_user_id)
          VALUES
            (${uid()}, ${player.id}, ${groupId}, ${req.user.id}, ${'@' + inviteUsername}, ${inviteUserId})
        `;
      }
    }

    res.status(201).json({ ...tournament, players, pairs, matches: [] });
  } catch (err) { next(err); }
});
 
// PATCH /api/tournaments/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { id }           = req.params;
    const { name, status, mode } = req.body;
    if (name !== undefined && name.trim().length > 30) return res.status(400).json({ error: 'El nombre la jornada no puede superar los 30 caracteres' });
    if (name !== undefined && name.trim().length < 2) return res.status(400).json({ error: 'El nombre la jornada debe superar los 2 caracteres' });
    const sql = getDb();
    const [updated] = await sql`
      UPDATE tournaments
      SET name   = COALESCE(${name   ?? null}, name),
          status = COALESCE(${status ?? null}, status),
          mode   = COALESCE(${mode   ?? null}, mode)
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
 
// PATCH /api/tournaments/:id/live
router.patch('/:id/live', async (req, res, next) => {
  try {
    const { live_match } = req.body;
    const sql = getDb();
    const val = live_match != null ? JSON.stringify(live_match) : null;
    await sql`UPDATE tournaments SET live_match = ${val}::jsonb WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
