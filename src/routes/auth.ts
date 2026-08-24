// src/routes/auth.ts
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import {
  authenticateToken, requireRole, signToken, AuthRequest, Role,
} from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { authLimiter } from '../middleware/rateLimit';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from '../schemas';
import { asyncHandler } from '../utils/errors';
import { sendPasswordReset } from '../services/notification';
import { config } from '../config';

const router = Router();

const BCRYPT_ROUNDS = 12;

function publicUser(row: any) {
  const { password_hash, ...rest } = row;
  return rest;
}

// POST /api/auth/register
router.post('/register', authLimiter, validateBody(registerSchema), asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, phone, district, state } = req.body;

  const existing = await getOne('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Email already registered' });
  }

  // Role is never taken from the request. Promote with `npm run promote-user`.
  const role: Role = 'volunteer';
  const id = uuidv4();
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await runQuery(
    `INSERT INTO users (id, name, email, password_hash, phone, role, district, state, verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, name, email, password_hash, phone || null, role, district || null, state || null, 0]
  );

  const token = signToken({ id, email, role, name });
  res.status(201).json({
    success: true,
    message: 'Registration successful',
    data: { token, user: { id, name, email, phone, role, district, state, verified: false } },
  });
}));

// POST /api/auth/login
router.post('/login', authLimiter, validateBody(loginSchema), asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await getOne('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);

  // Always run a hash comparison so a missing account and a wrong password take
  // roughly the same time — otherwise the endpoint tells you which emails exist.
  const hash = user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
  res.json({ success: true, data: { token, user: publicUser(user) } });
}));

// GET /api/auth/me
router.get('/me', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const user = await getOne(
    `SELECT id, name, email, phone, role, district, state, verified, avatar, created_at
     FROM users WHERE id = $1`,
    [req.user!.id]
  );
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, data: user });
}));

// PATCH /api/auth/me — update your own profile (not your role)
router.patch('/me', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, phone, district, state } = req.body || {};
  await runQuery(
    `UPDATE users SET
       name = COALESCE($1, name),
       phone = COALESCE($2, phone),
       district = COALESCE($3, district),
       state = COALESCE($4, state),
       updated_at = NOW()
     WHERE id = $5`,
    [name || null, phone || null, district || null, state || null, req.user!.id]
  );
  const user = await getOne(
    `SELECT id, name, email, phone, role, district, state, verified, avatar, created_at
     FROM users WHERE id = $1`,
    [req.user!.id]
  );
  res.json({ success: true, data: user });
}));

// GET /api/auth/users — admin only
router.get('/users', authenticateToken, requireRole('admin'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const users = await getAll(
    `SELECT id, name, email, phone, role, district, state, verified, created_at
     FROM users ORDER BY created_at DESC LIMIT 500`
  );
  res.json({ success: true, data: users });
}));

// PATCH /api/auth/users/:id/role — admin only
router.patch('/users/:id/role', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { role } = req.body || {};
  const allowed = ['volunteer', 'ngo', 'police', 'admin'];
  if (!allowed.includes(role)) {
    return res.status(400).json({ success: false, message: `role must be one of: ${allowed.join(', ')}` });
  }
  if (req.params.id === req.user!.id) {
    return res.status(400).json({ success: false, message: 'You cannot change your own role' });
  }
  const user = await getOne('SELECT id FROM users WHERE id = $1', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  await runQuery('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, req.params.id]);
  res.json({ success: true, message: `Role updated to ${role}` });
}));

const RESET_TTL_MINUTES = 60;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, validateBody(forgotPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  const { email } = req.body;

  const user = await getOne('SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1)', [email]);

  if (user) {
    // Only the hash is stored. A leaked database still can't be used to reset
    // anyone's password, because the token in the email is never written down.
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

    // One live link per user: asking again invalidates the previous email.
    await runQuery('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await runQuery(
      'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,$3)',
      [hashToken(token), user.id, expiresAt]
    );

    const resetUrl = `${config.frontendUrl.replace(/\/$/, '')}/reset-password?token=${token}`;

    if (!config.isProduction) {
      // Local dev has no email provider configured, so print the link.
      console.log(`\nPassword reset link for ${user.email}:\n${resetUrl}\n`);
    }

    sendPasswordReset(user.email, {
      name: user.name,
      resetUrl,
      expiresInMinutes: RESET_TTL_MINUTES,
    }).catch((e) => console.error('Reset email failed:', e.message));
  }

  // Same answer either way. Differentiating would turn this endpoint into a way
  // to check which email addresses have accounts here.
  res.json({
    success: true,
    message: 'If an account exists for that email, a reset link has been sent.',
  });
}));

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, validateBody(resetPasswordSchema), asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = req.body;

  const record = await getOne(
    `SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1`,
    [hashToken(token)]
  );

  const invalid = !record || record.used_at || new Date(record.expires_at) < new Date();
  if (invalid) {
    return res.status(400).json({
      success: false,
      message: 'This reset link is invalid or has expired. Please request a new one.',
    });
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await runQuery('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [password_hash, record.user_id]);

  // Burn the token, and clear any other outstanding links for this account.
  await runQuery('DELETE FROM password_resets WHERE user_id = $1', [record.user_id]);

  res.json({ success: true, message: 'Password updated. You can sign in now.' });
}));

export default router;
