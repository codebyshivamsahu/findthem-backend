// src/schemas.ts
// Every write endpoint validates against one of these. Anything not declared
// here is stripped from the request body before a handler sees it.
import { z } from 'zod';

export const CASE_STATUSES = ['open', 'investigating', 'sighting_reported', 'found', 'closed'] as const;
export const SIGHTING_STATUSES = ['pending', 'verified', 'dismissed'] as const;
export const GENDERS = ['male', 'female', 'other'] as const;

const email = z.string().trim().toLowerCase().email('Must be a valid email').max(254);
const phone = z.string().trim().min(6).max(20).regex(/^[+0-9()\-\s]+$/, 'Invalid phone number');
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(5000);

// A photo is either an https URL or a data: URI. Capped so a single case can't
// carry megabytes of base64 into the database.
const photo = z
  .string()
  .max(2_000_000, 'Each photo must be under ~2MB')
  .refine((v) => v.startsWith('https://') || v.startsWith('data:image/'), {
    message: 'Photo must be an https URL or a data:image URI',
  });

export const registerSchema = z.object({
  name: shortText,
  email,
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  phone: phone.optional(),
  district: shortText.optional(),
  state: shortText.optional(),
  // NOTE: `role` is intentionally absent. Zod strips it, so a client cannot
  // grant itself a role no matter what it posts.
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

export const createCaseSchema = z.object({
  name: shortText,
  age: z.coerce.number().int().min(0).max(120),
  gender: z.enum(GENDERS),
  description: longText,
  distinguishingMarks: z.string().trim().max(1000).optional(),
  lastSeenDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD'),
  lastSeenLocation: shortText,
  lastSeenAddress: z.string().trim().min(1).max(500),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  district: shortText,
  state: shortText,
  contactName: shortText,
  contactPhone: phone,
  contactEmail: email.optional().or(z.literal('')),
  firNumber: z.string().trim().max(100).optional(),
  photos: z.array(photo).max(5, 'At most 5 photos').default([]),
  assignedOfficer: shortText.optional(),
});

// Same shape, everything optional, and no status — status moves through
// PATCH /:id/status so its allow-list can't be bypassed.
export const updateCaseSchema = createCaseSchema.partial();

export const caseStatusSchema = z.object({
  status: z.enum(CASE_STATUSES),
  note: z.string().trim().max(2000).optional(),
});

export const caseUpdateSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  type: z.enum(['note', 'status_change', 'sighting']).default('note'),
});

export const createSightingSchema = z.object({
  caseId: z.string().trim().min(1).max(50),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().trim().min(1).max(500),
  description: longText,
  photoUrl: photo.optional(),
});

export const sightingStatusSchema = z.object({
  status: z.enum(SIGHTING_STATUSES),
});

export const createAlertSchema = z.object({
  type: z.string().trim().min(1).max(50),
  title: shortText,
  message: z.string().trim().min(1).max(2000),
  caseId: z.string().trim().max(50).optional(),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const listCasesSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  gender: z.enum(GENDERS).optional(),
  state: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  ageMin: z.coerce.number().int().min(0).max(120).optional(),
  ageMax: z.coerce.number().int().min(0).max(120).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sortBy: z.enum(['recent', 'oldest', 'name']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});
