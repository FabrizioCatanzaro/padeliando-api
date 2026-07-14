// Helpers de autorización sobre categorías (groups).
// La autoridad deriva de groups.user_id (dueño) ∪ group_collaborators (co-organizadores).

// ¿El usuario puede gestionar las jornadas de esta categoría? (dueño o co-organizador)
// Devuelve true/false, o null si la categoría no existe.
export async function canManageGroup(sql, userId, groupId) {
  if (!userId || !groupId) return false;
  const [g] = await sql`SELECT user_id FROM groups WHERE id = ${groupId}`;
  if (!g) return null;
  if (g.user_id === userId) return true;
  const [c] = await sql`
    SELECT 1 FROM group_collaborators WHERE group_id = ${groupId} AND user_id = ${userId}
  `;
  return !!c;
}

// ¿El usuario es el dueño de la categoría? (acciones exclusivas: editar/borrar categoría,
// transferir propiedad, gestionar co-organizadores). null si no existe.
export async function isGroupOwner(sql, userId, groupId) {
  if (!userId || !groupId) return false;
  const [g] = await sql`SELECT user_id FROM groups WHERE id = ${groupId}`;
  if (!g) return null;
  return g.user_id === userId;
}
