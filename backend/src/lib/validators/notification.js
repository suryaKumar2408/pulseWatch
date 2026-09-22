'use strict';

const { z } = require('zod');

const listNotificationsSchema = z.object({
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

  status: z.enum(['PENDING', 'DELIVERED', 'FAILED']).optional(),

  event: z.enum(['MONITOR_DOWN', 'MONITOR_RECOVERED']).optional(),

  order: z.enum(['asc', 'desc']).default('desc'),
});

module.exports = { listNotificationsSchema };
