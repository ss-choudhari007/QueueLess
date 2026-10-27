// ─────────────────────────────────────────────────────────────
// Input validation with zod. Every route parses its input through one of
// these schemas before touching the database.
// ─────────────────────────────────────────────────────────────
import { z } from 'zod';
import { badRequest } from './errors.js';
import { ORG_CATEGORIES } from './constants.js';
import { isValidTimeZone, timeToMinutes } from './time.js';

export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.values(fields)[0];
    throw badRequest(first || 'Invalid input.', { fields });
  }
  return result.data;
}

const trimmed = (min, max, label) =>
  z
    .string({ error: (issue) => (issue.input === undefined ? `${label} is required.` : `${label} must be text.`) })
    .trim()
    .min(min, min === 1 ? `${label} is required.` : `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

const optionalText = (max, label) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const uuid = z.uuid('Invalid identifier.');
export const email = z
  .string({ error: (issue) => (issue.input === undefined ? 'Email is required.' : 'Email must be text.') })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .pipe(z.email('Enter a valid email address.'));
export const password = z
  .string({ error: (issue) => (issue.input === undefined ? 'Password is required.' : 'Password must be text.') })
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.');
const personName = trimmed(2, 80, 'Name');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD date format.');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the HH:MM 24-hour format.');

// Field sets shared by create and update. Defaults are attached only to the
// create schemas: zod 4 applies defaults inside .partial(), so an update
// schema with defaults would silently overwrite fields a PATCH did not send.
const orgFields = {
  name: trimmed(2, 100, 'Organization name'),
  category: z.enum(ORG_CATEGORIES, { error: 'Choose a valid category.' }),
  description: optionalText(1000, 'Description'),
  address: optionalText(200, 'Address'),
  city: optionalText(60, 'City'),
  phone: optionalText(30, 'Phone'),
  email: email.nullable().optional().or(z.literal('').transform(() => null)),
  timezone: z.string().refine(isValidTimeZone, 'Choose a valid timezone.'),
};

const serviceFields = {
  name: trimmed(2, 80, 'Service name'),
  description: optionalText(500, 'Description'),
  tokenPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,4}$/, 'Token prefix must be 1–4 letters.'),
  avgDurationMinutes: z.coerce.number().int().min(1, 'Minimum 1 minute.').max(240, 'Maximum 240 minutes.'),
  maxDailyTokens: z.coerce.number().int().min(1).max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const schemas = {
  register: z.object({
    name: personName,
    email,
    password,
    accountType: z.enum(['CUSTOMER', 'OWNER']).default('CUSTOMER'),
  }),
  login: z.object({ email, password: z.string().min(1, 'Password is required.').max(128) }),

  orgQuery: z.object({
    search: z.string().trim().max(80).optional(),
    category: z.enum(ORG_CATEGORIES).optional().or(z.literal('').transform(() => undefined)),
    city: z.string().trim().max(60).optional(),
    openNow: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
  }),

  weeklyHours: z
    .array(
      z
        .object({ closed: z.boolean(), open: hhmm, close: hhmm })
        .refine((d) => d.closed || timeToMinutes(d.close) > timeToMinutes(d.open), {
          message: 'Closing time must be after opening time.',
          path: ['close'],
        })
    )
    .length(7, 'Provide hours for all 7 days.'),

  invite: z.object({ email, role: z.enum(['STAFF', 'SUPERVISOR']).default('STAFF') }),
  inviteToken: z.object({ token: z.string().min(20).max(200) }),
  inviteAcceptNew: z.object({ token: z.string().min(20).max(200), name: personName, password }),
  membershipUpdate: z.object({ role: z.enum(['STAFF', 'SUPERVISOR']) }),

  join: z.object({ serviceId: uuid }),
  historyQuery: z.object({
    status: z.enum(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'WAITING', 'CALLED', 'SERVING']).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  }),

  staffQueueQuery: z.object({ serviceId: uuid.optional() }),
  pause: z.object({ paused: z.boolean() }),
  verifyArrival: z.union([
    z.object({ payload: z.string().trim().min(10).max(300) }),
    z.object({
      tokenId: uuid,
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{6}$/, 'The manual code has 6 characters.'),
    }),
  ]),
  correction: z.object({ reason: trimmed(3, 300, 'Reason') }),

  analyticsQuery: z.object({
    from: dateString.optional(),
    to: dateString.optional(),
    serviceId: uuid.optional(),
  }),
};

schemas.orgCreate = z.object({ ...orgFields, timezone: orgFields.timezone.default('Asia/Kolkata') });
schemas.orgUpdate = z.object(orgFields).partial().extend({ isActive: z.boolean().optional() });
schemas.settingsUpdate = z.object({
  maxDailyTokens: z.coerce.number().int().min(1).max(1000).optional(),
  noShowGracePeriodMinutes: z.coerce.number().int().min(1).max(30).optional(),
  qrTtlSeconds: z.coerce.number().int().min(30).max(600).optional(),
  weeklyHours: schemas.weeklyHours.optional(),
});
schemas.serviceCreate = z.object({
  ...serviceFields,
  tokenPrefix: serviceFields.tokenPrefix.default('A'),
  avgDurationMinutes: serviceFields.avgDurationMinutes.default(10),
});
schemas.serviceUpdate = z.object(serviceFields).partial();
