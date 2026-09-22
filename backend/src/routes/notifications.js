'use strict';

const { Router } = require('express');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { createError } = require('../middleware/errorHandler');
const { listNotificationsSchema } = require('../lib/validators/notification');
const { retryNotification } = require('../notifications/notificationService');

const router = Router();

router.use(requireAuth);

// ── GET /api/v1/notifications ─────────────────────────────────────────────────
// Returns notifications across all monitors belonging to the authenticated user

router.get('/', async (req, res) => {
  const { page, limit, status, event, order } = listNotificationsSchema.parse(req.query);

  const db = getDb();

  const where = {
    userId: req.user.id,
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
      include: {
        monitor: {
          select: {
            id: true,
            name: true,
            url: true,
          },
        },
      },
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

// ── POST /api/v1/notifications/:id/retry ──────────────────────────────────────
// Re-triggers delivery for a failed notification

router.post('/:id/retry', async (req, res) => {
  const db = getDb();

  const notification = await db.notification.findUnique({
    where: { id: req.params.id },
  });

  if (!notification || notification.userId !== req.user.id) {
    throw createError('Notification not found', 404, 'NOT_FOUND');
  }

  if (notification.status === 'DELIVERED') {
    throw createError(
      'Notification has already been delivered',
      400,
      'NOTIFICATION_ALREADY_DELIVERED'
    );
  }

  const result = await retryNotification(notification.id, { db });

  return res.json({ data: result.notification, delivered: result.delivered });
});

module.exports = router;
