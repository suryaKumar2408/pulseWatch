'use strict';

const { randomUUID } = require('crypto');

/**
 * Middleware that attaches a unique request ID to every incoming request.
 *
 * Reads X-Request-Id from the client if present (e.g. from a reverse proxy),
 * otherwise generates a new UUID. The ID is available as req.id and echoed
 * back in the X-Request-Id response header for tracing.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;
