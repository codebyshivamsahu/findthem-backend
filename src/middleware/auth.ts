// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export type Role = 'volunteer' | 'ngo' | 'police' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN } as jwt.SignOptions);
}

function readToken(req: Request): string | null {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Access token required' });
  }
  try {
    req.user = jwt.verify(token, config.JWT_SECRET) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

/** Attaches req.user when a valid token is present, but never rejects. */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (token) {
    try {
      req.user = jwt.verify(token, config.JWT_SECRET) as AuthUser;
    } catch {
      // Ignore bad tokens on public endpoints — the caller is just anonymous.
    }
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
}

/** Staff can act on any case; everyone else only on their own. */
export function isStaff(user?: AuthUser): boolean {
  return user?.role === 'admin' || user?.role === 'police';
}
