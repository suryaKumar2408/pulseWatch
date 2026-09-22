'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('./logger');
const { getRedis } = require('./redis');

// In-memory fallback blocklist: Map<tokenHash, expiryTimestampMs>
const memoryBlocklist = new Map();

/**
 * Computes a SHA-256 hash of the token for compact and safe storage in Redis/memory.
 * @param {string} token
 * @returns {string}
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Periodically cleans up expired entries from the in-memory blocklist.
 */
function cleanupMemoryBlocklist() {
  const now = Date.now();
  for (const [hash, expMs] of memoryBlocklist.entries()) {
    if (expMs <= now) {
      memoryBlocklist.delete(hash);
    }
  }
}

/**
 * Revokes a JWT by adding its hash to the Redis blocklist and local memory store.
 * TTL is set to the remaining lifetime of the token.
 *
 * @param {string} token
 * @returns {Promise<void>}
 */
async function revokeToken(token) {
  if (!token || typeof token !== 'string') return;

  const tokenHash = hashToken(token);
  let remainingSeconds = 3600; // default fallback

  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      const remainingMs = decoded.exp * 1000 - Date.now();
      remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    }
  } catch {
    // If token cannot be decoded, use fallback TTL
  }

  // Record in memory fallback
  memoryBlocklist.set(tokenHash, Date.now() + remainingSeconds * 1000);
  cleanupMemoryBlocklist();

  // Record in Redis if available
  try {
    const redis = getRedis();
    if (redis && typeof redis.set === 'function') {
      await redis.set(`auth:revoked:${tokenHash}`, '1', 'EX', remainingSeconds);
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Redis token revocation set failed; retained in memory store');
  }
}

/**
 * Checks whether a given JWT has been revoked.
 *
 * @param {string} token
 * @returns {Promise<boolean>}
 */
async function isTokenRevoked(token) {
  if (!token || typeof token !== 'string') return false;

  const tokenHash = hashToken(token);

  // Check in-memory store
  const expMs = memoryBlocklist.get(tokenHash);
  if (expMs) {
    if (expMs > Date.now()) {
      return true;
    }
    memoryBlocklist.delete(tokenHash);
  }

  // Check Redis store
  try {
    const redis = getRedis();
    if (redis && typeof redis.get === 'function') {
      const result = await redis.get(`auth:revoked:${tokenHash}`);
      if (result) {
        memoryBlocklist.set(tokenHash, Date.now() + 300_000);
        return true;
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Redis token check failed; fallback to memory store');
  }

  return false;
}

/**
 * Clears the in-memory blocklist. Useful for resetting state between tests.
 */
function clearBlocklist() {
  memoryBlocklist.clear();
}

module.exports = {
  hashToken,
  revokeToken,
  isTokenRevoked,
  clearBlocklist,
};
