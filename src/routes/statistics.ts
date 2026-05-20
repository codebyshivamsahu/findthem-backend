import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/statistics
router.get('/', (req: Request, res: Response) => {
  try {
    const total = getOne('SELECT COUNT(*) as count FROM missing_persons')?.count || 0;
    const open = getOne("SELECT COUNT(*) as count FROM missing_persons WHERE status IN ('open', 'investigating', 'sighting_reported')")?.count || 0;
    const found = getOne("SELECT COUNT(*) as count FROM missing_persons WHERE status = 'found'")?.count || 0;

    const avgRow = getOne(`
      SELECT AVG(julianday(updated_at) - julianday(reported_at)) as avg_days
      FROM missing_persons WHERE status = 'found'
    `);
    const avgDays = avgRow?.avg_days ? Math.round(avgRow.avg_days * 10) / 10 : 0;

    const todaySightings = getOne(`
      SELECT COUNT(*) as count FROM sightings WHERE date(reported_at) = date('now')
    `)?.count || 0;

    const stateData = getAll(`
      SELECT state,
        COUNT(*) as cases,
        SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) as resolved
      FROM missing_persons
      GROUP BY state
      ORDER BY cases DESC
      LIMIT 10
    `);

    const monthlyData = getAll(`
      SELECT strftime('%b', reported_at) as month,
        strftime('%Y-%m', reported_at) as ym,
        COUNT(*) as filed,
        SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) as resolved
      FROM missing_persons
      GROUP BY ym
      ORDER BY ym DESC
      LIMIT 6
    `).reverse();

    const genderData = getAll(`
      SELECT gender, COUNT(*) as count FROM missing_persons GROUP BY gender
    `);

    const statusData = getAll(`
      SELECT status, COUNT(*) as count FROM missing_persons GROUP BY status
    `);

    res.json({
      success: true,
      data: {
        totalCases: total,
        openCases: open,
        resolvedCases: found,
        avgResolutionDays: avgDays,
        sightingsToday: todaySightings,
        stateData,
        monthlyData,
        genderData,
        statusData,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/alerts
router.get('/alerts', (req: Request, res: Response) => {
  const alerts = getAll('SELECT * FROM alerts WHERE is_active = 1 ORDER BY created_at DESC LIMIT 50');
  res.json({ success: true, data: alerts });
});

// POST /api/alerts (admin/police only)
router.post('/alerts', authenticateToken, (req: AuthRequest, res: Response) => {
  const { type, title, message, caseId, severity = 'medium' } = req.body;
  if (!type || !title || !message) {
    return res.status(400).json({ success: false, message: 'type, title, message required' });
  }
  const id = uuidv4();
  runQuery(
    `INSERT INTO alerts (id, type, title, message, case_id, severity) VALUES (?,?,?,?,?,?)`,
    [id, type, title, message, caseId || null, severity]
  );
  const alert = getOne('SELECT * FROM alerts WHERE id = ?', [id]);
  res.status(201).json({ success: true, data: alert });
});

// DELETE /api/alerts/:id
router.delete('/alerts/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  runQuery('UPDATE alerts SET is_active = 0 WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Alert dismissed' });
});

export default router;
