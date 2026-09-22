'use strict';

const { z } = require('zod');

/**
 * Validates and transforms a date string into a Date object.
 */
const dateQuerySchema = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), {
    message: 'Must be a valid ISO 8601 date string',
  })
  .transform((val) => new Date(val));

const listChecksSchema = z.object({
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

  // Query strings pass 'true' / 'false'
  success: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),

  from: dateQuerySchema.optional(),

  to: dateQuerySchema.optional(),

  order: z.enum(['asc', 'desc']).default('desc'),
});

module.exports = { listChecksSchema };
