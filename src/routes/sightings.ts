// src/routes/sightings.ts
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll, transaction } from '../db/database';
import { authenticateToken, requireRole, isStaff, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { writeLimiter } from '../middleware/rateLimit';
import { createSightingSchema, sightingStatusSchema } from '../schemas';
import { asyncHandler } from '../utils/errors';
import { sendSightingAlert } from '../services/notification';

const router = Router();

/**
 * Sightings name the person who reported them and pinpoint where someone was
 * seen, so the list is not public — you have to be signed in.
 */
router.get('/', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { caseId, status } = req.query as Record<string, string>;
  const params: any[] = [];
  const where: string[] = [];
  if (caseId) { params.push(caseId); where.push(`case_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const rows = await getAll(
    `SELECT * FROM sightings${whereSql} ORDER BY reported_at DESC LIMIT 200`,
    params
  );

  // Only staff see who filed a sighting.
  const data = isStaff(req.user)
    ? rows
    : rows.map(({ reported_by, reported_by_user_id, ...rest }) => rest);

  res.json({ success: true, data });
}));

// POST /api/sightings
router.post('/', authenticateToken, writeLimiter, validateBody(createSightingSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { caseId, latitude, longitude, address, description, photoUrl } = req.body;

  const caseRow = await getOne('SELECT * FROM missing_persons WHERE case_id = $1', [caseId]);
  if (!caseRow) return res.status(404).json({ success: false, message: 'Case not found' });

  const id = uuidv4();

  /*
   * A sighting is always created as `pending` with no confidence score.
   *
   * The previous version generated a random number between 60 and 95, stored it
   * as "AI face match confidence", auto-marked the sighting verified, moved the
   * case to `sighting_reported`, and emailed that number to the family. Nothing
   * was ever compared. A real score can only come from the face service, and a
   * human still has to confirm it — so verification is now a police/admin
   * action (PATCH /:id/status) and the family is only emailed at that point.
   */
  await transaction(async (q) => {
    await q(
      `INSERT INTO sightings (
        id, case_id, reported_by, reported_by_user_id, latitude, longitude,
        address, description, photo_url, verified_by_ai, confidence, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id, caseId, req.user!.name, req.user!.id,
        latitude ?? null, longitude ?? null,
        address, description, photoUrl || null,
        0, null, 'pending',
      ]
    );
    await q(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), caseId, req.user!.name, req.user!.id, req.user!.role,
       `Unverified sighting reported at "${address}". Awaiting review.`, 'sighting']
    );
  });

  const sighting = await getOne('SELECT * FROM sightings WHERE id = $1', [id]);
  res.status(201).json({
    success: true,
    message: 'Sighting submitted for review',
    data: sighting,
  });
}));

// PATCH /api/sightings/:id/status — police / admin only
router.patch('/:id/status', authenticateToken, requireRole('police', 'admin'), validateBody(sightingStatusSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const existing = await getOne('SELECT * FROM sightings WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Sighting not found' });

  const caseRow = await getOne('SELECT * FROM missing_persons WHERE case_id = $1', [existing.case_id]);

  await transaction(async (q) => {
    await q(
      `UPDATE sightings SET status = $1, reviewed_by_user_id = $2, reviewed_at = NOW() WHERE id = $3`,
      [status, req.user!.id, req.params.id]
    );
    if (status === 'verified' && caseRow) {
      await q(
        `UPDATE missing_persons SET status = 'sighting_reported', updated_at = NOW()
         WHERE case_id = $1 AND status IN ('open','investigating')`,
        [existing.case_id]
      );
    }
    await q(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), existing.case_id, req.user!.name, req.user!.id, req.user!.role,
       `Sighting at "${existing.address}" marked ${status} after review.`, 'sighting']
    );
  });

  // The family is told about a sighting only once a human has verified it.
  if (status === 'verified' && caseRow?.contact_email) {
    sendSightingAlert(caseRow.contact_email, {
      personName: caseRow.name,
      caseId: existing.case_id,
      location: existing.address,
      description: existing.description,
      reviewedBy: `${req.user!.name} (${req.user!.role})`,
      reportedAt: existing.reported_at,
    }).catch((e) => console.error('Sighting email failed:', e.message));
  }

  const updated = await getOne('SELECT * FROM sightings WHERE id = $1', [req.params.id]);
  res.json({ success: true, data: updated });
}));

export default router;
