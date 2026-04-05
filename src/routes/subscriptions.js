import { Router } from 'express';
import { getDb }   from '../db.js';
import { uid }     from '../uid.js';
import { requireAuth } from '../middleware/auth.js';
import { MercadoPagoConfig, PreApproval } from 'mercadopago';

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const MP_PLANS = {
  monthly:   { frequency: 1,  frequency_type: 'months', price: () => Number(process.env.MP_PRICE_MONTHLY),   reason: 'Padeleando Premium - Plan Mensual' },
  quarterly: { frequency: 3,  frequency_type: 'months', price: () => Number(process.env.MP_PRICE_QUARTERLY), reason: 'Padeleando Premium - Plan Trimestral' },
  annual:    { frequency: 12, frequency_type: 'months', price: () => Number(process.env.MP_PRICE_ANNUAL),    reason: 'Padeleando Premium - Plan Anual' },
};

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

// ── POST /api/subscriptions/checkout ─────────────────────────────────────────
// Crea un PreApproval en MP y devuelve la URL de pago (init_point).
router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const { billing_period } = req.body;
    const plan = MP_PLANS[billing_period];
    if (!plan)
      return res.status(400).json({ error: 'billing_period debe ser monthly, quarterly o annual' });
    
    const sql = getDb();
    
    // Obtener el email del usuario (puede no venir en req.user)
    const [user] = await sql`SELECT email FROM users WHERE id = ${req.user.id}`;
    console.log(req.user);
    
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const preapproval = await new PreApproval(mp).create({
      body: {
        back_url: process.env.BACK_URL,
        reason: plan.reason,
        auto_recurring: {
          frequency:          plan.frequency,
          frequency_type:     plan.frequency_type,
          transaction_amount: plan.price(),
          currency_id:        'ARS',
        },
        payer_email: user.email,
        status:      'pending',
      },
    });

    await sql`
      INSERT INTO subscriptions (id, user_id, plan, billing_period, status, mp_preapproval_id)
      VALUES (${uid()}, ${req.user.id}, 'premium', ${billing_period}, 'pending', ${preapproval.id})
    `;

    res.json({ init_point: preapproval.init_point });
  } catch (err) { next(err); }
});

// ── POST /api/subscriptions/webhook ──────────────────────────────────────────
// Recibe notificaciones de MP. Activa o cancela la suscripción según el estado.
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    console.log("body webhook",body);
    

    if (body.type === 'subscription_preapproval') {
      const preapproval = await new PreApproval(mp).get({ id: body.data.id });
      const sql = getDb();

      const [sub] = await sql`
        SELECT id, user_id FROM subscriptions
        WHERE mp_preapproval_id = ${preapproval.id}
      `;

      if (sub) {
        if (preapproval.status === 'authorized') {
          // Expirar otras suscripciones activas del usuario
          await sql`
            UPDATE subscriptions
            SET status = 'expired'
            WHERE user_id = ${sub.user_id}
              AND status  = 'active'
              AND id     != ${sub.id}
          `;
          await sql`
            UPDATE subscriptions SET status = 'active'
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

    await new PreApproval(mp).update({ id: sub.mp_preapproval_id, body: { status: 'cancelled' } });

    await sql`
      UPDATE subscriptions SET status = 'cancelled'
      WHERE id = ${sub.id}
    `;

    res.json({ message: 'Suscripción cancelada' });
  } catch (err) { next(err); }
});

export default router;
