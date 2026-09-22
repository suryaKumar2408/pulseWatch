'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { createError } = require('./errorHandler');
const { isTokenRevoked } = require('../lib/tokenBlocklist');

/**
 * Express middleware that enforces JWT authentication.
 *
 * Reads the `Authorization: Bearer <token>` header.
 * On success, attaches `req.user = { id: <userId> }` and `req.token = token`, then calls next().
 * On failure, passes an appropriate error to the centralized error handler.
 */
async function requireAuth(req, _res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(createError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);

    if (!payload.sub) {
      return next(createError('Invalid token payload', 401, 'INVALID_TOKEN'));
    }

    const revoked = await isTokenRevoked(token);
    if (revoked) {
      return next(createError('Token has been revoked', 401, 'TOKEN_REVOKED'));
    }

    req.user = { id: payload.sub };
    req.token = token;
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(createError('Token has expired', 401, 'TOKEN_EXPIRED'));
    }
    return next(createError('Invalid or malformed token', 401, 'INVALID_TOKEN'));
  }
}

module.exports = { requireAuth };
