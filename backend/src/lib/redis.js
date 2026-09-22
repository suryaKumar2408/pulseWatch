'use strict';

const Redis = require('ioredis');
const config = require('../config');
const logger = require('./logger');

let redisClient;

/**
 * Returns the singleton ioredis client.
 * BullMQ queues will share this connection factory via separate dedicated connections.
 */
function getRedis() {
  if (redisClient) return redisClient;

  redisClient = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,    // Faster startup
    lazyConnect: true,
  });

  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  redisClient.on('ready', () => {
    logger.debug('Redis ready');
  });

  redisClient.on('error', (err) => {
    // Log but don't crash — ioredis will reconnect automatically
    logger.error({ err }, 'Redis error');
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  redisClient.on('reconnecting', (ms) => {
    logger.warn({ retryDelay: ms }, 'Redis reconnecting');
  });

  return redisClient;
}

/**
 * Disconnects Redis. Called during graceful shutdown.
 */
async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

/**
 * Pings Redis to verify connectivity.
 * @returns {Promise<boolean>}
 */
async function pingRedis() {
  try {
    const reply = await getRedis().ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Returns connection options object for BullMQ queues and workers.
 * BullMQ instantiates its own dedicated Redis connections using these options.
 * @returns {object}
 */
function getRedisConnectionOptions() {
  try {
    const parsed = new URL(config.REDIS_URL);
    const dbStr = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    const db = dbStr ? parseInt(dbStr, 10) : undefined;

    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      ...(db !== undefined && !isNaN(db) ? { db } : {}),
      maxRetriesPerRequest: null,
    };
  } catch {
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

module.exports = { getRedis, disconnectRedis, pingRedis, getRedisConnectionOptions };
