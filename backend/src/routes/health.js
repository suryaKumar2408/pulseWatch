'use strict';

const { Router } = require('express');
const { pingDb } = require('../lib/db');
const { pingRedis } = require('../lib/redis');

const router = Router();

/**
 * GET /api/health/live
 * Liveness probe: returns 200 as long as the Express process is running.
 */
router.get('/live', (_req, res) => {
  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health/ready
 * Readiness probe: returns 200 if dependencies (database, Redis) are ready for traffic, 503 otherwise.
 */
router.get('/ready', async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);
  const ready = dbOk && redisOk;

  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    database: dbOk ? 'ok' : 'unavailable',
    redis: redisOk ? 'ok' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/health
 * Full diagnostic health check.
 */
router.get('/', async (req, res) => {
  const [dbOk, redisOk] = await Promise.all([pingDb(), pingRedis()]);

  const healthy = dbOk && redisOk;
  const status = healthy ? 'ok' : 'degraded';

  const body = {
    status,
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    services: {
      database: dbOk ? 'ok' : 'unavailable',
      redis: redisOk ? 'ok' : 'unavailable',
    },
    requestId: req.id,
  };

  return res.status(healthy ? 200 : 503).json(body);
});

module.exports = router;
