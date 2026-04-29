import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/invitations
// El dueño del grupo invita a un usuario registrado a reclamar un slot de jugador.
// Body: { playerId, groupId, identifier }  — identifier es @username o email
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { playerId, groupId, identifier } = req.body;
    if (!playerId)    return res.status(400).json({ error: 'playerId requerido' });
    if (!groupId)     return res.status(400).json({ error: 'groupId requerido' });
    if (!identifier?.trim()) return res.status(400).json({ error: 'identifier requerido' });

    const sql = getDb();

    // Verificar que el jugador existe en el grupo
    const [gp] = await sql`
      SELECT * FROM group_players WHERE group_id = ${groupId} AND player_id = ${playerId}
    `;
    if (!gp) return res.status(404).json({ error: 'Jugador no encontrado en este grupo' });

    // Verificar que el jugador no tiene ya un user_id vinculado
    const [player] = await sql`SELECT * FROM players WHERE id = ${playerId}`;
    if (player?.user_id) {
      return res.status(409).json({ error: 'Este jugador ya está vinculado a una cuenta' });
    }

    // Buscar al usuario invitado por @username o email
    const raw = identifier.trim();
    const isUsername = raw.startsWith('@');
    const lookup = isUsername ? raw.slice(1) : raw;

    let [invitedUser] = isUsername
      ? await sql`SELECT id, name, username FROM users WHERE username = ${lookup}`
      : await sql`SELECT id, name, username FROM users WHERE email   = ${lookup}`;

    // No revelar si el usuario existe o no por seguridad — simplemente guardamos la invitación
    // Si no existe, invited_user_id queda NULL y el usuario podrá reclamarla al registrarse (futuro)

    // Verificar que no hay invitación pendiente duplicada
    const [existing] = await sql`
      SELECT id FROM player_invitations
      WHERE player_id = ${playerId} AND status = 'pending'
    `;
    if (existing) {
      return res.status(409).json({ error: 'Ya hay una invitación pendiente para este jugador' });
    }

    const [invitation] = await sql`
      INSERT INTO player_invitations
        (id, player_id, group_id, invited_by, invited_identifier, invited_user_id)
      VALUES
        (${uid()}, ${playerId}, ${groupId}, ${req.user.id}, ${raw}, ${invitedUser?.id ?? null})
      RETURNING *
    `;

    // Notificar al usuario invitado si fue encontrado
    if (invitedUser?.id) {
      await sql`
        INSERT INTO notifications (id, user_id, type, actor_id, entity_id)
        VALUES (${uid()}, ${invitedUser.id}, 'invitation', ${req.user.id}, ${invitation.id})
      `;
    }

    res.status(201).json({ invitation, found: !!invitedUser });
  } catch (err) { next(err); }
});

// GET /api/invitations — invitaciones pendientes del usuario autenticado
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const invitations = await sql`
      SELECT
        pi.id,
        pi.status,
        pi.invited_identifier,
        pi.created_at,
        p.id   AS player_id,
        p.name AS player_name,
        g.id   AS group_id,
        g.name AS group_name,
        u.name AS invited_by_name,
        u.username AS invited_by_username
      FROM player_invitations pi
      JOIN players p ON p.id = pi.player_id
      JOIN groups  g ON g.id = pi.group_id
      JOIN users   u ON u.id = pi.invited_by
      WHERE pi.invited_user_id = ${req.user.id}
        AND pi.status = 'pending'
      ORDER BY pi.created_at DESC
    `;
    res.json(invitations);
  } catch (err) { next(err); }
});

// GET /api/invitations/count — cantidad de invitaciones pendientes (para el badge del header)
router.get('/count', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count
      FROM player_invitations
      WHERE invited_user_id = ${req.user.id} AND status = 'pending'
    `;
    res.json({ count });
  } catch (err) { next(err); }
});

// PATCH /api/invitations/:id — aceptar o rechazar
// Body: { action: 'accept' | 'reject' }
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action debe ser accept o reject' });
    }

    const sql = getDb();

    // Verificar que la invitación pertenece al usuario
    const [invitation] = await sql`
      SELECT * FROM player_invitations WHERE id = ${id}
    `;
    if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada' });
    if (invitation.invited_user_id !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    if (invitation.status !== 'pending') {
      return res.status(409).json({ error: 'La invitación ya fue procesada' });
    }

    if (action === 'accept') {
      await sql`
        UPDATE players SET user_id = ${req.user.id}, name = ${req.user.name}
        WHERE id = ${invitation.player_id}
      `;
    }

    const [updated] = await sql`
      UPDATE player_invitations
      SET status = ${action === 'accept' ? 'accepted' : 'rejected'}
      WHERE id = ${id}
      RETURNING *
    `;

    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /api/invitations/:id — cancelar invitación (solo el que la envió)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const [invitation] = await sql`SELECT * FROM player_invitations WHERE id = ${req.params.id}`;
    if (!invitation) return res.status(404).json({ error: 'Invitación no encontrada' });
    if (invitation.invited_by !== req.user.id) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    await sql`DELETE FROM player_invitations WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
