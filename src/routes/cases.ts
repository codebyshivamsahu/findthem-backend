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

// GET /api/cases - List all cases with filters
router.get('/', optionalAuth, (req: Request, res: Response) => {
  try {
    const {
      query, status, gender, state, district,
      ageMin, ageMax, dateFrom, dateTo,
      sortBy = 'recent', page = '1', perPage = '20'
    } = req.query as any;

    let sql = 'SELECT * FROM missing_persons WHERE 1=1';
    const params: any[] = [];

    if (query) {
      sql += ` AND (name LIKE ? OR case_id LIKE ? OR last_seen_location LIKE ? OR district LIKE ?)`;
      const q = `%${query}%`;
      params.push(q, q, q, q);
    }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    if (gender) { sql += ' AND gender = ?'; params.push(gender); }
    if (state) { sql += ' AND state = ?'; params.push(state); }
    if (district) { sql += ' AND district LIKE ?'; params.push(`%${district}%`); }
    if (ageMin) { sql += ' AND age >= ?'; params.push(Number(ageMin)); }
    if (ageMax) { sql += ' AND age <= ?'; params.push(Number(ageMax)); }
    if (dateFrom) { sql += ' AND last_seen_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND last_seen_date <= ?'; params.push(dateTo); }

    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const totalRow = getOne(countSql, params);
    const total = totalRow ? totalRow.total : 0;

    if (sortBy === 'oldest') sql += ' ORDER BY reported_at ASC';
    else if (sortBy === 'name') sql += ' ORDER BY name ASC';
    else sql += ' ORDER BY reported_at DESC';

    const pageNum = parseInt(page);
    const limit = parseInt(perPage);
    const offset = (pageNum - 1) * limit;
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = getAll(sql, params);

    res.json({
      success: true,
      data: rows.map(formatCase),
      pagination: {
        total,
        page: pageNum,
        perPage: limit,
        pages: Math.ceil(total / limit),
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/cases/:id
router.get('/:id', optionalAuth, (req: Request, res: Response) => {
  const row = getOne('SELECT * FROM missing_persons WHERE id = ? OR case_id = ?', [req.params.id, req.params.id]);
  if (!row) return res.status(404).json({ success: false, message: 'Case not found' });
  res.json({ success: true, data: formatCase(row) });
});

// POST /api/cases - Report new missing person
router.post('/', authenticateToken, (req: AuthRequest, res: Response) => {
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
    // Ensure unique caseId
    while (getOne('SELECT id FROM missing_persons WHERE case_id = ?', [caseId])) {
      caseId = generateCaseId();
    }

    runQuery(
      `INSERT INTO missing_persons (
        id, case_id, fir_number, name, age, gender, description, distinguishing_marks,
        last_seen_date, last_seen_location, last_seen_address, latitude, longitude,
        district, state, contact_name, contact_phone, contact_email,
        photos, status, reported_by, reported_by_user_id, assigned_officer
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, caseId, firNumber || null, name, age, gender, description, distinguishingMarks || null,
        lastSeenDate, lastSeenLocation, lastSeenAddress, latitude || null, longitude || null,
        district, state, contactName, contactPhone, contactEmail || null,
        JSON.stringify(photos), 'open', req.user!.name, req.user!.id, assignedOfficer || null,
      ]
    );

    // Auto-create initial case update
    runQuery(
      `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), caseId, req.user!.name, req.user!.id, req.user!.role, `Case reported: ${name}, last seen at ${lastSeenLocation}`, 'note']
    );

    const created = getOne('SELECT * FROM missing_persons WHERE id = ?', [id]);
    // Send confirmation email
    if (contactEmail) {
      sendCaseFiledConfirmation(contactEmail, {
        personName: name, caseId, reporterName: contactName,
        lastSeenLocation, lastSeenDate, district, state,
      }).catch(() => { });
    }
    res.status(201).json({ success: true, message: 'Case reported successfully', data: formatCase(created) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/cases/:id/status
router.patch('/:id/status', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['open', 'investigating', 'sighting_reported', 'found', 'closed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const existing = getOne('SELECT * FROM missing_persons WHERE id = ? OR case_id = ?', [req.params.id, req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });

    runQuery(
      `UPDATE missing_persons SET status = ?, updated_at = datetime('now') WHERE id = ?`,
      [status, existing.id]
    );

    if (note) {
      runQuery(
        `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type) VALUES (?,?,?,?,?,?,?)`,
        [uuidv4(), existing.case_id, req.user!.name, req.user!.id, req.user!.role, note, 'status_change']
      );
    }

    const updated = getOne('SELECT * FROM missing_persons WHERE id = ?', [existing.id]);
    res.json({ success: true, data: formatCase(updated) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/cases/:id - Update case
router.put('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const existing = getOne('SELECT * FROM missing_persons WHERE id = ? OR case_id = ?', [req.params.id, req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });

    const {
      name, age, gender, description, distinguishingMarks,
      lastSeenDate, lastSeenLocation, lastSeenAddress,
      latitude, longitude, district, state,
      contactName, contactPhone, contactEmail,
      firNumber, photos, assignedOfficer, status,
    } = req.body;

    runQuery(
      `UPDATE missing_persons SET
        name = COALESCE(?, name),
        age = COALESCE(?, age),
        gender = COALESCE(?, gender),
        description = COALESCE(?, description),
        distinguishing_marks = COALESCE(?, distinguishing_marks),
        last_seen_date = COALESCE(?, last_seen_date),
        last_seen_location = COALESCE(?, last_seen_location),
        last_seen_address = COALESCE(?, last_seen_address),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        district = COALESCE(?, district),
        state = COALESCE(?, state),
        contact_name = COALESCE(?, contact_name),
        contact_phone = COALESCE(?, contact_phone),
        contact_email = COALESCE(?, contact_email),
        fir_number = COALESCE(?, fir_number),
        photos = COALESCE(?, photos),
        assigned_officer = COALESCE(?, assigned_officer),
        status = COALESCE(?, status),
        updated_at = datetime('now')
       WHERE id = ?`,
      [
        name || null, age || null, gender || null, description || null, distinguishingMarks || null,
        lastSeenDate || null, lastSeenLocation || null, lastSeenAddress || null,
        latitude || null, longitude || null, district || null, state || null,
        contactName || null, contactPhone || null, contactEmail || null,
        firNumber || null, photos ? JSON.stringify(photos) : null, assignedOfficer || null,
        status || null, existing.id
      ]
    );

    const updated = getOne('SELECT * FROM missing_persons WHERE id = ?', [existing.id]);
    res.json({ success: true, data: formatCase(updated) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/cases/:id  (admin only)
router.delete('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  if (req.user!.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });
  const existing = getOne('SELECT id, case_id FROM missing_persons WHERE id = ? OR case_id = ?', [req.params.id, req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  // Cascade delete related records
  runQuery('DELETE FROM sightings WHERE case_id = ?', [existing.case_id]);
  runQuery('DELETE FROM case_updates WHERE case_id = ?', [existing.case_id]);
  runQuery('DELETE FROM missing_persons WHERE id = ?', [existing.id]);
  res.json({ success: true, message: 'Case deleted' });
});

// GET /api/cases/:id/updates
router.get('/:id/updates', optionalAuth, (req: Request, res: Response) => {
  const existing = getOne('SELECT case_id FROM missing_persons WHERE id = ? OR case_id = ?', [req.params.id, req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  const updates = getAll('SELECT * FROM case_updates WHERE case_id = ? ORDER BY created_at DESC', [existing.case_id]);
  res.json({ success: true, data: updates });
});

// POST /api/cases/:id/updates
router.post('/:id/updates', authenticateToken, (req: AuthRequest, res: Response) => {
  const { message, type = 'note' } = req.body;
  const existing = getOne('SELECT case_id FROM missing_persons WHERE id = ? OR case_id = ?', [req.params.id, req.params.id]);
  if (!existing) return res.status(404).json({ success: false, message: 'Case not found' });
  const id = uuidv4();
  runQuery(
    `INSERT INTO case_updates (id, case_id, author, author_user_id, role, message, type) VALUES (?,?,?,?,?,?,?)`,
    [id, existing.case_id, req.user!.name, req.user!.id, req.user!.role, message, type]
  );
  const update = getOne('SELECT * FROM case_updates WHERE id = ?', [id]);
  res.status(201).json({ success: true, data: update });
});

export default router;