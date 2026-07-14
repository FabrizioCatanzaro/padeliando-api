// Middlewares de autorización sobre categorías. Requieren que req.user ya esté
// poblado (encadenar después de requireAuth). Devuelven 403 si no hay permiso,
// 404 si el recurso no existe.
import { getDb } from '../db.js';
import { canManageGroup } from '../lib/access.js';

// Construye un guard a partir de un resolver que devuelve el groupId asociado al request.
function makeManageGuard(resolveGroupId) {
  return async (req, res, next) => {
    try {
      if (!req.user?.id) return res.status(401).json({ error: 'No autenticado' });
      const sql = getDb();
      const groupId = await resolveGroupId(req, sql);
      if (!groupId) return res.status(404).json({ error: 'Recurso no encontrado' });
      const ok = await canManageGroup(sql, req.user.id, groupId);
      if (ok === null) return res.status(404).json({ error: 'Categoría no encontrada' });
      if (!ok) return res.status(403).json({ error: 'Sin permiso' });
      next();
    } catch (err) { next(err); }
  };
}

// groupId viene por params (:groupId) o body.groupId.
export const requireGroupManage = makeManageGuard(
  (req) => req.params.groupId ?? req.body?.groupId ?? null
);

// Resuelve la categoría desde un torneo (:id / :tournamentId / body.tournamentId).
export const requireTournamentManage = makeManageGuard(async (req, sql) => {
  const tId = req.params.id ?? req.params.tournamentId ?? req.body?.tournamentId;
  if (!tId) return null;
  const [t] = await sql`SELECT group_id FROM tournaments WHERE id = ${tId}`;
  return t?.group_id ?? null;
});

// Resuelve la categoría desde un partido (:id).
export const requireMatchManage = makeManageGuard(async (req, sql) => {
  const [row] = await sql`
    SELECT t.group_id
    FROM matches m JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.id = ${req.params.id}
  `;
  return row?.group_id ?? null;
});

// Resuelve la categoría desde una pareja (:id).
export const requirePairManage = makeManageGuard(async (req, sql) => {
  const [row] = await sql`
    SELECT t.group_id
    FROM pairs p JOIN tournaments t ON t.id = p.tournament_id
    WHERE p.id = ${req.params.id}
  `;
  return row?.group_id ?? null;
});
