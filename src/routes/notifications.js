import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/notifications — lista paginada con datos enriquecidos
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const sql    = getDb();
    const limit  = Math.min(parseInt(req.query.limit  ?? '30'), 100);
    const offset = parseInt(req.query.offset ?? '0');

    const notifications = await sql`
      SELECT
        n.id, n.type, n.read, n.created_at, n.entity_id,
        a.id         AS actor_id,
        a.name       AS actor_name,
        a.username   AS actor_username,
        a.avatar_url AS actor_avatar_url,
        EXISTS(
          SELECT 1 FROM subscriptions s
          WHERE s.user_id = a.id AND s.plan = 'premium' AND s.status = 'active'
            AND (s.ends_at IS NULL OR s.ends_at > NOW())
        ) AS actor_is_premium,
        CASE WHEN n.type = 'follow' THEN
          EXISTS(SELECT 1 FROM user_follows WHERE follower_id = ${req.user.id} AND following_id = a.id)
        ELSE false END AS is_following_back,
        pi.status  AS invitation_status,
        g.id       AS group_id,
        g.name     AS group_name,
        p.name     AS player_name
      FROM notifications n
      JOIN users a ON a.id = n.actor_id
      LEFT JOIN player_invitations pi ON n.type = 'invitation' AND pi.id = n.entity_id
      LEFT JOIN groups g ON g.id = pi.group_id
      LEFT JOIN players p ON p.id = pi.player_id
      WHERE n.user_id = ${req.user.id}
      ORDER BY n.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    res.json(notifications);
  } catch (err) { next(err); }
});

// GET /api/notifications/count — cantidad no leídas
router.get('/count', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count FROM notifications
      WHERE user_id = ${req.user.id} AND read = false
    `;
    res.json({ count });
  } catch (err) { next(err); }
});

// PATCH /api/notifications/read-all — marcar todas como leídas
router.patch('/read-all', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    await sql`UPDATE notifications SET read = true WHERE user_id = ${req.user.id} AND read = false`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// PATCH /api/notifications/:id/read — marcar una como leída
router.patch('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    await sql`
      UPDATE notifications SET read = true
      WHERE id = ${req.params.id} AND user_id = ${req.user.id}
    `;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
