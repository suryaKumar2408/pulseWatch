'use strict';

const { Router } = require('express');

const logger = require('../lib/logger');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { createMonitorSchema, updateMonitorSchema, listMonitorsSchema } = require('../lib/validators/monitor');
const { listChecksSchema } = require('../lib/validators/check');
const { listIncidentsSchema } = require('../lib/validators/incident');
const { listNotificationsSchema } = require('../lib/validators/notification');
const { analyticsQuerySchema } = require('../lib/validators/analytics');
const { getMonitorAnalytics } = require('../analytics/analyticsService');
const { validateUrlSsrf } = require('../lib/ssrf');

const router = Router();

// All monitor routes require authentication.
// req.user.id is set by requireAuth and scopes every query.
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Runs SSRF validation and throws a structured 400 error on failure.
 * Accepts the same options object as validateUrlSsrf (used to inject mocks in tests).
 */
async function assertUrlSafe(url, ssrfOptions) {
  const result = await validateUrlSsrf(url, ssrfOptions);
  if (!result.safe) {
    throw createError(
      `URL rejected by security policy: ${result.reason}`,
      400,
      'SSRF_BLOCKED',
    );
  }
}

/**
 * Fetches a monitor owned by the requesting user, or throws 404.
 */
async function requireMonitorOwnership(db, monitorId, userId) {
  const monitor = await db.monitor.findFirst({
    where: { id: monitorId, userId },
  });
  if (!monitor) {
    throw createError('Monitor not found', 404, 'NOT_FOUND');
  }
  return monitor;
}

// ── POST /api/v1/monitors ─────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const data = createMonitorSchema.parse(req.body);

  await assertUrlSafe(data.url);

  const db = getDb();
  const monitor = await db.monitor.create({
    data: {
      ...data,
      userId: req.user.id,
    },
  });

  logger.info({ monitorId: monitor.id, userId: req.user.id }, 'Monitor created');

  return res.status(201).json({ data: monitor });
});

// ── GET /api/v1/monitors ──────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { page, limit, status, enabled, sort, order } = listMonitorsSchema.parse(req.query);

  const where = { userId: req.user.id };
  if (status !== undefined) where.status = status;
  if (enabled !== undefined) where.enabled = enabled;

  const skip = (page - 1) * limit;

  const db = getDb();
  const [monitors, total] = await Promise.all([
    db.monitor.findMany({
      where,
      orderBy: { [sort]: order },
      skip,
      take: limit,
    }),
    db.monitor.count({ where }),
  ]);

  return res.json({
    data: monitors,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── GET /api/v1/monitors/:id ──────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const db = getDb();
  const monitor = await requireMonitorOwnership(db, req.params.id, req.user.id);
  return res.json({ data: monitor });
});

// ── GET /api/v1/monitors/:id/checks (and /history) ─────────────────────────────

async function handleGetChecks(req, res) {
  const { page, limit, success, from, to, order } = listChecksSchema.parse(req.query);

  const db = getDb();
  // Ensure the monitor exists and is owned by the authenticated user
  const monitor = await requireMonitorOwnership(db, req.params.id, req.user.id);

  const where = {
    monitorId: monitor.id,
  };

  if (success !== undefined) {
    where.success = success;
  }

  if (from || to) {
    where.checkedAt = {};
    if (from) where.checkedAt.gte = from;
    if (to) where.checkedAt.lte = to;
  }

  const skip = (page - 1) * limit;

  const [checks, total] = await Promise.all([
    db.checkResult.findMany({
      where,
      orderBy: { checkedAt: order },
      skip,
      take: limit,
    }),
    db.checkResult.count({ where }),
  ]);

  return res.json({
    data: checks,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

router.get('/:id/checks', handleGetChecks);
router.get('/:id/history', handleGetChecks);

// ── GET /api/v1/monitors/:id/incidents ────────────────────────────────────────

router.get('/:id/incidents', async (req, res) => {
  const { page, limit, status, order } = listIncidentsSchema.parse(req.query);

  const db = getDb();
  // Ensure the monitor exists and is owned by the authenticated user
  const monitor = await requireMonitorOwnership(db, req.params.id, req.user.id);

  const where = {
    monitorId: monitor.id,
  };

  if (status !== undefined) {
    where.status = status;
  }

  const skip = (page - 1) * limit;

  const [incidents, total] = await Promise.all([
    db.incident.findMany({
      where,
      orderBy: { startedAt: order },
      skip,
      take: limit,
    }),
    db.incident.count({ where }),
  ]);

  return res.json({
    data: incidents,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── GET /api/v1/monitors/:id/notifications ────────────────────────────────────

router.get('/:id/notifications', async (req, res) => {
  const { page, limit, status, event, order } = listNotificationsSchema.parse(req.query);

  const db = getDb();
  // Ownership verification
  const monitor = await requireMonitorOwnership(db, req.params.id, req.user.id);

  const where = {
    monitorId: monitor.id,
  };

  if (status !== undefined) where.status = status;
  if (event !== undefined)  where.event  = event;

  const skip = (page - 1) * limit;

  const [notifications, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: order },
      skip,
      take: limit,
    }),
    db.notification.count({ where }),
  ]);

  return res.json({
    data: notifications,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ── GET /api/v1/monitors/:id/analytics ────────────────────────────────────────

router.get('/:id/analytics', async (req, res) => {
  const { period, from, to } = analyticsQuerySchema.parse(req.query);

  const db = getDb();
  // Ownership check
  const monitor = await requireMonitorOwnership(db, req.params.id, req.user.id);

  const analytics = await getMonitorAnalytics(db, {
    monitorId: monitor.id,
    period,
    from,
    to,
  });

  return res.json({
    data: analytics,
  });
});

// ── PATCH /api/v1/monitors/:id ────────────────────────────────────────────────

router.patch('/:id', async (req, res) => {
  const data = updateMonitorSchema.parse(req.body);

  // Validate new URL if being changed
  if (data.url !== undefined) {
    await assertUrlSafe(data.url);
  }

  const db = getDb();

  // Ownership check — ensures we update only records owned by this user
  const existing = await requireMonitorOwnership(db, req.params.id, req.user.id);

  // Validate cross-field constraints between incoming updates and existing values
  const effectiveTimeout = data.timeoutSeconds ?? existing.timeoutSeconds;
  const effectiveInterval = data.intervalSeconds ?? existing.intervalSeconds;
  if (effectiveTimeout >= effectiveInterval) {
    throw createError(
      'Timeout must be less than the monitoring interval',
      400,
      'VALIDATION_ERROR'
    );
  }

  const monitor = await db.monitor.update({
    where: { id: req.params.id },
    data,
  });

  logger.info({ monitorId: monitor.id, userId: req.user.id }, 'Monitor updated');

  return res.json({ data: monitor });
});

// ── DELETE /api/v1/monitors/:id ───────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const db = getDb();

  // Ownership check before deletion
  await requireMonitorOwnership(db, req.params.id, req.user.id);

  await db.monitor.delete({ where: { id: req.params.id } });

  logger.info({ monitorId: req.params.id, userId: req.user.id }, 'Monitor deleted');

  return res.status(204).send();
});

module.exports = router;
