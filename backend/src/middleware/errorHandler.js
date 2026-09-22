'use strict';

const { ZodError } = require('zod');
const logger = require('../lib/logger');

/**
 * Centralized error handler middleware.
 *
 * Express calls this when next(err) is invoked or when an async route throws.
 * Must be registered LAST, after all routes.
 *
 * Error shape returned to clients:
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR",
 *     "message": "...",
 *     "details": [...] // only for validation errors
 *   },
 *   "requestId": "..."
 * }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';

  // ── Zod validation error ─────────────────────────────────────────────────
  if (err instanceof ZodError) {
    const details = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));

    logger.warn({ requestId, details }, 'Validation error');

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details,
      },
      requestId,
    });
  }

  // ── Known application error (set err.statusCode to expose to client) ──────
  if (err.statusCode) {
    logger.warn({ requestId, code: err.code, message: err.message }, 'Application error');

    return res.status(err.statusCode).json({
      error: {
        code: err.code || 'APPLICATION_ERROR',
        message: err.message,
      },
      requestId,
    });
  }

  // ── Unhandled / unexpected error ──────────────────────────────────────────
  logger.error({ requestId, err }, 'Unhandled error');

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    requestId,
  });
}

/**
 * Creates an application error with a HTTP status code attached.
 * @param {string} message - Human-readable message (safe to return to clients)
 * @param {number} statusCode - HTTP status code
 * @param {string} code - Machine-readable error code
 */
function createError(message, statusCode = 500, code = 'APPLICATION_ERROR') {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

module.exports = { errorHandler, createError };
