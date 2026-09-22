'use strict';

const pino = require('pino');
const config = require('../config');

/**
 * Application-wide structured logger.
 *
 * In development, pino-pretty makes output human-readable.
 * In production/test, plain JSON is emitted for log aggregators.
 */
const logger = pino({
  level: config.LOG_LEVEL,
  // Never log these keys in case they accidentally end up in an object
  redact: {
    paths: [
      'password',
      'token',
      'secret',
      'authorization',
      'cookie',
      'apiKey',
      'accessToken',
      'refreshToken',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.accessToken',
      '*.refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  ...(config.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

module.exports = logger;
