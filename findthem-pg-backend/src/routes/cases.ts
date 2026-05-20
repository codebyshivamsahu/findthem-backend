import { sendCaseFiledConfirmation } from '../services/notification';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';

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

function formatCase(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    firNumber: row.fir_number,
    name: row.name,
    age: row.age,
    gender: row.gender,
    lastSeenDate: row.last_seen_date,
    lastSeenLocation: row.last_seen_location,
    lastSeenAddress: row.last_seen_address,
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
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    matchConfidence: row.match_confidence,
    ageProgressed: row.age_progressed,
    reportedAt: row.reported_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/cases
router.get('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const {
      query, status, gender, state, district,
      ageMin, ageMax, dateFrom, dateTo,
      sortBy = 'recent', page = '1', perPage = '20'
    } = req.query as any;

    let sql = 'SELECT * FROM missing_persons WHERE 1=1';
    const params: any[] = [];
    let i = 0;

    if (query) {
      sql += ` AND (name ILIKE $${++i} OR case_id ILIKE $${++i} OR last_seen_location ILIKE $${++i} OR district ILIKE $${++i})`;
      const q = `%${query}%`;
      params.push(q, q, q, q);
    }
    if (status) { sql += ` AND status = $${++i}`; params.push(status); }
    if (gender) { sql += ` AND gender = $${++i}`; params.push(gender); }
    if (state) { sql += ` AND state = $${++i}`; params.push(state); }
    if (district) { sql += ` AND district ILIKE $${++i}`; params.push(`%${district}%`); }
    if (ageMin) { sql += ` AND age >= $${++i}`; params.push(Number(ageMin)); }
    if (ageMax) { sql += ` AND age <= $${++i}`; params.push(Number(ageMax)); }
    if (dateFrom) { sql += ` AND last_seen_date >= $${++i}`; params.push(dateFrom); }
    if (dateTo) { sql += ` AND last_seen_date <= $${++i}`; params.push(dateTo); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const totalRow = await getOne(countSql, params);
    const total = totalRow ? Number(totalRow.total) : 0;

    if (sortBy === 'oldest') sql += ' ORDER BY reported_at ASC';
    else if (sortBy === 'name') sql += ' ORDER BY name ASC';
    else sql += ' ORDER BY reported_at DESC';

    const pageNum = parseInt(page);
    const limit = parseInt(perPage);
    const offset = (pageNum - 1) * limit;
    sql += ` LIMIT $${++i} OFFSET $${++i}`;
    params.push(limit, offset);

    const rows = await getAll(sql, params);

    res.json({
      success: true,
      data: rows.map(formatCase),
      pagination: { total, page: pageNum, perPage: limit, pages: Math.ceil(total / limit) }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/cases/:id
router.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  const row = await getOne('SELECT * FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, message: 'Case not found' });
  res.json({ success: true, data: formatCase(row) });
});

// POST /api/cases
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, age, gender, description, distinguishingMarks,
      lastSeenDate, lastSeenLocation, lastSeenAddress,
      latitude, longitude, district, state,
      contactName, contactPhone, contactEmail,
      firNumber, photos = [], assignedOfficer,
    } = req.body;

    if (!name || !age || !gender || !lastSeenDate || !lastSeenLocation || !district || !state || !contactName || !contactPhone) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const id = uuidv4();
    let caseId = generateCaseId();
    while (await getOne('SELECT id FROM missing_persons WHERE case_id = $1', [caseId])) {
      caseId = generateCaseId();
    }

    await runQuery(
      `INSERT INTO missing_persons (
        id, case_id, fir_number, name, age, gender, description, distinguishing_marks,
        last_seen_date, last_seen_location, last_seen_address, latitude, longitude,
        district, state, contact_name, contact_phone, contact_email,
        photos, status, reported_by, reported_by_user_id, assigned_officer
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        id, caseId, firNumber || null, name, age, gender, description, distinguishingMarks || null,
        lastSeenDate, lastSeenLocation, lastSeenAddress, latitude || null, longitude || null,
        district, state, contactName, contactPhone, contactEmail || null,
        JSON.stringify(photos), 'open', req.user!.name, req.user!.id, assignedOfficer || null,
      ]
    );

    await runQuery(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuidv4(), caseId, req.user!.name, req.user!.id, req.user!.role, `Case reported: ${name}, last seen at ${lastSeenLocation}`, 'note']
    );

    const created = await getOne('SELECT * FROM missing_persons WHERE id = $1', [id]);
    if (contactEmail) {
      sendCaseFiledConfirmation(contactEmail, {
        personName: name, caseId, reporterName: contactName,
        lastSeenLocation, lastSeenDate, district, state,
      }).catch(() => {});
    }
    res.status(201).json({ success: true, message: 'Case reported successfully', data: formatCase(created) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/cases/:id/status
router.patch('/:id/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['open', 'investigating', 'sighting_reported', 'found', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const existing = await getOne('SELECT * FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });

    await runQuery(
      `UPDATE missing_persons SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, existing.id]
    );

    if (note) {
      await runQuery(
        `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv4(), existing.case_id, req.user!.name, req.user!.id, req.user!.role, note, 'status_change']
      );
    }

    const updated = await getOne('SELECT * FROM missing_persons WHERE id = $1', [existing.id]);
    res.json({ success: true, data: formatCase(updated) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/cases/:id
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await getOne('SELECT * FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });

    const {
      name, age, gender, description, distinguishingMarks,
      lastSeenDate, lastSeenLocation, lastSeenAddress,
      latitude, longitude, district, state,
      contactName, contactPhone, contactEmail,
      firNumber, photos, assignedOfficer, status,
    } = req.body;

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
        status = COALESCE($19, status),
        updated_at = NOW()
       WHERE id = $20`,
      [
        name || null, age || null, gender || null, description || null, distinguishingMarks || null,
        lastSeenDate || null, lastSeenLocation || null, lastSeenAddress || null,
        latitude || null, longitude || null, district || null, state || null,
        contactName || null, contactPhone || null, contactEmail || null,
        firNumber || null, photos ? JSON.stringify(photos) : null, assignedOfficer || null,
        status || null, existing.id
      ]
    );

    const updated = await getOne('SELECT * FROM missing_persons WHERE id = $1', [existing.id]);
    res.json({ success: true, data: formatCase(updated) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/cases/:id
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });
  const existing = await getOne('SELECT id, case_id FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  await runQuery('DELETE FROM sightings WHERE case_id = $1', [existing.case_id]);
  await runQuery('DELETE FROM case_updates WHERE case_id = $1', [existing.case_id]);
  await runQuery('DELETE FROM missing_persons WHERE id = $1', [existing.id]);
  res.json({ success: true, message: 'Case deleted' });
});

// GET /api/cases/:id/updates
router.get('/:id/updates', optionalAuth, async (req: Request, res: Response) => {
  const existing = await getOne('SELECT case_id FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  const updates = await getAll('SELECT * FROM case_updates WHERE case_id = $1 ORDER BY created_at DESC', [existing.case_id]);
  res.json({ success: true, data: updates });
});

// POST /api/cases/:id/updates
router.post('/:id/updates', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { message, type = 'note' } = req.body;
  const existing = await getOne('SELECT case_id FROM missing_persons WHERE id = $1 OR case_id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  const id = uuidv4();
  await runQuery(
    `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, existing.case_id, req.user!.name, req.user!.id, req.user!.role, message, type]
  );
  const update = await getOne('SELECT * FROM case_updates WHERE id = $1', [id]);
  res.status(201).json({ success: true, data: update });
});

export default router;
