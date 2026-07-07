import { getDb }            from '../db.js';
import { deleteByPublicId } from './cloudinary.js';

// Cuenta "fantasma" a la que se reasigna lo que un usuario borrado no debe llevarse:
// sus grupos (con torneos, partidos, fotos, etc.) quedan bajo un dueño anónimo en vez
// de desaparecer o romper los INNER JOIN users que hacen las queries de grupos.
const ANON_ID       = 'deleted-account';
const ANON_USERNAME = 'cuenta_eliminada';
const ANON_EMAIL    = 'cuenta-eliminada@padeleando.local';
const ANON_NAME     = 'Cuenta eliminada';

// get-or-create de la cuenta anónima. Idempotente.
async function getAnonUserId(sql) {
  const [existing] = await sql`
    SELECT id FROM users WHERE id = ${ANON_ID} OR username = ${ANON_USERNAME} LIMIT 1
  `;
  if (existing) return existing.id;

  const [created] = await sql`
    INSERT INTO users (id, email, name, username, role, email_verified_at)
    VALUES (${ANON_ID}, ${ANON_EMAIL}, ${ANON_NAME}, ${ANON_USERNAME}, 'user', NOW())
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  if (created) return created.id;

  const [again] = await sql`SELECT id FROM users WHERE id = ${ANON_ID}`;
  return again.id;
}

/**
 * Borra por completo la cuenta `userId`.
 *
 * - Sus grupos (y en cascada torneos, partidos, parejas, fotos) se conservan pero
 *   pasan a manos de una cuenta anónima, igual que las invitaciones que envió y las
 *   fotos que subió (FKs sin ON DELETE que si no bloquearían el borrado).
 * - Sus slots de jugador en grupos ajenos se desvinculan solos (players.user_id → NULL),
 *   preservando el historial de partidos de los demás.
 * - Suscripciones, notificaciones, follows, join-requests, club-requests y verificaciones
 *   de email caen por ON DELETE CASCADE al borrar la fila de users.
 *
 * Devuelve `true` si borró, `false` si el usuario no existía.
 */
export async function deleteUserAccount(userId) {
  const sql    = getDb();
  const anonId = await getAnonUserId(sql);

  if (userId === anonId) throw new Error('No se puede borrar la cuenta anónima');

  const [u] = await sql`SELECT avatar_public_id FROM users WHERE id = ${userId}`;
  if (!u) return false;

  await sql.transaction([
    // Reasignar a la cuenta anónima lo que tiene FK sin cascada hacia users
    sql`UPDATE groups             SET user_id        = ${anonId} WHERE user_id        = ${userId}`,
    sql`UPDATE player_invitations SET invited_by     = ${anonId} WHERE invited_by     = ${userId}`,
    sql`UPDATE tournament_photos  SET uploaded_by    = ${anonId} WHERE uploaded_by    = ${userId}`,
    sql`UPDATE admin_broadcasts   SET admin_id       = ${anonId} WHERE admin_id       = ${userId}`,
    sql`UPDATE admin_broadcasts   SET target_user_id = ${anonId} WHERE target_user_id = ${userId}`,
    // Limpiar tokens de sesión / reset por las dudas (ON DELETE puede o no cubrirlos)
    sql`DELETE FROM refresh_tokens  WHERE user_id = ${userId}`,
    sql`DELETE FROM password_resets WHERE user_id = ${userId}`,
    // Y por fin la cuenta (dispara los ON DELETE CASCADE / SET NULL restantes)
    sql`DELETE FROM users WHERE id = ${userId}`,
  ]);

  // El avatar sí se borra de Cloudinary (no se conserva). Fuera de la transacción.
  if (u.avatar_public_id) await deleteByPublicId(u.avatar_public_id);

  return true;
}
