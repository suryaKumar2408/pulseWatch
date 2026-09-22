'use strict';

const { z } = require('zod');

const SUPPORTED_PERIODS = ['24h', '7d', '30d'];

const analyticsQuerySchema = z.object({
  period: z
    .enum(SUPPORTED_PERIODS, {
      errorMap: () => ({
        message: `Period must be one of: ${SUPPORTED_PERIODS.join(', ')}`,
      }),
    })
    .default('24h'),

  from: z
    .string()
    .datetime({ offset: true, message: 'from must be a valid ISO-8601 datetime' })
    .optional(),

  to: z
    .string()
    .datetime({ offset: true, message: 'to must be a valid ISO-8601 datetime' })
    .optional(),
}).refine(
  (data) => {
    if (data.from && data.to) {
      return new Date(data.from) < new Date(data.to);
    }
    return true;
  },
  {
    message: 'from date must be before to date',
    path: ['from'],
  }
);

module.exports = {
  SUPPORTED_PERIODS,
  analyticsQuerySchema,
};
