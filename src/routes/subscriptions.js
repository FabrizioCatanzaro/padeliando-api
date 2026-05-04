import { Router } from 'express';
import { getDb }   from '../db.js';
import { uid }     from '../uid.js';
import { requireAuth } from '../middleware/auth.js';
import { MercadoPagoConfig, PreApproval } from 'mercadopago';

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const MP_PLAN_IDS = {
  monthly: () => process.env.MP_PLAN_ID_MONTHLY,
  annual:  () => process.env.MP_PLAN_ID_ANNUAL,
};

const router = Router();

// Duraciones por tipo de billing
const BILLING_DURATIONS = {
  monthly:   30,
  annual:    365,
  trial:     7,
};

// ── Helper: obtener la suscripción activa de un usuario ───────────────────────
// Retorna { plan, billing_period, status, starts_at, ends_at } o plan free por defecto
export async function getActiveSubscription(sql, userId) {
  const [sub] = await sql`
    SELECT id, plan, billing_period, status, starts_at, ends_at AS plan_ends_at
    FROM subscriptions
    WHERE user_id   = ${userId}
      AND status    = 'active'
      AND (ends_at IS NULL OR ends_at > NOW())
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return sub ?? { plan: 'free', billing_period: null, status: 'active', starts_at: null, plan_ends_at: null };
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

// ── POST /api/subscriptions/checkout ─────────────────────────────────────────
// Crea un PreApproval en MP y devuelve la URL de pago (init_point).
router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const { billing_period, mp_email } = req.body;
    const planId = MP_PLAN_IDS[billing_period]?.();
    if (!planId)
      return res.status(400).json({ error: 'billing_period debe ser monthly o annual' });
    if (!mp_email)
      return res.status(400).json({ error: 'mp_email es requerido (email de tu cuenta de Mercado Pago)' });

    const sql = getDb();

    // Guardar suscripción pendiente — el mp_preapproval_id se setea en el webhook
    await sql`
      INSERT INTO subscriptions (id, user_id, plan, billing_period, status, mp_email)
      VALUES (${uid()}, ${req.user.id}, 'premium', ${billing_period}, 'pending', LOWER(${mp_email}))
    `;

    const init_point = `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${planId}`;
    res.json({ init_point });
  } catch (err) { next(err); }
});

// ── POST /api/subscriptions/webhook ──────────────────────────────────────────
// Recibe notificaciones de MP. Activa o cancela la suscripción según el estado.
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.type === 'subscription_preapproval') {
      const preapproval = await new PreApproval(mp).get({ id: body.data.id });
      const sql = getDb();

      // Determinar billing_period según el plan
      const PLAN_BILLING = {
        [process.env.MP_PLAN_ID_MONTHLY]: 'monthly',
        [process.env.MP_PLAN_ID_ANNUAL]:  'annual',
      };
      const billing_period = PLAN_BILLING[preapproval.preapproval_plan_id];

      // Buscar por mp_preapproval_id (ya vinculado) o por payer_email + pending
      let [sub] = await sql`
        SELECT id, user_id, billing_period FROM subscriptions
        WHERE mp_preapproval_id = ${preapproval.id}
      `;

      if (!sub && preapproval.payer_email) {
        [sub] = await sql`
          SELECT id, user_id, billing_period FROM subscriptions
          WHERE mp_email = LOWER(${preapproval.payer_email})
            AND status   = 'pending'
            AND (${billing_period ?? null}::text IS NULL OR billing_period = ${billing_period ?? null})
          ORDER BY created_at DESC
          LIMIT 1
        `;
        if (sub) {
          await sql`
            UPDATE subscriptions SET mp_preapproval_id = ${preapproval.id}
            WHERE id = ${sub.id}
          `;
        }
      }

      if (sub) {
        if (preapproval.status === 'authorized') {
          const PERIOD_DAYS = { monthly: 30, annual: 365 };
          const days = PERIOD_DAYS[sub.billing_period ?? billing_period] ?? 30;
          const ends_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

          await sql`
            UPDATE subscriptions
            SET status = 'expired'
            WHERE user_id = ${sub.user_id}
              AND status  = 'active'
              AND id     != ${sub.id}
          `;
          await sql`
            UPDATE subscriptions SET status = 'active', ends_at = ${ends_at}
            WHERE id = ${sub.id}
          `;
        } else if (preapproval.status === 'cancelled' || preapproval.status === 'paused') {
          await sql`
            UPDATE subscriptions SET status = 'cancelled'
            WHERE id = ${sub.id}
          `;
        }
      }
    }
  } catch (_) {
    // Nunca fallar: MP necesita siempre 200 para no reintentar
  }

  res.sendStatus(200);
});

// ── GET /api/subscriptions/sync ──────────────────────────────────────────────
// Consulta MP activamente para activar una suscripción pendiente.
// Lo llama el frontend al volver del checkout, como fallback al webhook.
router.get('/sync', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();

    const [pendingSub] = await sql`
      SELECT id, billing_period, mp_email FROM subscriptions
      WHERE user_id = ${req.user.id} AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!pendingSub) return res.json({ synced: false });

    const planIds = [
      process.env.MP_PLAN_ID_MONTHLY,
      process.env.MP_PLAN_ID_ANNUAL,
    ].filter(Boolean);

    // Buscar en MP preapprovals autorizados para este email
    const search = await new PreApproval(mp).search({
      filters: { payer_email: pendingSub.mp_email },
    });

    const authorized = search.results?.find(
      (p) => p.status === 'authorized' && planIds.includes(p.preapproval_plan_id)
    );

    if (!authorized) return res.json({ synced: false });

    const PERIOD_DAYS = { monthly: 30, annual: 365 };
    const days = PERIOD_DAYS[pendingSub.billing_period] ?? 30;
    const ends_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await sql`
      UPDATE subscriptions
      SET status = 'expired'
      WHERE user_id = ${req.user.id} AND status = 'active' AND id != ${pendingSub.id}
    `;
    await sql`
      UPDATE subscriptions
      SET status = 'active', mp_preapproval_id = ${authorized.id}, ends_at = ${ends_at}
      WHERE id = ${pendingSub.id}
    `;

    res.json({ synced: true });
  } catch (err) { next(err); }
});

// ── POST /api/subscriptions/cancel ───────────────────────────────────────────
// Cancela la suscripción activa del usuario en MP y en la DB.
router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    const sql = getDb();

    const [sub] = await sql`
      SELECT id, mp_preapproval_id FROM subscriptions
      WHERE user_id          = ${req.user.id}
        AND status           = 'active'
        AND mp_preapproval_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!sub) return res.status(404).json({ error: 'No hay suscripción activa de Mercado Pago' });

    try {
      await new PreApproval(mp).update({ id: sub.mp_preapproval_id, body: { status: 'cancelled' } });
    } catch (_) {
      // Si MP ya canceló el preapproval (ej: el usuario canceló desde su cuenta de MP),
      // ignoramos el error y actualizamos la DB de todas formas.
    }

    await sql`
      UPDATE subscriptions SET status = 'cancelled'
      WHERE id = ${sub.id}
    `;

    res.json({ message: 'Suscripción cancelada' });
  } catch (err) { next(err); }
});

export default router;
