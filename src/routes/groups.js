import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
const router = Router();
import { requireAuth, optionalAuth } from '../middleware/auth.js';

// GET /api/groups — solo los del usuario autenticado
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const groups = await sql`
      SELECT g.*,
        (SELECT COUNT(DISTINCT tp.player_id)::int
         FROM tournament_players tp
         JOIN tournaments t ON t.id = tp.tournament_id
         WHERE t.group_id = g.id) AS player_count,
        (SELECT COUNT(*)::int FROM tournaments t WHERE t.group_id = g.id) AS tournament_count
      FROM groups g
      WHERE g.user_id = ${req.user.id}
      ORDER BY g.created_at DESC
    `;
    res.json(groups);
  } catch (err) { next(err); }
});

// GET /api/groups/participating — grupos ajenos donde el usuario tiene un player vinculado (invitación aceptada)
router.get('/participating', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const groups = await sql`
      SELECT g.*,
        u.username AS owner_username,
        u.name     AS owner_name,
        (SELECT COUNT(DISTINCT tp.player_id)::int
         FROM tournament_players tp
         JOIN tournaments t ON t.id = tp.tournament_id
         WHERE t.group_id = g.id) AS player_count,
        (SELECT COUNT(*)::int FROM tournaments t WHERE t.group_id = g.id) AS tournament_count
      FROM groups g
      JOIN users u ON u.id = g.user_id
      WHERE g.user_id != ${req.user.id}
        AND EXISTS (
          SELECT 1 FROM group_players ugp
          JOIN players p ON p.id = ugp.player_id AND p.user_id = ${req.user.id}
          WHERE ugp.group_id = g.id
        )
      ORDER BY g.created_at DESC
    `;
    res.json(groups);
  } catch (err) { next(err); }
});

// GET /api/groups/user/:username — perfil público de otro usuario
router.get('/user/:username', optionalAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const [owner] = await sql`SELECT id, name, username, created_at FROM users WHERE username = ${req.params.username}`;
    if (!owner) return res.status(404).json({ error: 'Usuario no encontrado' });

    const isOwner = req.user?.id === owner.id;

    const groups = await sql`
      SELECT g.*,
        (SELECT COUNT(DISTINCT tp.player_id)::int
         FROM tournament_players tp
         JOIN tournaments t ON t.id = tp.tournament_id
         WHERE t.group_id = g.id) AS player_count,
        (SELECT COUNT(*)::int FROM tournaments t WHERE t.group_id = g.id) AS tournament_count
      FROM groups g
      WHERE g.user_id = ${owner.id}
        AND (${isOwner} OR g.is_public = true)
      ORDER BY g.created_at DESC
    `;

    const [playerStats] = await sql`
      SELECT
        COUNT(DISTINCT tp.tournament_id)::int AS torneos,
        COUNT(m.id)::int                      AS partidos,
        COALESCE(SUM(CASE
          WHEN m.score1 > m.score2 AND (m.team1_p1 = p.id OR m.team1_p2 = p.id) THEN 1
          WHEN m.score2 > m.score1 AND (m.team2_p1 = p.id OR m.team2_p2 = p.id) THEN 1
          ELSE 0 END), 0)::int                AS victorias
      FROM players p
      JOIN tournament_players tp ON tp.player_id = p.id
      LEFT JOIN matches m ON m.tournament_id = tp.tournament_id
        AND (m.team1_p1 = p.id OR m.team1_p2 = p.id
          OR m.team2_p1 = p.id OR m.team2_p2 = p.id)
      WHERE p.user_id = ${owner.id}
    `;

    res.json({ owner, groups, stats: playerStats ?? { torneos: 0, partidos: 0, victorias: 0 } });
  } catch (err) { next(err); }
});

// GET /api/groups/search?q= — busca grupos públicos por nombre
router.get('/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const sql = getDb();
    const groups = await sql`
      SELECT g.id, g.name, g.description, g.emojis, g.created_at,
             u.username AS owner_username, u.name AS owner_name
      FROM groups g
      JOIN users u ON u.id = g.user_id
      WHERE g.is_public = true
        AND g.name ILIKE ${'%' + q + '%'}
      ORDER BY g.created_at DESC
      LIMIT 10
    `;
    res.json(groups);
  } catch (err) { next(err); }
});

// GET /api/groups/:groupId/history — estadísticas históricas de todas las jornadas
router.get('/:groupId/history', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const sql = getDb();

    const tournaments = await sql`
      SELECT id, name, created_at, status, mode, format, bracket
      FROM   tournaments
      WHERE  group_id = ${groupId}
      ORDER  BY created_at ASC
    `;

    const result = [];
    for (const t of tournaments) {
      const players = await sql`
        SELECT p.id, p.name FROM players p
        JOIN tournament_players tp ON tp.player_id = p.id AND tp.tournament_id = ${t.id}
      `;
      const matches = await sql`
        SELECT * FROM matches WHERE tournament_id = ${t.id} ORDER BY created_at DESC
      `;
      const pairs = await sql`
        SELECT * FROM pairs WHERE tournament_id = ${t.id}
      `;
      result.push({ ...t, players, matches, pairs });
    }

    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/groups/:groupId
router.get('/:groupId', async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const sql = getDb();

    const [group] = await sql`
      SELECT g.*, u.username AS owner_username, u.name AS owner_name
      FROM groups g
      JOIN users u ON u.id = g.user_id
      WHERE g.id = ${groupId}
    `;
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const tournaments = await sql`
      SELECT t.*, COUNT(m.id)::int AS match_count
      FROM   tournaments t
      LEFT JOIN matches m ON m.tournament_id = t.id
      WHERE  t.group_id = ${groupId}
      GROUP  BY t.id
      ORDER  BY t.created_at DESC
    `;

    // ── Ganador por jornada finalizada ──────────────────────────────────────
    const finishedIds = tournaments.filter((t) => t.status === 'finished').map((t) => t.id);
    if (finishedIds.length > 0) {
      const wins = await sql`
        SELECT tournament_id, player_id,
               SUM(won)::int AS wins, SUM(diff)::int AS gdiff
        FROM (
          SELECT tournament_id, team1_p1 AS player_id,
                 (CASE WHEN score1 > score2 THEN 1 ELSE 0 END) AS won, score1 - score2 AS diff
          FROM matches WHERE tournament_id = ANY(${finishedIds})
          UNION ALL
          SELECT tournament_id, team1_p2,
                 (CASE WHEN score1 > score2 THEN 1 ELSE 0 END), score1 - score2
          FROM matches WHERE tournament_id = ANY(${finishedIds}) AND team1_p2 IS NOT NULL
          UNION ALL
          SELECT tournament_id, team2_p1,
                 (CASE WHEN score2 > score1 THEN 1 ELSE 0 END), score2 - score1
          FROM matches WHERE tournament_id = ANY(${finishedIds})
          UNION ALL
          SELECT tournament_id, team2_p2,
                 (CASE WHEN score2 > score1 THEN 1 ELSE 0 END), score2 - score1
          FROM matches WHERE tournament_id = ANY(${finishedIds}) AND team2_p2 IS NOT NULL
        ) sub WHERE player_id IS NOT NULL
        GROUP BY tournament_id, player_id
      `;

      const playerIds = [...new Set(wins.map((w) => w.player_id))];
      const pNames = playerIds.length
        ? await sql`SELECT id, name FROM players WHERE id = ANY(${playerIds})`
        : [];
      const nameById = Object.fromEntries(pNames.map((p) => [p.id, p.name]));

      const pairsModeIds = tournaments
        .filter((t) => t.status === 'finished' && t.mode === 'pairs')
        .map((t) => t.id);
      const allPairs = pairsModeIds.length
        ? await sql`SELECT * FROM pairs WHERE tournament_id = ANY(${pairsModeIds})`
        : [];

      const winsByT = {};
      wins.forEach((w) => { (winsByT[w.tournament_id] ??= []).push(w); });

      for (const t of tournaments) {
        if (t.status !== 'finished') continue;

        // Americano: el ganador es quien ganó la final del bracket
        if (t.format === 'americano' && t.bracket?.final?.winner_name) {
          t.winner_label = t.bracket.final.winner_name;
          continue;
        }

        const tWins = winsByT[t.id] ?? [];
        if (!tWins.length) continue;
        const maxW    = Math.max(...tWins.map((w) => w.wins));
        const topByW  = tWins.filter((w) => w.wins === maxW);
        const maxD    = Math.max(...topByW.map((w) => w.gdiff));
        const topList = topByW.filter((w) => w.gdiff === maxD);
        const topIds  = new Set(topList.map((w) => w.player_id));

        if (t.mode === 'pairs') {
          const tPairs      = allPairs.filter((p) => p.tournament_id === t.id);
          const winnerPairs = tPairs.filter((p) => topIds.has(p.p1_id) && topIds.has(p.p2_id));
          t.winner_label = winnerPairs.length
            ? winnerPairs.map((p) => `${nameById[p.p1_id] ?? '?'} & ${nameById[p.p2_id] ?? '?'}`).join(' / ')
            : topList.map((w) => nameById[w.player_id] ?? '?').join(' / ');
        } else {
          t.winner_label = topList.map((w) => nameById[w.player_id] ?? '?').join(' / ');
        }
      }
    }

    const playerStats = await sql`
      SELECT
        p.id, p.name,
        COUNT(DISTINCT t.id)::int AS torneos,
        SUM(CASE
          WHEN m.score1 > m.score2 AND (m.team1_p1 = p.id OR m.team1_p2 = p.id) THEN 1
          WHEN m.score2 > m.score1 AND (m.team2_p1 = p.id OR m.team2_p2 = p.id) THEN 1
          ELSE 0 END)::int AS victorias,
        COUNT(m.id)::int AS partidos
      FROM   players p
      JOIN   group_players gp ON gp.player_id = p.id AND gp.group_id = ${groupId}
      JOIN   tournaments   t  ON t.group_id = ${groupId}
      LEFT JOIN matches    m  ON m.tournament_id = t.id
        AND (m.team1_p1 = p.id OR m.team1_p2 = p.id
          OR m.team2_p1 = p.id OR m.team2_p2 = p.id)
      GROUP BY p.id, p.name
      ORDER BY victorias DESC
    `;

    const tournamentWinners = await sql`
      WITH pw AS (
        SELECT t.id AS tid, t.name AS tname, t.created_at,
               p.id AS pid, p.name AS pname,
               SUM(CASE
                 WHEN m.score1 > m.score2 AND (m.team1_p1 = p.id OR m.team1_p2 = p.id) THEN 1
                 WHEN m.score2 > m.score1 AND (m.team2_p1 = p.id OR m.team2_p2 = p.id) THEN 1
                 ELSE 0 END) AS wins
        FROM   tournaments t
        JOIN   matches m ON m.tournament_id = t.id
        JOIN   players p ON p.id IN (m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2)
        WHERE  t.group_id = ${groupId}
        GROUP  BY t.id, t.name, t.created_at, p.id, p.name
      ),
      ranked AS (
        SELECT *, RANK() OVER (PARTITION BY tid ORDER BY wins DESC) AS rnk
        FROM pw WHERE wins > 0
      )
      SELECT * FROM ranked WHERE rnk = 1 ORDER BY created_at DESC
    `;

    res.json({ ...group, tournaments, stats: { playerStats, tournamentWinners } });
  } catch (err) { next(err); }
});

// POST /api/groups — requiere auth
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description, is_public = true, emojis = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });
    if (name.trim().length > 30) return res.status(400).json({ error: 'El nombre del torneo no puede superar los 30 caracteres' });
    if (name.trim().length < 2) return res.status(400).json({ error: 'El nombre del torneo debe tener mas de 2 caracteres' });
    const sql = getDb();
    const [group] = await sql`
      INSERT INTO groups (id, name, description, user_id, is_public, emojis)
      VALUES (${uid()}, ${name.trim()}, ${description ?? null}, ${req.user.id}, ${is_public}, ${emojis})
      RETURNING *
    `;
    res.status(201).json(group);
  } catch (err) { next(err); }
});

// PUT /api/groups/:groupId — solo el dueño
router.put('/:groupId', requireAuth, async (req, res, next) => {
  try {
    const { name, description, is_public, emojis } = req.body;
    if (name !== undefined && name.trim().length > 30) return res.status(400).json({ error: 'El nombre del torneo no puede superar los 30 caracteres' });
    if (name !== undefined && name.trim().length < 2) return res.status(400).json({ error: 'El nombre del torneo debe tener mas de 2 caracteres' });
    const sql = getDb();
    const [group] = await sql`SELECT user_id FROM groups WHERE id = ${req.params.groupId}`;
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    if (group.user_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });

    const [updated] = await sql`
      UPDATE groups
      SET name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          is_public = COALESCE(${is_public ?? null}, is_public),
          emojis = COALESCE(${emojis ?? null}, emojis)
      WHERE id = ${req.params.groupId} RETURNING *
    `;
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/groups/:groupId — solo el dueño
router.delete('/:groupId', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const [group] = await sql`SELECT user_id FROM groups WHERE id = ${req.params.groupId}`;
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    if (group.user_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    await sql`DELETE FROM groups WHERE id = ${req.params.groupId}`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

