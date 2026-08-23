// src/routes/cases.ts
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll, transaction } from '../db/database';
import { authenticateToken, optionalAuth, requireRole, isStaff, AuthRequest, AuthUser } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { writeLimiter } from '../middleware/rateLimit';
import {
  createCaseSchema, updateCaseSchema, caseStatusSchema, caseUpdateSchema, listCasesSchema,
} from '../schemas';
import { asyncHandler } from '../utils/errors';
import { sendCaseFiledConfirmation } from '../services/notification';

const router = Router();

function generateCaseId(): string {
  const year = new Date().getFullYear();
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `FTI-${year}-${num}`;
}

function parsePhotos(photos: any): string[] {
  if (!photos) return [];
  if (typeof photos === 'string') {
    try { return JSON.parse(photos); } catch { return []; }
  }
  return photos;
}

/** Only the reporter, police or an admin may modify a case. */
function canEditCase(user: AuthUser | undefined, row: any): boolean {
  if (!user) return false;
  if (isStaff(user)) return true;
  return row.reported_by_user_id === user.id;
}

/**
 * Family contact details and the exact address are PII. They are serialised
 * only for signed-in users; anonymous callers get the searchable fields.
 */
function formatCase(row: any, viewer?: AuthUser) {
  if (!row) return null;
  const contact = viewer
    ? {
        lastSeenAddress: row.last_seen_address,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        contactEmail: row.contact_email,
      }
    : {};
  return {
    ...contact,
    id: row.id,
    caseId: row.case_id,
    firNumber: row.fir_number,
    name: row.name,
    age: row.age,
    gender: row.gender,
    lastSeenDate: row.last_seen_date,
    lastSeenLocation: row.last_seen_location,
    latitude: row.latitude,
    longitude: row.longitude,
    description: row.description,
    distinguishingMarks: row.distinguishing_marks,
    photos: parsePhotos(row.photos),
    status: row.status,
    reportedBy: row.reported_by,
    reportedByUserId: row.reported_by_user_id,
    assignedOfficer: row.assigned_officer,
    district: row.district,
    state: row.state,
    matchConfidence: row.match_confidence,
    ageProgressed: row.age_progressed,
    reportedAt: row.reported_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/cases
router.get('/', optionalAuth, validateQuery(listCasesSchema), asyncHandler(async (req: Request, res: Response) => {
  const q = (req as any).validatedQuery;
  const where: string[] = [];
  const params: any[] = [];
  const p = (v: any) => { params.push(v); return `$${params.length}`; };

  if (q.query) {
    const like = `%${q.query}%`;
    where.push(`(name ILIKE ${p(like)} OR case_id ILIKE ${p(like)} OR last_seen_location ILIKE ${p(like)} OR district ILIKE ${p(like)})`);
  }
  if (q.status) where.push(`status = ${p(q.status)}`);
  if (q.gender) where.push(`gender = ${p(q.gender)}`);
  if (q.state) where.push(`state = ${p(q.state)}`);
  if (q.district) where.push(`district ILIKE ${p(`%${q.district}%`)}`);
  if (q.ageMin !== undefined) where.push(`age >= ${p(q.ageMin)}`);
  if (q.ageMax !== undefined) where.push(`age <= ${p(q.ageMax)}`);
  if (q.dateFrom) where.push(`last_seen_date >= ${p(q.dateFrom)}`);
  if (q.dateTo) where.push(`last_seen_date <= ${p(q.dateTo)}`);

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const totalRow = await getOne(`SELECT COUNT(*)::int AS total FROM missing_persons${whereSql}`, params);
  const total = totalRow?.total ?? 0;

  const order = q.sortBy === 'oldest' ? 'reported_at ASC'
    : q.sortBy === 'name' ? 'name ASC'
    : 'reported_at DESC';

  const offset = (q.page - 1) * q.perPage;
  const rows = await getAll(
    `SELECT * FROM missing_persons${whereSql} ORDER BY ${order} LIMIT ${p(q.perPage)} OFFSET ${p(offset)}`,
    params
  );

  res.json({
    success: true,
    data: rows.map((r) => formatCase(r, (req as AuthRequest).user)),
    pagination: { total, page: q.page, perPage: q.perPage, pages: Math.ceil(total / q.perPage) },
  });
}));

// GET /api/cases/:id
router.get('/:id', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const row = await getOne('SELECT * FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, message: 'Case not found' });
  res.json({ success: true, data: formatCase(row, (req as AuthRequest).user) });
}));

// POST /api/cases
router.post('/', authenticateToken, writeLimiter, validateBody(createCaseSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const b = req.body;

  let caseId = generateCaseId();
  while (await getOne('SELECT id FROM missing_persons WHERE case_id = $1', [caseId])) {
    caseId = generateCaseId();
  }
  const id = uuidv4();

  await transaction(async (q) => {
    await q(
      `INSERT INTO missing_persons (
        id, case_id, fir_number, name, age, gender, description, distinguishing_marks,
        last_seen_date, last_seen_location, last_seen_address, latitude, longitude,
        district, state, contact_name, contact_phone, contact_email,
        photos, status, reported_by, reported_by_user_id, assigned_officer
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        id, caseId, b.firNumber || null, b.name, b.age, b.gender, b.description, b.distinguishingMarks || null,
        b.lastSeenDate, b.lastSeenLocation, b.lastSeenAddress, b.latitude ?? null, b.longitude ?? null,
        b.district, b.state, b.contactName, b.contactPhone, b.contactEmail || null,
        JSON.stringify(b.photos || []), 'open', req.user!.name, req.user!.id, b.assignedOfficer || null,
      ]
    );
    await q(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), caseId, req.user!.name, req.user!.id, req.user!.role,
       `Case reported: ${b.name}, last seen at ${b.lastSeenLocation}`, 'note']
    );
  });

  if (b.contactEmail) {
    sendCaseFiledConfirmation(b.contactEmail, {
      personName: b.name, caseId, reporterName: b.contactName,
      lastSeenLocation: b.lastSeenLocation, lastSeenDate: b.lastSeenDate,
      district: b.district, state: b.state,
    }).catch((e) => console.error('Confirmation email failed:', e.message));
  }

  const created = await getOne('SELECT * FROM missing_persons WHERE id = $1', [id]);
  res.status(201).json({ success: true, message: 'Case reported successfully', data: formatCase(created, req.user) });
}));

// PUT /api/cases/:id — status is handled by PATCH /:id/status, not here
router.put('/:id', authenticateToken, validateBody(updateCaseSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await getOne('SELECT * FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  if (!canEditCase(req.user, existing)) {
    return res.status(403).json({ success: false, message: 'You cannot edit this case' });
  }

  const b = req.body;
  await runQuery(
    `UPDATE missing_persons SET
      name = COALESCE($1, name),
      age = COALESCE($2, age),
      gender = COALESCE($3, gender),
      description = COALESCE($4, description),
      distinguishing_marks = COALESCE($5, distinguishing_marks),
      last_seen_date = COALESCE($6, last_seen_date),
      last_seen_location = COALESCE($7, last_seen_location),
      last_seen_address = COALESCE($8, last_seen_address),
      latitude = COALESCE($9, latitude),
      longitude = COALESCE($10, longitude),
      district = COALESCE($11, district),
      state = COALESCE($12, state),
      contact_name = COALESCE($13, contact_name),
      contact_phone = COALESCE($14, contact_phone),
      contact_email = COALESCE($15, contact_email),
      fir_number = COALESCE($16, fir_number),
      photos = COALESCE($17, photos),
      assigned_officer = COALESCE($18, assigned_officer),
      updated_at = NOW()
     WHERE id = $19`,
    [
      b.name ?? null, b.age ?? null, b.gender ?? null, b.description ?? null, b.distinguishingMarks ?? null,
      b.lastSeenDate ?? null, b.lastSeenLocation ?? null, b.lastSeenAddress ?? null,
      b.latitude ?? null, b.longitude ?? null, b.district ?? null, b.state ?? null,
      b.contactName ?? null, b.contactPhone ?? null, b.contactEmail || null,
      b.firNumber ?? null, b.photos ? JSON.stringify(b.photos) : null, b.assignedOfficer ?? null,
      existing.id,
    ]
  );

  const updated = await getOne('SELECT * FROM missing_persons WHERE id = $1', [existing.id]);
  res.json({ success: true, data: formatCase(updated, req.user) });
}));

// PATCH /api/cases/:id/status
router.patch('/:id/status', authenticateToken, validateBody(caseStatusSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, note } = req.body;
  const existing = await getOne('SELECT * FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  if (!canEditCase(req.user, existing)) {
    return res.status(403).json({ success: false, message: 'You cannot change the status of this case' });
  }

  await transaction(async (q) => {
    await q(`UPDATE missing_persons SET status = $1, updated_at = NOW() WHERE id = $2`, [status, existing.id]);
    await q(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), existing.case_id, req.user!.name, req.user!.id, req.user!.role,
       note || `Status changed to ${status}`, 'status_change']
    );
  });

  const updated = await getOne('SELECT * FROM missing_persons WHERE id = $1', [existing.id]);
  res.json({ success: true, data: formatCase(updated, req.user) });
}));

// DELETE /api/cases/:id — admin only
router.delete('/:id', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await getOne('SELECT id, case_id FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });

  await transaction(async (q) => {
    await q('DELETE FROM sightings WHERE case_id = $1', [existing.case_id]);
    await q('DELETE FROM case_updates WHERE case_id = $1', [existing.case_id]);
    await q('DELETE FROM missing_persons WHERE id = $1', [existing.id]);
  });
  res.json({ success: true, message: 'Case deleted' });
}));

// GET /api/cases/:id/updates — signed-in users only (contains reporter names)
router.get('/:id/updates', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await getOne('SELECT case_id FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  const updates = await getAll(
    'SELECT id, case_id, author, role, message, type, created_at FROM case_updates WHERE case_id = $1 ORDER BY created_at DESC LIMIT 200',
    [existing.case_id]
  );
  res.json({ success: true, data: updates });
}));

// POST /api/cases/:id/updates
router.post('/:id/updates', authenticateToken, writeLimiter, validateBody(caseUpdateSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await getOne('SELECT case_id FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });

  const id = uuidv4();
  await runQuery(
    `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, existing.case_id, req.user!.name, req.user!.id, req.user!.role, req.body.message, req.body.type]
  );
  const update = await getOne('SELECT id, case_id, author, role, message, type, created_at FROM case_updates WHERE id = $1', [id]);
  res.status(201).json({ success: true, data: update });
}));

export default router;
