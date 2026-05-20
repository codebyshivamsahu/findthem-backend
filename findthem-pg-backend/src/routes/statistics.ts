import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/statistics
router.get('/', async (req: Request, res: Response) => {
  try {
    const total = (await getOne('SELECT COUNT(*) as count FROM missing_persons'))?.count || 0;
    const open = (await getOne(`SELECT COUNT(*) as count FROM missing_persons WHERE status IN ('open', 'investigating', 'sighting_reported')`))?.count || 0;
    const found = (await getOne(`SELECT COUNT(*) as count FROM missing_persons WHERE status = 'found'`))?.count || 0;

    const avgRow = await getOne(`
      SELECT AVG(EXTRACT(EPOCH FROM (updated_at - reported_at))/86400) as avg_days
      FROM missing_persons WHERE status = 'found'
    `);
    const avgDays = avgRow?.avg_days ? Math.round(avgRow.avg_days * 10) / 10 : 0;

    const todaySightings = (await getOne(`
      SELECT COUNT(*) as count FROM sightings WHERE DATE(reported_at) = CURRENT_DATE
    `))?.count || 0;

    const stateData = await getAll(`
      SELECT state,
        COUNT(*) as cases,
        SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) as resolved
      FROM missing_persons
      GROUP BY state
      ORDER BY cases DESC
      LIMIT 10
    `);

    const monthlyData = (await getAll(`
      SELECT TO_CHAR(reported_at, 'Mon') as month,
        TO_CHAR(reported_at, 'YYYY-MM') as ym,
        COUNT(*) as filed,
        SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) as resolved
      FROM missing_persons
      GROUP BY ym, TO_CHAR(reported_at, 'Mon')
      ORDER BY ym DESC
      LIMIT 6
    `)).reverse();

    const genderData = await getAll(`SELECT gender, COUNT(*) as count FROM missing_persons GROUP BY gender`);
    const statusData = await getAll(`SELECT status, COUNT(*) as count FROM missing_persons GROUP BY status`);

    res.json({
      success: true,
      data: {
        totalCases: Number(total),
        openCases: Number(open),
        resolvedCases: Number(found),
        avgResolutionDays: avgDays,
        sightingsToday: Number(todaySightings),
        stateData, monthlyData, genderData, statusData,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/statistics/alerts
router.get('/alerts', async (req: Request, res: Response) => {
  const alerts = await getAll('SELECT * FROM alerts WHERE is_active = 1 ORDER BY created_at DESC LIMIT 50');
  res.json({ success: true, data: alerts });
});

// POST /api/statistics/alerts
router.post('/alerts', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { type, title, message, caseId, severity = 'medium' } = req.body;
  if (!type || !title || !message) {
    return res.status(400).json({ success: false, message: 'type, title, message required' });
  }
  const id = uuidv4();
  await runQuery(
    `INSERT INTO alerts (id, type, title, message, case_id, severity) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, type, title, message, caseId || null, severity]
  );
  const alert = await getOne('SELECT * FROM alerts WHERE id = $1', [id]);
  res.status(201).json({ success: true, data: alert });
});

// DELETE /api/statistics/alerts/:id
router.delete('/alerts/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  await runQuery('UPDATE alerts SET is_active = 0 WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Alert dismissed' });
});

export default router;
