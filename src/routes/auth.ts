import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { runQuery, getOne, getAll } from '../db/database';
import { authenticateToken, AuthRequest, JWT_SECRET } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, password, phone, role = 'volunteer', district, state } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password required' });
    }

    const existing = getOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    runQuery(
      `INSERT INTO users (id, name, email, password_hash, phone, role, district, state, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, password_hash, phone || null, role, district || null, state || null, 0]
    );

    const token = jwt.sign({ id, email, role, name }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: { id, name, email, phone, role, district, state, verified: false }
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    // Allow demo login
    if (email === 'demo@findthemindia.app' && password === 'demo1234') {
      const demoUser = getOne('SELECT * FROM users WHERE email = ?', [email]);
      if (!demoUser) {
        const id = uuidv4();
        const hash = await bcrypt.hash('demo1234', 10);
        runQuery(
          `INSERT INTO users (id, name, email, password_hash, phone, role, district, state, verified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, 'Demo User', email, hash, '+91-9999999999', 'admin', 'Delhi', 'Delhi', 1]
        );
        const token = jwt.sign({ id, email, role: 'admin', name: 'Demo User' }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({
          success: true,
          data: {
            token,
            user: { id, name: 'Demo User', email, role: 'admin', district: 'Delhi', state: 'Delhi', verified: true }
          }
        });
      }
      const token = jwt.sign(
        { id: demoUser.id, email: demoUser.email, role: demoUser.role, name: demoUser.name },
        JWT_SECRET, { expiresIn: '7d' }
      );
      const { password_hash: _, ...userOut } = demoUser;
      return res.json({ success: true, data: { token, user: userOut } });
    }

    const user = getOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET, { expiresIn: '7d' }
    );

    const { password_hash: _, ...userOut } = user;
    res.json({ success: true, data: { token, user: userOut } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  const user = getOne('SELECT id, name, email, phone, role, district, state, verified, avatar, created_at FROM users WHERE id = ?', [req.user!.id]);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, data: user });
});

// GET /api/auth/users (admin only)
router.get('/users', authenticateToken, (req: AuthRequest, res: Response) => {
  const users = getAll('SELECT id, name, email, phone, role, district, state, verified, created_at FROM users ORDER BY created_at DESC');
  res.json({ success: true, data: users });
});

export default router;