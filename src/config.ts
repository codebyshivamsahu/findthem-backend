// src/config.ts
// Single place where environment variables are read and validated.
// The process refuses to start with a bad config rather than failing later at
// runtime with a confusing error.
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (PostgreSQL connection string)'),

  // Generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Comma-separated list of browser origins allowed to call this API.
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Optional: face matching microservice (face_server.py). Sightings work
  // without it — they just don't get a confidence score.
  FACE_SERVICE_URL: z.string().url().optional(),

  // Optional: transactional email via Brevo. Unset = emails are skipped, not an error.
  BREVO_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('no-reply@findthemindia.app'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nSee .env.example for the full list.');
  process.exit(1);
}

const env = parsed.data;

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  emailEnabled: Boolean(env.BREVO_API_KEY),
};

export type Config = typeof config;
