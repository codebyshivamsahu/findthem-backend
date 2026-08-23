// src/routes/statistics.ts
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createAlertSchema } from '../schemas';
import { asyncHandler } from '../utils/errors';

const router = Router();

// GET /api/statistics — aggregates only, no personal data, safe to be public
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const total = (await getOne('SELECT COUNT(*)::int AS count FROM missing_persons'))?.count || 0;
  const open = (await getOne(
    `SELECT COUNT(*)::int AS count FROM missing_persons WHERE status IN ('open','investigating','sighting_reported')`
  ))?.count || 0;
  const found = (await getOne(
    `SELECT COUNT(*)::int AS count FROM missing_persons WHERE status = 'found'`
  ))?.count || 0;

  const avgRow = await getOne(`
    SELECT AVG(EXTRACT(EPOCH FROM (updated_at - reported_at)) / 86400) AS avg_days
    FROM missing_persons WHERE status = 'found'
  `);
  const avgDays = avgRow?.avg_days ? Math.round(Number(avgRow.avg_days) * 10) / 10 : 0;

  const todaySightings = (await getOne(
    `SELECT COUNT(*)::int AS count FROM sightings WHERE reported_at >= CURRENT_DATE`
  ))?.count || 0;

  const stateData = await getAll(`
    SELECT state, COUNT(*)::int AS cases,
      SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END)::int AS resolved
    FROM missing_persons GROUP BY state ORDER BY cases DESC LIMIT 10
  `);

  const monthlyData = (await getAll(`
    SELECT TO_CHAR(reported_at, 'Mon') AS month,
      TO_CHAR(reported_at, 'YYYY-MM') AS ym,
      COUNT(*)::int AS filed,
      SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END)::int AS resolved
    FROM missing_persons
    GROUP BY ym, TO_CHAR(reported_at, 'Mon')
    ORDER BY ym DESC LIMIT 6
  `)).reverse();

  const genderData = await getAll(`SELECT gender, COUNT(*)::int AS count FROM missing_persons GROUP BY gender`);
  const statusData = await getAll(`SELECT status, COUNT(*)::int AS count FROM missing_persons GROUP BY status`);

  res.json({
    success: true,
    data: {
      totalCases: total,
      openCases: open,
      resolvedCases: found,
      avgResolutionDays: avgDays,
      sightingsToday: todaySightings,
      stateData, monthlyData, genderData, statusData,
    },
  });
}));

// GET /api/statistics/alerts — public broadcast messages
router.get('/alerts', asyncHandler(async (_req: Request, res: Response) => {
  const alerts = await getAll(
    `SELECT id, type, title, message, case_id, severity, created_at
     FROM alerts WHERE is_active = 1 ORDER BY created_at DESC LIMIT 50`
  );
  res.json({ success: true, data: alerts });
}));

// POST /api/statistics/alerts — police / admin only (these go out platform-wide)
router.post('/alerts', authenticateToken, requireRole('police', 'admin'), validateBody(createAlertSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { type, title, message, caseId, severity } = req.body;
  const id = uuidv4();
  await runQuery(
    `INSERT INTO alerts (id, type, title, message, case_id, severity, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, type, title, message, caseId || null, severity, req.user!.id]
  );
  const alert = await getOne('SELECT * FROM alerts WHERE id = $1', [id]);
  res.status(201).json({ success: true, data: alert });
}));

// DELETE /api/statistics/alerts/:id — police / admin only
router.delete('/alerts/:id', authenticateToken, requireRole('police', 'admin'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await getOne('SELECT id FROM alerts WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Alert not found' });
  await runQuery('UPDATE alerts SET is_active = 0 WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Alert dismissed' });
}));

export default router;
