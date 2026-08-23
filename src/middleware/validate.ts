// src/middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

/**
 * Validates and REPLACES req.body with the parsed result, so handlers can only
 * ever see fields the schema declares. Unknown fields (e.g. an injected
 * "role" or "status") are stripped before they reach any SQL.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid query parameters',
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}
