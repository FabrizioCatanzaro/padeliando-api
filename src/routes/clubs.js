import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { uploadClubPhoto }           from '../middleware/upload.js';
import { uploadBuffer, deleteByPublicId } from '../lib/cloudinary.js';

const router = Router();

// Normaliza los campos editables de un club desde el body (alta o solicitud).
function clubFields(body = {}) {
  const social = Array.isArray(body.social_links) ? body.social_links : [];
  const schedule = Array.isArray(body.schedule) ? body.schedule : [];
  const courts = body.courts == null || body.courts === ''
    ? null
    : Math.max(0, parseInt(body.courts, 10) || 0);
  return {
    social_links:     social,
    schedule,
    contact_phone:    body.contact_phone?.trim()    || null,
    contact_whatsapp: body.contact_whatsapp?.trim() || null,
    location_name:    body.location_name?.trim()    || null,
    lat:              body.lat ?? null,
    lon:              body.lon ?? null,
    courts,
  };
}

// ── GET /api/clubs ───────────────────────────────────────────────────────────
// Listado/búsqueda público. Query params: q (string), limit (default 50, máx 100)
router.get('/', async (req, res, next) => {
  try {
    const sql   = getDb();
    const q     = (req.query.q ?? '').trim();
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
    const pat   = q ? `%${q}%` : null;

    const clubs = await sql`
      SELECT id, name, photo_url, social_links, contact_phone, contact_whatsapp,
      location_name, lat, lon, courts, schedule, created_at
      FROM clubs
      WHERE ${pat}::text IS NULL OR name ILIKE ${pat} OR location_name ILIKE ${pat}
      ORDER BY name ASC
      LIMIT ${limit}
    `;
    res.json(clubs);
  } catch (err) { next(err); }
});

// ── GET /api/clubs/requests ──────────────────────────────────────────────────
// Solicitudes de alta de club (solo admin). Query param: status (default 'pending')
router.get('/requests', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sql    = getDb();
    const status = req.query.status ?? 'pending';
    const rows = await sql`
      SELECT
        r.id, r.name, r.proposed_data, r.status, r.created_at, r.reviewed_at,
        r.created_club_id,
        u.id AS requester_id, u.name AS requester_name, u.username AS requester_username,
        u.avatar_url AS requester_avatar_url
      FROM club_requests r
      JOIN users u ON u.id = r.requested_by
      WHERE ${status} = 'all' OR r.status = ${status}
      ORDER BY r.created_at DESC
    `;
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/clubs/requests ─────────────────────────────────────────────────
// Un usuario logueado solicita el alta de un club que no encuentra.
router.post('/requests', requireAuth, async (req, res, next) => {
  try {
    const name = req.body?.name?.trim();
    if (!name)             return res.status(400).json({ error: 'El nombre del club es requerido' });
    if (name.length < 2)   return res.status(400).json({ error: 'El nombre del club debe tener más de 2 caracteres' });
    if (name.length > 80)  return res.status(400).json({ error: 'El nombre del club no puede superar los 80 caracteres' });

    const sql = getDb();
    const proposed = clubFields(req.body);
    const [request] = await sql`
      INSERT INTO club_requests (id, requested_by, name, proposed_data)
      VALUES (${uid()}, ${req.user.id}, ${name}, ${JSON.stringify(proposed)}::jsonb)
      RETURNING id, name, proposed_data, status, created_at
    `;
    res.status(201).json(request);
  } catch (err) { next(err); }
});

// ── PATCH /api/clubs/requests/:id ────────────────────────────────────────────
// Admin aprueba (crea el club precargado) o rechaza una solicitud.
// Body: { action: 'approve' | 'reject' }
router.patch('/requests/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sql    = getDb();
    const action = req.body?.action;
    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ error: "action debe ser 'approve' o 'reject'" });

    const [request] = await sql`SELECT * FROM club_requests WHERE id = ${req.params.id}`;
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (request.status !== 'pending')
      return res.status(400).json({ error: 'La solicitud ya fue procesada' });

    if (action === 'reject') {
      const [updated] = await sql`
        UPDATE club_requests
        SET status = 'rejected', reviewed_by = ${req.user.id}, reviewed_at = NOW()
        WHERE id = ${request.id}
        RETURNING id, status
      `;
      return res.json(updated);
    }

    // approve → crear el club a partir de los datos propuestos
    const f = clubFields(request.proposed_data ?? {});
    const [club] = await sql`
      INSERT INTO clubs (
        id, name, social_links, contact_phone, contact_whatsapp,
        location_name, lat, lon, courts, schedule
      ) VALUES (
        ${uid()}, ${request.name},
        ${JSON.stringify(f.social_links)}::jsonb, ${f.contact_phone}, ${f.contact_whatsapp},
        ${f.location_name}, ${f.lat}, ${f.lon}, ${f.courts}, ${JSON.stringify(f.schedule)}::jsonb
      )
      RETURNING id, name, photo_url, social_links, contact_phone, contact_whatsapp,
      location_name, lat, lon, courts, schedule, created_at
    `;
    await sql`
      UPDATE club_requests
      SET status = 'approved', reviewed_by = ${req.user.id}, reviewed_at = NOW(),
          created_club_id = ${club.id}
      WHERE id = ${request.id}
    `;
    res.json({ status: 'approved', club });
  } catch (err) { next(err); }
});

// ── GET /api/clubs/:id ───────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const sql = getDb();
    const [club] = await sql`
      SELECT id, name, photo_url, social_links, contact_phone, contact_whatsapp,
      location_name, lat, lon, courts, schedule, created_at FROM clubs WHERE id = ${req.params.id}
    `;
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });
    res.json(club);
  } catch (err) { next(err); }
});

// ── GET /api/clubs/:id/events ────────────────────────────────────────────────
// Torneos jugados en el club (solo de categorías públicas), agrupados por estado.
router.get('/:id/events', async (req, res, next) => {
  try {
    const sql = getDb();
    const [club] = await sql`SELECT id FROM clubs WHERE id = ${req.params.id}`;
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    const rows = await sql`
      SELECT
        t.id, t.name, t.format, t.mode, t.status, t.event_date, t.created_at,
        g.id AS group_id, g.name AS group_name,
        u.username AS owner_username, u.name AS owner_name, u.avatar_url AS owner_avatar_url,
        (SELECT COUNT(*)::int FROM tournament_players tp WHERE tp.tournament_id = t.id) AS players_count,
        (SELECT COUNT(*)::int FROM matches m WHERE m.tournament_id = t.id) AS match_count
      FROM tournaments t
      JOIN groups g ON g.id = t.group_id
      LEFT JOIN users u ON u.id = g.user_id
      WHERE t.club_id = ${req.params.id} AND g.is_public = true
      ORDER BY COALESCE(t.event_date, t.created_at::date) DESC
    `;

    const toISODate = (v) =>
      !v ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const events = { upcoming: [], ongoing: [], past: [] };
    for (const t of rows) {
      const ed = toISODate(t.event_date);
      if (t.status === 'finished') events.past.push(t);
      else if (ed && ed > today && (t.match_count ?? 0) === 0) events.upcoming.push(t);
      else events.ongoing.push(t);
    }
    // upcoming en orden cronológico ascendente (lo más próximo primero)
    events.upcoming.reverse();
    res.json(events);
  } catch (err) { next(err); }
});

// ── POST /api/clubs ──────────────────────────────────────────────────────────
// Alta de club (solo admin). La foto se sube aparte en POST /:id/photo.
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const name = req.body?.name?.trim();
    if (!name)            return res.status(400).json({ error: 'El nombre del club es requerido' });
    if (name.length < 2)  return res.status(400).json({ error: 'El nombre del club debe tener más de 2 caracteres' });
    if (name.length > 80) return res.status(400).json({ error: 'El nombre del club no puede superar los 80 caracteres' });

    const sql = getDb();
    const f = clubFields(req.body);
    const [club] = await sql`
      INSERT INTO clubs (
        id, name, social_links, contact_phone, contact_whatsapp,
        location_name, lat, lon, courts, schedule
      ) VALUES (
        ${uid()}, ${name},
        ${JSON.stringify(f.social_links)}::jsonb, ${f.contact_phone}, ${f.contact_whatsapp},
        ${f.location_name}, ${f.lat}, ${f.lon}, ${f.courts}, ${JSON.stringify(f.schedule)}::jsonb
      )
      RETURNING id, name, photo_url, social_links, contact_phone, contact_whatsapp,
      location_name, lat, lon, courts, schedule, created_at
    `;
    res.status(201).json(club);
  } catch (err) { next(err); }
});

// ── PUT /api/clubs/:id ───────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sql = getDb();
    const [exists] = await sql`SELECT id FROM clubs WHERE id = ${req.params.id}`;
    if (!exists) return res.status(404).json({ error: 'Club no encontrado' });

    const name = req.body?.name?.trim();
    if (name !== undefined) {
      if (name.length < 2)  return res.status(400).json({ error: 'El nombre del club debe tener más de 2 caracteres' });
      if (name.length > 80) return res.status(400).json({ error: 'El nombre del club no puede superar los 80 caracteres' });
    }

    const f = clubFields(req.body);
    const [club] = await sql`
      UPDATE clubs SET
        name             = COALESCE(${name ?? null}, name),
        social_links     = ${JSON.stringify(f.social_links)}::jsonb,
        schedule         = ${JSON.stringify(f.schedule)}::jsonb,
        contact_phone    = ${f.contact_phone},
        contact_whatsapp = ${f.contact_whatsapp},
        location_name    = ${f.location_name},
        lat              = ${f.lat},
        lon              = ${f.lon},
        courts           = ${f.courts}
      WHERE id = ${req.params.id}
      RETURNING id, name, photo_url, social_links, contact_phone, contact_whatsapp,
      location_name, lat, lon, courts, schedule, created_at
    `;
    res.json(club);
  } catch (err) { next(err); }
});

// ── POST /api/clubs/:id/photo ────────────────────────────────────────────────
router.post('/:id/photo', requireAuth, requireAdmin, uploadClubPhoto, async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se envió imagen' });
    const sql = getDb();
    const [club] = await sql`SELECT id, photo_public_id FROM clubs WHERE id = ${req.params.id}`;
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    const result = await uploadBuffer(req.file.buffer, { folder: `padeliando/clubs/${club.id}` });
    if (club.photo_public_id) await deleteByPublicId(club.photo_public_id);

    const [updated] = await sql`
      UPDATE clubs SET photo_url = ${result.secure_url}, photo_public_id = ${result.public_id}
      WHERE id = ${club.id}
      RETURNING id, name, photo_url, social_links, contact_phone, contact_whatsapp,
      location_name, lat, lon, courts, schedule, created_at
    `;
    res.json(updated);
  } catch (err) { next(err); }
});

// ── DELETE /api/clubs/:id/photo ──────────────────────────────────────────────
router.delete('/:id/photo', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sql = getDb();
    const [club] = await sql`SELECT id, photo_public_id FROM clubs WHERE id = ${req.params.id}`;
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    if (club.photo_public_id) await deleteByPublicId(club.photo_public_id);
    const [updated] = await sql`
      UPDATE clubs SET photo_url = NULL, photo_public_id = NULL
      WHERE id = ${club.id}
      RETURNING id, name, photo_url, social_links, contact_phone, contact_whatsapp,
      location_name, lat, lon, courts, schedule, created_at
    `;
    res.json(updated);
  } catch (err) { next(err); }
});

// ── DELETE /api/clubs/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const sql = getDb();
    const [club] = await sql`SELECT id, photo_public_id FROM clubs WHERE id = ${req.params.id}`;
    if (!club) return res.status(404).json({ error: 'Club no encontrado' });

    if (club.photo_public_id) await deleteByPublicId(club.photo_public_id);
    await sql`DELETE FROM clubs WHERE id = ${club.id}`;   // tournaments.club_id → SET NULL
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
