'use strict';

const { Router } = require('express');
const { getDb } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { listIncidentsSchema } = require('../lib/validators/incident');

const router = Router();

router.use(requireAuth);

// ── GET /api/v1/incidents ─────────────────────────────────────────────────────
// Returns incidents across all monitors belonging to the authenticated user

router.get('/', async (req, res) => {
  const { page, limit, status, monitorId, order } = listIncidentsSchema.parse(req.query);

  const db = getDb();

  const where = {
    userId: req.user.id,
  };

  if (status !== undefined) {
    where.status = status;
  }

  if (monitorId !== undefined) {
    where.monitorId = monitorId;
  }

  const skip = (page - 1) * limit;

  const [incidents, total] = await Promise.all([
    db.incident.findMany({
      where,
      orderBy: { startedAt: order },
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
  
  // ── GET /api/v1/incidents/:id ──────────────────────────────────────────────────
  router.get('/:id', async (req, res) => {
  const db = getDb();
  const incident = await db.incident.findFirst({
    where: { id: req.params.id, userId: req.user.id },
    include: {
      monitor: {
        select: {
          id: true,
          name: true,
          url: true,
        },
      },
      notifications: true,
    },
  });

  if (!incident) {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Incident not found',
      },
    });
  }

  return res.json({ data: incident });
});

module.exports = router;
