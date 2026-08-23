// src/middleware/rateLimit.ts
import rateLimit from 'express-rate-limit';

const message = { success: false, message: 'Too many requests — please try again later' };

/** Broad limit for the whole API. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
});

/** Tight limit on credential endpoints — this is the brute-force surface. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
});

/** Writes are cheap to abuse and expensive to clean up. */
export const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message,
});
