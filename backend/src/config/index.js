'use strict';

require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  // ── Server ─────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // ── Database ───────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().url(),

  // ── Redis ──────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().url(),

  // ── CORS ───────────────────────────────────────────────────────────────────
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // ── Authentication ─────────────────────────────────────────────────────────
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // ── Rate Limiting ──────────────────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // ── Worker & Queue Concurrency ────────────────────────────────────────────
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(50),
  ENABLE_BACKGROUND_WORKER: z
    .preprocess((v) => v !== 'false' && v !== '0' && v !== false, z.boolean())
    .default(true),
  ENABLE_SCHEDULER: z
    .preprocess((v) => v !== 'false' && v !== '0' && v !== false, z.boolean())
    .default(true),
  SCHEDULER_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  // ── Security ───────────────────────────────────────────────────────────────
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    // Use process.stderr directly — logger not yet available at config load time
    process.stderr.write(`\nConfiguration error — missing or invalid env vars:\n${formatted}\n\n`);
    process.exit(1);
  }

  return result.data;
}

// Singleton: loaded once at startup, reused across the application.
const config = loadConfig();

module.exports = config;
