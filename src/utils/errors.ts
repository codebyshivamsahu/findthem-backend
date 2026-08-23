// src/utils/errors.ts
import { Response } from 'express';
import { config } from '../config';

/** An error whose message is safe to show the client. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function respondWithError(res: Response, err: any) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({
    success: false,
    message: config.isProduction ? 'Internal server error' : err?.message || 'Internal server error',
  });
}

/** Wraps an async route handler so rejected promises reach the error handler. */
export function asyncHandler(fn: (...args: any[]) => Promise<any>) {
  return (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);
}
