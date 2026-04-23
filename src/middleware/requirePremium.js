import { getDb } from '../db.js';
import { getActiveSubscription } from '../routes/subscriptions.js';

export async function requirePremium(req, res, next) {
  try {
    const sql = getDb();
    const sub = await getActiveSubscription(sql, req.user.id);
    if (sub.plan !== 'premium') {
      return res.status(403).json({ error: 'Esta función está disponible solo para usuarios Premium' });
    }
    next();
  } catch (err) {
    next(err);
  }
}
