'use strict';

const { z } = require('zod');

// ── Constants ─────────────────────────────────────────────────────────────────

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MONITOR_SORT_FIELDS = ['name', 'createdAt', 'updatedAt', 'status', 'lastCheckedAt'];

/**
 * Validates that a URL uses http or https.
 * Further SSRF validation is done asynchronously in the route handler.
 */
function isAllowedScheme(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Base object (no cross-field refinements) ──────────────────────────────────
// Keep as a plain ZodObject so .partial() works in updateMonitorSchema.

const monitorBaseSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(1, 'Name cannot be empty')
    .max(100, 'Name must be at most 100 characters'),

  url: z
    .string({ required_error: 'URL is required' })
    .url('Must be a valid URL')
    .refine(isAllowedScheme, 'URL must use http or https'),

  method: z.enum(HTTP_METHODS, {
    errorMap: () => ({ message: `Method must be one of: ${HTTP_METHODS.join(', ')}` }),
  }).default('GET'),

  intervalSeconds: z
    .number({ invalid_type_error: 'Interval must be a number' })
    .int('Interval must be a whole number')
    .min(30, 'Minimum interval is 30 seconds')
    .max(86_400, 'Maximum interval is 86400 seconds (24 hours)')
    .default(60),

  timeoutSeconds: z
    .number({ invalid_type_error: 'Timeout must be a number' })
    .int('Timeout must be a whole number')
    .min(1, 'Minimum timeout is 1 second')
    .max(30, 'Maximum timeout is 30 seconds')
    .default(10),

  expectedCodes: z
    .array(
      z
        .number({ invalid_type_error: 'Status codes must be numbers' })
        .int()
        .min(100, 'Status codes must be between 100 and 599')
        .max(599, 'Status codes must be between 100 and 599'),
    )
    .min(1, 'At least one expected status code is required')
    .max(20, 'At most 20 expected status codes allowed')
    .default([200]),

  enabled: z.boolean().default(true),
});

// ── Create ────────────────────────────────────────────────────────────────────

const createMonitorSchema = monitorBaseSchema.refine(
  (data) => data.timeoutSeconds < data.intervalSeconds,
  {
    message: 'Timeout must be less than the monitoring interval',
    path: ['timeoutSeconds'],
  },
);

// ── Update ────────────────────────────────────────────────────────────────────
// All fields optional (PATCH semantics). Same constraints as create.
// Health-tracking fields (status, consecutiveFailures, etc.) are NOT exposed here.

const updateMonitorSchema = monitorBaseSchema
  .partial()
  .refine(
    (data) => {
      // Only validate timeout < interval when both are provided in the same request
      if (data.timeoutSeconds !== undefined && data.intervalSeconds !== undefined) {
        return data.timeoutSeconds < data.intervalSeconds;
      }
      return true;
    },
    {
      message: 'Timeout must be less than the monitoring interval',
      path: ['timeoutSeconds'],
    },
  );


// ── List query ────────────────────────────────────────────────────────────────

const listMonitorsSchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive('Page must be a positive integer')
    .default(1),

  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit must be at most 100')
    .default(20),

  status: z.enum(['UNKNOWN', 'UP', 'DOWN']).optional(),

  // Accept "true" / "false" strings from query params
  enabled: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),

  sort: z.enum(MONITOR_SORT_FIELDS).default('createdAt'),

  order: z.enum(['asc', 'desc']).default('desc'),
});

module.exports = { createMonitorSchema, updateMonitorSchema, listMonitorsSchema };
