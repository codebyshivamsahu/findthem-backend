// src/routes/sightings.ts
import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll, transaction } from '../db/database';
import { authenticateToken, requireRole, isStaff, AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { writeLimiter } from '../middleware/rateLimit';
import { createSightingSchema, sightingStatusSchema } from '../schemas';
import { asyncHandler } from '../utils/errors';
import { sendSightingAlert, sendSightingReported } from '../services/notification';
import { scoreSightingPhoto } from '../services/faceMatch';

const router = Router();

function parsePhotos(photos: any): string[] {
  if (!photos) return [];
  if (typeof photos === 'string') {
    try { return JSON.parse(photos); } catch { return []; }
  }
  return photos;
}

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
   * Everything here is automatic — nobody has to be online for a report to
   * land, for the case to update, or for the family to hear about it.
   *
   * What is NOT automatic is calling something a match. The face service
   * compares image gradients, so its score can neither confirm nor rule out an
   * identity: it is stored for reviewers to sort by and shown in the dashboard,
   * but it never sets `verified`, and it never goes in an email. A percentage
   * in a message to a parent reads as certainty the platform does not have.
   *
   * (The previous version filled this field with Math.random() * 35 + 60 when
   * the service didn't answer, marked the sighting verified off that number,
   * and emailed it to the family as "AI Match Confidence".)
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
       `Sighting reported at "${address}". Not yet reviewed.`, 'sighting']
    );
    // The case moves immediately so it surfaces to police and on the dashboard.
    await q(
      `UPDATE missing_persons SET status = 'sighting_reported', updated_at = NOW()
       WHERE case_id = $1 AND status IN ('open','investigating')`,
      [caseId]
    );
  });

  // Family is notified straight away — location, time and description, no score.
  if (caseRow.contact_email) {
    sendSightingReported(caseRow.contact_email, {
      personName: caseRow.name,
      caseId,
      location: address,
      description,
      reportedAt: new Date(),
    }).catch((e) => console.error('Sighting email failed:', e.message));
  }

  const sighting = await getOne('SELECT * FROM sightings WHERE id = $1', [id]);
  res.status(201).json({
    success: true,
    message: 'Sighting submitted. The family has been notified.',
    data: sighting,
  });

  // Scoring runs after the response so a sleeping face service can never delay
  // or block a report. Failure just leaves the score empty.
  scoreSightingPhoto(photoUrl, caseId, parsePhotos(caseRow.photos))
    .then((score) => {
      if (score === null) return;
      return runQuery('UPDATE sightings SET confidence = $1 WHERE id = $2', [score, id]);
    })
    .catch((e) => console.error('Similarity scoring failed:', e?.message || e));
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
