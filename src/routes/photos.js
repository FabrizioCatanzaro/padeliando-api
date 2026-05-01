import { Router } from 'express';
import { getDb } from '../db.js';
import { uid }   from '../uid.js';
import { requireAuth }              from '../middleware/auth.js';
import { requirePremium }           from '../middleware/requirePremium.js';
import { uploadTournamentPhoto }    from '../middleware/upload.js';
import { uploadBuffer, deleteByPublicId } from '../lib/cloudinary.js';

const router = Router({ mergeParams: true });

const MAX_PHOTOS_PER_TOURNAMENT = 12;

async function getTournamentOwnership(sql, tournamentId) {
  const [row] = await sql`
    SELECT g.user_id FROM tournaments t
    JOIN   groups g ON g.id = t.group_id
    WHERE  t.id = ${tournamentId}
  `;
  return row;
}

// GET /api/tournaments/:tournamentId/photos — público (cualquiera puede ver)
router.get('/', async (req, res, next) => {
  try {
    const sql = getDb();
    const photos = await sql`
      SELECT id, tournament_id, uploaded_by, url, caption, created_at, is_cover
      FROM   tournament_photos
      WHERE  tournament_id = ${req.params.tournamentId}
      ORDER  BY is_cover DESC, created_at DESC
    `;
    res.json(photos);
  } catch (err) { next(err); }
});

// POST /api/tournaments/:tournamentId/photos — solo dueño del grupo + premium
router.post('/', requireAuth, requirePremium, uploadTournamentPhoto, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se envió imagen' });
    const { tournamentId } = req.params;
    const sql = getDb();

    const owner = await getTournamentOwnership(sql, tournamentId);
    if (!owner) return res.status(404).json({ error: 'Torneo no encontrado' });
    if (owner.user_id !== req.user.id)
      return res.status(403).json({ error: 'Sin permiso' });

    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count
      FROM   tournament_photos
      WHERE  tournament_id = ${tournamentId}
    `;
    if (count >= MAX_PHOTOS_PER_TOURNAMENT) {
      return res.status(400).json({
        error: `Límite de ${MAX_PHOTOS_PER_TOURNAMENT} fotos por jornada alcanzado`,
      });
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: `padeliando/tournaments/${tournamentId}`,
    });

    const caption = req.body?.caption?.trim() || null;

    const [photo] = await sql`
      INSERT INTO tournament_photos (id, tournament_id, uploaded_by, url, public_id, caption)
      VALUES (${uid()}, ${tournamentId}, ${req.user.id}, ${result.secure_url}, ${result.public_id}, ${caption})
      RETURNING id, tournament_id, uploaded_by, url, caption, created_at, is_cover
    `;

    res.status(201).json(photo);
  } catch (err) { next(err); }
});

// PATCH /api/tournaments/:tournamentId/photos/:photoId — editar caption (solo dueño)
router.patch('/:photoId', requireAuth, async (req, res, next) => {
  try {
    const { tournamentId, photoId } = req.params;
    const sql = getDb();

    const [photo] = await sql`
      SELECT p.id, g.user_id AS group_owner_id
      FROM   tournament_photos p
      JOIN   tournaments t ON t.id = p.tournament_id
      JOIN   groups      g ON g.id = t.group_id
      WHERE  p.id = ${photoId} AND p.tournament_id = ${tournamentId}
    `;
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
    if (photo.group_owner_id !== req.user.id)
      return res.status(403).json({ error: 'Sin permiso' });

    const raw = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
    const newCaption = raw.length > 0 ? raw.slice(0, 200) : null;

    const [updated] = await sql`
      UPDATE tournament_photos
      SET    caption = ${newCaption}
      WHERE  id = ${photoId}
      RETURNING id, tournament_id, uploaded_by, url, caption, created_at, is_cover
    `;
    res.json(updated);
  } catch (err) { next(err); }
});

// PATCH /api/tournaments/:tournamentId/photos/:photoId/cover — establecer portada (solo dueño)
router.patch('/:photoId/cover', requireAuth, async (req, res, next) => {
  try {
    const { tournamentId, photoId } = req.params;
    const sql = getDb();

    const [photo] = await sql`
      SELECT p.id, g.user_id AS group_owner_id
      FROM   tournament_photos p
      JOIN   tournaments t ON t.id = p.tournament_id
      JOIN   groups      g ON g.id = t.group_id
      WHERE  p.id = ${photoId} AND p.tournament_id = ${tournamentId}
    `;
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
    if (photo.group_owner_id !== req.user.id)
      return res.status(403).json({ error: 'Sin permiso' });

    await sql`
      UPDATE tournament_photos
      SET    is_cover = (id = ${photoId})
      WHERE  tournament_id = ${tournamentId}
    `;

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/tournaments/:tournamentId/photos/:photoId — solo dueño del grupo
router.delete('/:photoId', requireAuth, async (req, res, next) => {
  try {
    const { tournamentId, photoId } = req.params;
    const sql = getDb();

    const [photo] = await sql`
      SELECT p.id, p.public_id, g.user_id AS group_owner_id
      FROM   tournament_photos p
      JOIN   tournaments t ON t.id = p.tournament_id
      JOIN   groups      g ON g.id = t.group_id
      WHERE  p.id = ${photoId} AND p.tournament_id = ${tournamentId}
    `;
    if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
    if (photo.group_owner_id !== req.user.id)
      return res.status(403).json({ error: 'Sin permiso' });

    await deleteByPublicId(photo.public_id);
    await sql`DELETE FROM tournament_photos WHERE id = ${photoId}`;

    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
