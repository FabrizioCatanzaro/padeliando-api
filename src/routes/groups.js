import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
const router = Router();

// GET /api/groups
router.get('/', async (_req, res, next) => {
    try {
    const sql = getDb();
    const groups = await sql`
        SELECT g.*,
        COUNT(DISTINCT gp.player_id)::int AS player_count,
        COUNT(DISTINCT t.id)::int          AS tournament_count
        FROM   groups g
        LEFT JOIN group_players gp ON gp.group_id = g.id
        LEFT JOIN tournaments   t  ON t.group_id  = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC
        `;
    res.json(groups);
    } catch (err) { next(err); }
});

// POST /api/groups
router.post('/', async (req, res, next) => {
    try {
        const { name, description } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'name requerido' });
        const sql = getDb();
        const [group] = await sql`
            INSERT INTO groups (id, name, description)
            VALUES (${uid()}, ${name.trim()}, ${description ?? null})
            RETURNING *
        `;
        res.status(201).json(group);
    } catch (err) { next(err); }
});

// GET /api/groups/:groupId
router.get('/:groupId', async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const sql = getDb();

        const [group] = await sql`SELECT * FROM groups WHERE id = ${groupId}`;
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

// PUT /api/groups/:groupId
router.put('/:groupId', async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const { name, description } = req.body;
        const sql = getDb();
        const [updated] = await sql`
            UPDATE groups SET name = ${name}, description = ${description ?? null}
            WHERE id = ${groupId} RETURNING *
        `;
        if (!updated) return res.status(404).json({ error: 'Grupo no encontrado' });
        res.json(updated);
    } catch (err) { next(err); }
});

// DELETE /api/groups/:groupId
router.delete('/:groupId', async (req, res, next) => {
    try {
        const sql = getDb();
        await sql`DELETE FROM groups WHERE id = ${req.params.groupId}`;
        res.json({ ok: true });
    } catch (err) { next(err); }
});

export default router;

