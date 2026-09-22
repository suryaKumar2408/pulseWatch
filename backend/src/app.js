'use strict';

// Patch Express to forward async errors to the centralized error handler.
// Must be required before any route definitions.
require('express-async-errors');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');

const config = require('./config');
const logger = require('./lib/logger');
const requestIdMiddleware = require('./middleware/requestId');
const { globalRateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

const healthRouter    = require('./routes/health');
const authRouter      = require('./routes/auth');
const monitorsRouter    = require('./routes/monitors');
const incidentsRouter   = require('./routes/incidents');
const notificationsRouter = require('./routes/notifications');
const analyticsRouter     = require('./routes/analytics');

/**
 * Creates and configures the Express application.
 * Exported as a factory to allow clean instantiation in tests.
 */
function createApp() {
  const app = express();

  // ── Security headers ────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      hidePoweredBy: true,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    })
  );

  // ── CORS ────────────────────────────────────────────────────────────────
  const allowedOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    })
  );

  // ── Request ID ──────────────────────────────────────────────────────────
  app.use(requestIdMiddleware);

  // ── HTTP request logging ────────────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      // Attach request ID to each log line
      genReqId: (req) => req.id,
      // Redact Authorization header values from request logs
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // Skip health check logging in production to reduce noise
      autoLogging: {
        ignore: (req) =>
          config.NODE_ENV === 'production' && req.url === '/api/health',
      },
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  // ── Rate limiting ────────────────────────────────────────────────────────
  app.use('/api', globalRateLimiter);

  // ── Body parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false, limit: '512kb' }));

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use('/api/health', healthRouter);

  // Versioned API
  app.use('/api/v1/auth',          authRouter);
  app.use('/api/v1/monitors',      monitorsRouter);
  app.use('/api/v1/incidents',     incidentsRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/analytics',     analyticsRouter);

  // ── 404 handler ──────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource does not exist',
      },
    });
  });

  // ── Centralized error handler ────────────────────────────────────────────
  // Must be the last middleware registered
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
