'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * Global rate limiter applied to all API routes.
 *
 * Uses a simple in-memory store for Stage 1.
 * In later stages this will be swapped for a Redis-backed store
 * (rate-limit-redis) to support multi-process deployments.
 */
const globalRateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,   // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,    // Disable X-RateLimit-* headers
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
    },
  },
  // Skip rate limiting in test environment
  skip: () => config.NODE_ENV === 'test',
});

/**
 * Stricter limiter for auth endpoints to slow brute-force attempts.
 */
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later',
    },
  },
  skip: () => config.NODE_ENV === 'test',
});

module.exports = { globalRateLimiter, authRateLimiter };
