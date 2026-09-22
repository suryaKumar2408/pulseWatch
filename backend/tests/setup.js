'use strict';

/**
 * Test environment setup.
 * Loaded via jest.config.js `setupFiles` before each test file.
 *
 * Sets required env vars so that the config module validates successfully
 * without a real .env file during testing.
 */

// Minimal valid env for config/index.js validation
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/pulsewatch_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.JWT_SECRET = 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.JWT_EXPIRES_IN = '1h';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '100';
process.env.BCRYPT_ROUNDS = '10';
