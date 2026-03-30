import { Router } from 'express';
import { getDb }   from '../db.js';
import { uid }     from '../uid.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Duraciones por tipo de billing
const BILLING_DURATIONS = {
  monthly:   30,
  quarterly: 90,
  annual:    365,
  trial:     14,
};

// ── Helper: obtener la suscripción activa de un usuario ───────────────────────
// Retorna { plan, billing_period, status, starts_at, ends_at } o plan free por defecto
export async function getActiveSubscription(sql, userId) {
  const [sub] = await sql`
    SELECT id, plan, billing_period, status, starts_at, ends_at
    FROM subscriptions
    WHERE user_id   = ${userId}
      AND status    = 'active'
      AND (ends_at IS NULL OR ends_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return sub ?? { plan: 'free', billing_period: null, status: 'active', starts_at: null, ends_at: null };
}

// ── GET /api/subscriptions/me ─────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();
    const subscription = await getActiveSubscription(sql, req.user.id);
    res.json(subscription);
  } catch (err) { next(err); }
});

// ── POST /api/subscriptions/grant ────────────────────────────────────────────
// Endpoint admin: otorga un plan premium o período de prueba a un usuario.
// Requiere header x-admin-secret igual a la variable de entorno ADMIN_SECRET.
router.post('/grant', async (req, res, next) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret)
      return res.status(403).json({ error: 'No autorizado' });

    const { user_id, plan, billing_period } = req.body;

    if (!user_id)
      return res.status(400).json({ error: 'user_id es requerido' });

    if (!['free', 'premium'].includes(plan))
      return res.status(400).json({ error: 'plan debe ser "free" o "premium"' });

    // Para premium se requiere billing_period; para free no aplica
    if (plan === 'premium' && !BILLING_DURATIONS[billing_period])
      return res.status(400).json({ error: 'billing_period debe ser monthly, quarterly, annual o trial' });

    const sql = getDb();

    const [user] = await sql`SELECT id FROM users WHERE id = ${user_id}`;
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Expirar la suscripción activa anterior
    await sql`
      UPDATE subscriptions
      SET status = 'expired'
      WHERE user_id = ${user_id} AND status = 'active'
    `;

    const days     = plan === 'free' ? null : BILLING_DURATIONS[billing_period];
    const ends_at  = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
    const bp       = plan === 'free' ? null : billing_period;

    const [created] = await sql`
      INSERT INTO subscriptions (id, user_id, plan, billing_period, status, ends_at)
      VALUES (${uid()}, ${user_id}, ${plan}, ${bp}, 'active', ${ends_at})
      RETURNING id, plan, billing_period, status, starts_at, ends_at
    `;

    res.status(201).json(created);
  } catch (err) { next(err); }
});

export default router;
