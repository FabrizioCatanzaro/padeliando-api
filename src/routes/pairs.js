import { Router } from 'express';
import { getDb }  from '../db.js';
import { uid }    from '../uid.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTournamentManage, requirePairManage } from '../middleware/access.js';

const router = Router();

// POST /api/pairs
router.post('/', requireAuth, requireTournamentManage, async (req, res, next) => {
  try {
    const { tournamentId, p1Id, p2Id } = req.body;
    if (!tournamentId || !p1Id || !p2Id) {
      return res.status(400).json({ error: 'tournamentId, p1Id y p2Id son requeridos' });
    }
    const sql = getDb();
    const [pair] = await sql`
      INSERT INTO pairs (id, tournament_id, p1_id, p2_id)
      VALUES (${uid()}, ${tournamentId}, ${p1Id}, ${p2Id}) RETURNING *
    `;
    res.status(201).json(pair);
  } catch (err) { next(err); }
});
 
// PUT /api/pairs/:id
router.put('/:id', requireAuth, requirePairManage, async (req, res, next) => {
  try {
    const { p1Id, p2Id } = req.body;
    const sql = getDb();
    const [pair] = await sql`
      UPDATE pairs SET p1_id = ${p1Id}, p2_id = ${p2Id}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!pair) return res.status(404).json({ error: 'Pareja no encontrada' });
    res.json(pair);
  } catch (err) { next(err); }
});
 
// DELETE /api/pairs/:id
router.delete('/:id', requireAuth, requirePairManage, async (req, res, next) => {
  try {
    const sql = getDb();
    await sql`DELETE FROM pairs WHERE id = ${req.params.id}`;
    res.json({ ok: true });
  } catch (err) { next(err); }
});
 
export default router;
