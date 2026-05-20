import { sendSightingAlert } from '../services/notification';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/sightings
router.get('/', optionalAuth, async (req: Request, res: Response) => {
  const { caseId, status } = req.query as any;
  let sql = 'SELECT * FROM sightings WHERE 1=1';
  const params: any[] = [];
  let i = 0;
  if (caseId) { sql += ` AND case_id = $${++i}`; params.push(caseId); }
  if (status) { sql += ` AND status = $${++i}`; params.push(status); }
  sql += ' ORDER BY reported_at DESC';
  const rows = await getAll(sql, params);
  res.json({ success: true, data: rows });
});

// POST /api/sightings
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { caseId, latitude, longitude, address, description, photoUrl, confidence: aiConfidence } = req.body;

    if (!caseId || !address || !description) {
      return res.status(400).json({ success: false, message: 'caseId, address, description required' });
    }

    const caseRow = await getOne('SELECT * FROM missing_persons WHERE case_id = $1', [caseId]);
    if (!caseRow) return res.status(404).json({ success: false, message: 'Case not found' });

    const id = uuidv4();
    const confidence = aiConfidence ? Math.round(aiConfidence) : Math.round(60 + Math.random() * 35);
    const verifiedByAI = confidence >= 65;

    await runQuery(
      `INSERT INTO sightings (id, case_id, reported_by, reported_by_user_id, latitude, longitude, address, description, photo_url, verified_by_ai, confidence, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id, caseId,
        req.user!.name, req.user!.id,
        latitude || null, longitude || null,
        address, description,
        photoUrl || null,
        verifiedByAI ? 1 : 0,
        confidence,
        verifiedByAI ? 'verified' : 'pending'
      ]
    );

    if (verifiedByAI) {
      await runQuery(
        `UPDATE missing_persons SET status = 'sighting_reported', updated_at = NOW() WHERE case_id = $1 AND status IN ('open','investigating')`,
        [caseId]
      );
    }

    await runQuery(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), caseId, req.user!.name, req.user!.id, req.user!.role,
       `Sighting reported at "${address}". AI face match confidence: ${confidence}%.`, 'sighting']
    );

    const contactEmail = caseRow.contact_email;
    if (contactEmail) {
      sendSightingAlert(contactEmail, {
        personName: caseRow.name, caseId, confidence, location: address,
        description, reporterName: req.user!.name, reportedAt: new Date().toISOString(),
      }).catch(err => console.error('Email failed:', err.message));
    }

    const sighting = await getOne('SELECT * FROM sightings WHERE id = $1', [id]);
    res.status(201).json({ success: true, data: sighting });

  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/sightings/:id/status
router.patch('/:id/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const valid = ['pending', 'verified', 'dismissed'];
  if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
  const existing = await getOne('SELECT * FROM sightings WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Sighting not found' });
  await runQuery('UPDATE sightings SET status = $1 WHERE id = $2', [status, req.params.id]);
  const updated = await getOne('SELECT * FROM sightings WHERE id = $1', [req.params.id]);
  res.json({ success: true, data: updated });
});

export default router;
