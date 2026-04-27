import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
const router = Router();
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { getActiveSubscription } from './subscriptions.js';

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
        u.username   AS owner_username,
        u.name       AS owner_name,
        u.avatar_url AS owner_avatar_url,
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
    const [owner] = await sql`SELECT id, name, username, avatar_url, created_at, social_links FROM users WHERE username = ${req.params.username}`;
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
          ELSE 0 END), 0)::int                AS victorias,
        COUNT(DISTINCT CASE WHEN t.format = 'americano' THEN tp.tournament_id END)::int AS torneos_americanos
      FROM players p
      JOIN tournament_players tp ON tp.player_id = p.id
      JOIN tournaments t ON t.id = tp.tournament_id
      LEFT JOIN matches m ON m.tournament_id = tp.tournament_id
        AND (m.team1_p1 = p.id OR m.team1_p2 = p.id
          OR m.team2_p1 = p.id OR m.team2_p2 = p.id)
      WHERE p.user_id = ${owner.id}
    `;

    const matchResults = await sql`
      SELECT
        CASE
          WHEN m.score1 > m.score2 AND (m.team1_p1 = p.id OR m.team1_p2 = p.id) THEN true
          WHEN m.score2 > m.score1 AND (m.team2_p1 = p.id OR m.team2_p2 = p.id) THEN true
          ELSE false
        END AS won
      FROM players p
      JOIN matches m ON (m.team1_p1 = p.id OR m.team1_p2 = p.id
        OR m.team2_p1 = p.id OR m.team2_p2 = p.id)
      WHERE p.user_id = ${owner.id}
      ORDER BY m.played_at DESC, m.created_at DESC
    `;
    let racha = 0, rachaMax = 0, streak = 0, currentDone = false;
    for (const row of matchResults) {
      if (row.won) {
        streak++;
        rachaMax = Math.max(rachaMax, streak);
        if (!currentDone) racha = streak;
      } else {
        currentDone = true;
        streak = 0;
      }
    }

    // Campeón americano = ganó la final del bracket (winner_id es un pair_id)
    const [americanoChamp] = await sql`
      WITH user_players AS (
        SELECT id FROM players WHERE user_id = ${owner.id}
      )
      SELECT COUNT(*)::int AS campeon_americano
      FROM tournaments t
      JOIN pairs pr
        ON pr.tournament_id = t.id
        AND pr.id = (t.bracket->'final'->>'winner_id')
      WHERE t.format = 'americano'
        AND t.status = 'finished'
        AND t.bracket->'final'->>'winner_id' IS NOT NULL
        AND (
          pr.p1_id IN (SELECT id FROM user_players)
          OR pr.p2_id IN (SELECT id FROM user_players)
        )
    `;

    const recentMatches = await sql`
      SELECT
        m.id,
        m.played_at,
        m.score1,
        m.score2,
        t.id   AS tournament_id,
        t.group_id,
        t.name AS tournament_name,
        CASE
          WHEN m.score1 > m.score2 AND (m.team1_p1 = p.id OR m.team1_p2 = p.id) THEN 'win'
          WHEN m.score2 > m.score1 AND (m.team2_p1 = p.id OR m.team2_p2 = p.id) THEN 'win'
          WHEN m.score1 = m.score2 THEN 'draw'
          ELSE 'loss'
        END AS result,
        CASE
          WHEN m.team1_p1 = p.id OR m.team1_p2 = p.id THEN m.score1
          ELSE m.score2
        END AS my_score,
        CASE
          WHEN m.team1_p1 = p.id OR m.team1_p2 = p.id THEN m.score2
          ELSE m.score1
        END AS opp_score,
        CASE
          WHEN m.team1_p1 = p.id THEN COALESCE(u1b.name, pb.name)
          WHEN m.team1_p2 = p.id THEN COALESCE(u1a.name, pa.name)
          WHEN m.team2_p1 = p.id THEN COALESCE(u2b.name, pd.name)
          WHEN m.team2_p2 = p.id THEN COALESCE(u2a.name, pc.name)
        END AS partner_name,
        CASE
          WHEN m.team1_p1 = p.id OR m.team1_p2 = p.id THEN COALESCE(u2a.name, pc.name)
          ELSE COALESCE(u1a.name, pa.name)
        END AS opp1_name,
        CASE
          WHEN m.team1_p1 = p.id OR m.team1_p2 = p.id THEN COALESCE(u2b.name, pd.name)
          ELSE COALESCE(u1b.name, pb.name)
        END AS opp2_name
      FROM players p
      JOIN matches m ON (m.team1_p1 = p.id OR m.team1_p2 = p.id
        OR m.team2_p1 = p.id OR m.team2_p2 = p.id)
      JOIN tournaments t ON t.id = m.tournament_id
      JOIN players pa ON pa.id = m.team1_p1 LEFT JOIN users u1a ON u1a.id = pa.user_id
      JOIN players pb ON pb.id = m.team1_p2 LEFT JOIN users u1b ON u1b.id = pb.user_id
      JOIN players pc ON pc.id = m.team2_p1 LEFT JOIN users u2a ON u2a.id = pc.user_id
      JOIN players pd ON pd.id = m.team2_p2 LEFT JOIN users u2b ON u2b.id = pd.user_id
      WHERE p.user_id = ${owner.id}
      ORDER BY m.played_at DESC, m.created_at DESC
      LIMIT 5
    `;

    const frequentPartners = await sql`
      SELECT
        COALESCE(u.name, partner.name)     AS name,
        u.username,
        u.avatar_url,
        (s.id IS NOT NULL)                 AS is_premium,
        COUNT(*)::int                      AS partidos_juntos
      FROM players p
      JOIN matches m ON (m.team1_p1 = p.id OR m.team1_p2 = p.id
        OR m.team2_p1 = p.id OR m.team2_p2 = p.id)
      JOIN players partner ON partner.id = (
        CASE
          WHEN m.team1_p1 = p.id THEN m.team1_p2
          WHEN m.team1_p2 = p.id THEN m.team1_p1
          WHEN m.team2_p1 = p.id THEN m.team2_p2
          WHEN m.team2_p2 = p.id THEN m.team2_p1
        END
      )
      LEFT JOIN users u ON u.id = partner.user_id
      LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' AND s.plan = 'premium'
      WHERE p.user_id = ${owner.id}
      GROUP BY COALESCE(partner.user_id, partner.id),
               COALESCE(u.name, partner.name), u.username, u.avatar_url, s.id
      ORDER BY partidos_juntos DESC
      LIMIT 5
    `;

    const sub = await getActiveSubscription(sql, owner.id);
    const baseStats = playerStats ?? { torneos: 0, partidos: 0, victorias: 0, torneos_americanos: 0 };
    res.json({
      owner: { ...owner, is_premium: sub.plan === 'premium' },
      groups,
      stats: { ...baseStats, racha, racha_max: rachaMax, campeon_americano: americanoChamp?.campeon_americano ?? 0 },
      recent_matches: recentMatches,
      frequent_partners: frequentPartners,
    });
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
             u.username AS owner_username, u.name AS owner_name, u.avatar_url AS owner_avatar_url
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

// GET /api/groups/nearby?lat=&lon=&radius= — grupos públicos con ubicación cercana (Haversine, radio en km)
router.get('/nearby', async (req, res, next) => {
  try {
    const lat    = parseFloat(req.query.lat);
    const lon    = parseFloat(req.query.lon);
    const radius = Math.min(parseFloat(req.query.radius) || 20, 100);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat y lon requeridos' });

    const sql = getDb();
    const groups = await sql`
      SELECT g.id, g.name, g.description, g.emojis, g.location_name, g.lat, g.lon,
             u.username AS owner_username, u.name AS owner_name,
             ROUND(
               (6371 * acos(
                 LEAST(1, cos(radians(${lat})) * cos(radians(g.lat)) *
                 cos(radians(g.lon) - radians(${lon})) +
                 sin(radians(${lat})) * sin(radians(g.lat)))
               ))::numeric, 1
             ) AS distance_km
      FROM groups g
      JOIN users u ON u.id = g.user_id
      WHERE g.is_public = true
        AND g.lat IS NOT NULL
        AND g.lon IS NOT NULL
        AND (6371 * acos(
          LEAST(1, cos(radians(${lat})) * cos(radians(g.lat)) *
          cos(radians(g.lon) - radians(${lon})) +
          sin(radians(${lat})) * sin(radians(g.lat)))
        )) <= ${radius}
      ORDER BY distance_km ASC
      LIMIT 20
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
        SELECT p.id, p.name, u.name AS linked_name, u.avatar_url AS linked_avatar_url
        FROM   players p
        JOIN   tournament_players tp ON tp.player_id = p.id AND tp.tournament_id = ${t.id}
        LEFT   JOIN users u ON u.id = p.user_id
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
      SELECT g.*, u.username AS owner_username, u.name AS owner_name, u.avatar_url AS owner_avatar_url
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
        ? await sql`
            SELECT p.id, COALESCE(u.name, p.name) AS name
            FROM players p LEFT JOIN users u ON u.id = p.user_id
            WHERE p.id = ANY(${playerIds})
          `
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

      // Americano: resolver ganador desde pares actuales (no desde el string guardado en el bracket)
      const americanoFinished = tournaments.filter(
        (t) => t.status === 'finished' && t.format === 'americano' && t.bracket?.final?.winner_id
      );
      if (americanoFinished.length > 0) {
        const americanoPairIds = americanoFinished.map((t) => t.bracket.final.winner_id);
        const americanoPairs = await sql`
          SELECT pr.id,
            COALESCE(u1.name, p1.name) AS p1_name,
            COALESCE(u2.name, p2.name) AS p2_name
          FROM pairs pr
          JOIN players p1 ON p1.id = pr.p1_id LEFT JOIN users u1 ON u1.id = p1.user_id
          JOIN players p2 ON p2.id = pr.p2_id LEFT JOIN users u2 ON u2.id = p2.user_id
          WHERE pr.id = ANY(${americanoPairIds})
        `;
        const americanoWinnerByPair = Object.fromEntries(
          americanoPairs.map((p) => [p.id, `${p.p1_name} & ${p.p2_name}`])
        );
        for (const t of americanoFinished) {
          t.winner_label = americanoWinnerByPair[t.bracket.final.winner_id] ?? t.bracket.final.winner_name;
        }
      }

      for (const t of tournaments) {
        if (t.status !== 'finished' || t.format === 'americano') continue;

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
        p.id, COALESCE(u.name, p.name) AS name, u.avatar_url AS linked_avatar_url,
        COUNT(DISTINCT t.id)::int AS torneos,
        SUM(CASE
          WHEN m.score1 > m.score2 AND (m.team1_p1 = p.id OR m.team1_p2 = p.id) THEN 1
          WHEN m.score2 > m.score1 AND (m.team2_p1 = p.id OR m.team2_p2 = p.id) THEN 1
          ELSE 0 END)::int AS victorias,
        COUNT(m.id)::int AS partidos
      FROM   players p
      JOIN   group_players gp ON gp.player_id = p.id AND gp.group_id = ${groupId}
      JOIN   tournaments   t  ON t.group_id = ${groupId}
      LEFT   JOIN users u ON u.id = p.user_id
      LEFT JOIN matches    m  ON m.tournament_id = t.id
        AND (m.team1_p1 = p.id OR m.team1_p2 = p.id
          OR m.team2_p1 = p.id OR m.team2_p2 = p.id)
      GROUP BY p.id, COALESCE(u.name, p.name), u.avatar_url
      ORDER BY victorias DESC
    `;

    const tournamentWinners = await sql`
      WITH pw AS (
        SELECT t.id AS tid, t.name AS tname, t.created_at,
               p.id AS pid, COALESCE(u.name, p.name) AS pname,
               SUM(CASE
                 WHEN m.score1 > m.score2 AND (m.team1_p1 = p.id OR m.team1_p2 = p.id) THEN 1
                 WHEN m.score2 > m.score1 AND (m.team2_p1 = p.id OR m.team2_p2 = p.id) THEN 1
                 ELSE 0 END) AS wins
        FROM   tournaments t
        JOIN   matches m ON m.tournament_id = t.id
        JOIN   players p ON p.id IN (m.team1_p1, m.team1_p2, m.team2_p1, m.team2_p2)
        LEFT   JOIN users u ON u.id = p.user_id
        WHERE  t.group_id = ${groupId}
        GROUP  BY t.id, t.name, t.created_at, p.id, COALESCE(u.name, p.name)
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
    const { name, description, is_public = true, emojis = [], location_name, place_id, lat, lon } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });
    if (name.trim().length > 30) return res.status(400).json({ error: 'El nombre del torneo no puede superar los 30 caracteres' });
    if (name.trim().length < 2) return res.status(400).json({ error: 'El nombre del torneo debe tener mas de 2 caracteres' });
    const sql = getDb();
    const [group] = await sql`
      INSERT INTO groups (id, name, description, user_id, is_public, emojis, location_name, place_id, lat, lon)
      VALUES (${uid()}, ${name.trim()}, ${description ?? null}, ${req.user.id}, ${is_public}, ${emojis}, ${location_name ?? null}, ${place_id ?? null}, ${lat ?? null}, ${lon ?? null})
      RETURNING *
    `;
    res.status(201).json(group);
  } catch (err) { next(err); }
});

// PUT /api/groups/:groupId — solo el dueño
router.put('/:groupId', requireAuth, async (req, res, next) => {
  try {
    const { name, description, is_public, emojis, location_name, place_id, lat, lon } = req.body;
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
          emojis = COALESCE(${emojis ?? null}, emojis),
          location_name = COALESCE(${location_name ?? null}, location_name),
          place_id = COALESCE(${place_id ?? null}, place_id),
          lat = COALESCE(${lat ?? null}, lat),
          lon = COALESCE(${lon ?? null}, lon)
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

