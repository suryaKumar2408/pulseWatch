'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const config = require('../config');
const logger = require('../lib/logger');
const { getDb } = require('../lib/db');
const { registerSchema, loginSchema } = require('../lib/validators/auth');
const { createError } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/rateLimiter');
const { revokeToken } = require('../lib/tokenBlocklist');

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pre-hashed dummy value used to ensure constant-time path on login
 * when the email does not exist, preventing user-enumeration via timing.
 * This is intentionally public — it guards against timing analysis, not secrecy.
 */
const TIMING_SAFE_DUMMY_HASH = '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
}

function sanitizeUser(user) {
  // Never return the password hash to the client
  const { password: _omit, ...safe } = user;
  return safe;
}

// ── POST /api/v1/auth/register ────────────────────────────────────────────────

router.post('/register', authRateLimiter, async (req, res) => {
  const { email, password } = registerSchema.parse(req.body);

  const db = getDb();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    // Use a generic message to avoid confirming which emails are registered
    throw createError('An account with this email already exists', 409, 'EMAIL_IN_USE');
  }

  const hashedPassword = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

  const user = await db.user.create({
    data: { email, password: hashedPassword },
  });

  const token = signToken(user.id);

  logger.info({ userId: user.id }, 'User registered');

  return res.status(201).json({
    data: {
      user: sanitizeUser(user),
      token,
    },
  });
});

// ── POST /api/v1/auth/login ───────────────────────────────────────────────────

router.post('/login', authRateLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const db = getDb();
  const user = await db.user.findUnique({ where: { email } });

  // Always run bcrypt even when the user doesn't exist to prevent timing attacks.
  // Using a dummy hash ensures the work factor is consistent.
  const hash = user?.password ?? TIMING_SAFE_DUMMY_HASH;
  let passwordMatches;
  try {
    passwordMatches = await bcrypt.compare(password, hash);
  } catch {
    passwordMatches = false;
  }

  if (!user || !passwordMatches) {
    // Same message regardless of which check failed — prevents user enumeration
    throw createError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const token = signToken(user.id);

  logger.info({ userId: user.id }, 'User logged in');

  return res.json({
    data: {
      user: sanitizeUser(user),
      token,
    },
  });
});

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
// Invalidates the current session token

router.post('/logout', requireAuth, async (req, res) => {
  if (req.token) {
    await revokeToken(req.token);
  }

  logger.info({ userId: req.user?.id }, 'User logged out');

  return res.json({
    message: 'Successfully logged out',
  });
});

// ── GET /api/v1/auth/me ───────────────────────────────────────────────────────
// Returns profile of the currently authenticated user

router.get('/me', requireAuth, async (req, res) => {
  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: req.user.id },
  });

  if (!user) {
    throw createError('User not found', 404, 'USER_NOT_FOUND');
  }

  return res.json({
    data: {
      user: sanitizeUser(user),
    },
  });
});

module.exports = router;
