'use strict';

const { Router } = require('express');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { analyticsQuerySchema } = require('../lib/validators/analytics');
const { getUserAnalytics } = require('../analytics/analyticsService');

const router = Router();

router.use(requireAuth);

// ── GET /api/v1/analytics ─────────────────────────────────────────────────────
// Returns aggregated monitoring analytics across all monitors for the authenticated user

router.get('/', async (req, res) => {
  const { period, from, to } = analyticsQuerySchema.parse(req.query);

  const db = getDb();

  const analytics = await getUserAnalytics(db, {
    userId: req.user.id,
    period,
    from,
    to,
  });

  return res.json({
    data: analytics,
  });
});

module.exports = router;
