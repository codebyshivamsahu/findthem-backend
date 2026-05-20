import { sendSightingAlert } from '../services/notification';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/sightings
router.get('/', optionalAuth, (req: Request, res: Response) => {
  const { caseId, status } = req.query as any;
  let sql = 'SELECT * FROM sightings WHERE 1=1';
  const params: any[] = [];
  if (caseId) { sql += ' AND case_id = ?'; params.push(caseId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY reported_at DESC';
  const rows = getAll(sql, params);
  res.json({ success: true, data: rows });
});

// POST /api/sightings
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { caseId, latitude, longitude, address, description, photoUrl, confidence: aiConfidence } = req.body;

    if (!caseId || !address || !description) {
      return res.status(400).json({ success: false, message: 'caseId, address, description required' });
    }

    const caseRow = getOne('SELECT * FROM missing_persons WHERE case_id = ?', [caseId]);
    if (!caseRow) return res.status(404).json({ success: false, message: 'Case not found' });

    const id = uuidv4();

    // Use AI confidence from frontend, fallback to random
    const confidence   = aiConfidence ? Math.round(aiConfidence) : Math.round(60 + Math.random() * 35);
    const verifiedByAI = confidence >= 65;

    runQuery(
      `INSERT INTO sightings (id, case_id, reported_by, reported_by_user_id, latitude, longitude, address, description, photo_url, verified_by_ai, confidence, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
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

    // Update case status
    if (verifiedByAI) {
      runQuery(
        `UPDATE missing_persons SET status = 'sighting_reported', updated_at = datetime('now') WHERE case_id = ? AND status IN ('open','investigating')`,
        [caseId]
      );
    }

    // Add case timeline update
    runQuery(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type) VALUES (?,?,?,?,?,?,?)`,
      [uuidv4(), caseId, req.user!.name, req.user!.id, req.user!.role,
       `Sighting reported at "${address}". AI face match confidence: ${confidence}%.`, 'sighting']
    );

    // ── Send email to case reporter ────────────────────────────────────────
    const contactEmail = caseRow.contact_email;
    if (contactEmail) {
      console.log(`📧 Sending sighting alert to ${contactEmail} (confidence: ${confidence}%)`);
      sendSightingAlert(contactEmail, {
        personName:   caseRow.name,
        caseId:       caseId,
        confidence:   confidence,
        location:     address,
        description:  description,
        reporterName: req.user!.name,
        reportedAt:   new Date().toISOString(),
      }).then(() => {
        console.log(`✅ Email sent to ${contactEmail}`);
      }).catch(err => {
        console.error(`❌ Email failed:`, err.message);
      });
    } else {
      console.warn(`⚠️  Case ${caseId} has no contact email — email not sent`);
    }

    const sighting = getOne('SELECT * FROM sightings WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: sighting });

  } catch (err: any) {
    console.error('Sighting error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/sightings/:id/status
router.patch('/:id/status', authenticateToken, (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const valid = ['pending', 'verified', 'dismissed'];
  if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
  const existing = getOne('SELECT * FROM sightings WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Sighting not found' });
  runQuery('UPDATE sightings SET status = ? WHERE id = ?', [status, req.params.id]);
  const updated = getOne('SELECT * FROM sightings WHERE id = ?', [req.params.id]);
  res.json({ success: true, data: updated });
});

export default router;
