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
        COUNT(DISTINCT gp.player_id)::int AS player_count,
        COUNT(DISTINCT t.id)::int          AS tournament_count
      FROM groups g
      LEFT JOIN group_players gp ON gp.group_id = g.id
      LEFT JOIN tournaments   t  ON t.group_id  = g.id
      WHERE g.user_id = ${req.user.id}
      GROUP BY g.id
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
        COUNT(DISTINCT all_gp.player_id)::int AS player_count,
        COUNT(DISTINCT t.id)::int              AS tournament_count
      FROM groups g
      JOIN users u ON u.id = g.user_id
      JOIN group_players user_gp ON user_gp.group_id = g.id
      JOIN players p ON p.id = user_gp.player_id AND p.user_id = ${req.user.id}
      LEFT JOIN group_players all_gp ON all_gp.group_id = g.id
      LEFT JOIN tournaments t ON t.group_id = g.id
      WHERE g.user_id != ${req.user.id}
      GROUP BY g.id, u.username, u.name
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
        COUNT(DISTINCT gp.player_id)::int AS player_count,
        COUNT(DISTINCT t.id)::int          AS tournament_count
      FROM groups g
      LEFT JOIN group_players gp ON gp.group_id = g.id
      LEFT JOIN tournaments   t  ON t.group_id  = g.id
      WHERE g.user_id = ${owner.id}
        AND (${isOwner} OR g.is_public = true)
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `;
    res.json({ owner, groups });
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
    const { name, description, is_public = true } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });
    const sql = getDb();
    const [group] = await sql`
      INSERT INTO groups (id, name, description, user_id, is_public)
      VALUES (${uid()}, ${name.trim()}, ${description ?? null}, ${req.user.id}, ${is_public})
      RETURNING *
    `;
    res.status(201).json(group);
  } catch (err) { next(err); }
});

// PUT /api/groups/:groupId — solo el dueño
router.put('/:groupId', requireAuth, async (req, res, next) => {
  try {
    const { name, description, is_public } = req.body;
    const sql = getDb();
    const [group] = await sql`SELECT user_id FROM groups WHERE id = ${req.params.groupId}`;
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    if (group.user_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });

    const [updated] = await sql`
      UPDATE groups
      SET name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          is_public = COALESCE(${is_public ?? null}, is_public)
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

