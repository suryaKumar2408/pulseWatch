'use strict';

/**
 * Health Check Queue
 *
 * Manages the BullMQ queue for background health check jobs.
 * Enforces retry strategies with exponential backoff for infrastructure failures.
 */

const { Queue } = require('bullmq');
const { getRedisConnectionOptions } = require('../lib/redis');
const logger = require('../lib/logger');

const QUEUE_NAME = 'health-checks';

const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
});

let healthCheckQueue;

/**
 * Returns or initializes the BullMQ health-check queue.
 * @param {object} [options]
 * @param {object} [options.connection] Custom Redis connection options
 * @returns {Queue}
 */
function getHealthCheckQueue(options = {}) {
  if (healthCheckQueue) return healthCheckQueue;

  const connection = options.connection ?? getRedisConnectionOptions();

  healthCheckQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  healthCheckQueue.on('error', (err) => {
    logger.error({ err, queue: QUEUE_NAME }, 'Health check queue error');
  });

  return healthCheckQueue;
}

/**
 * Enqueues a health check job for a specific monitor.
 *
 * @param {string} monitorId
 * @param {object} [options]
 * @param {string} [options.jobId] Optional custom job ID for deduplication
 * @param {boolean} [options.deduplicate] When true, uses a deterministic jobId to prevent duplicate in-flight jobs
 * @param {Queue} [options.queue] Injected queue instance (e.g. for testing)
 * @returns {Promise<Job>}
 */
async function enqueueHealthCheck(monitorId, options = {}) {
  if (!monitorId || typeof monitorId !== 'string') {
    throw new Error('monitorId is required and must be a string');
  }

  const queue = options.queue ?? getHealthCheckQueue();

  const jobId = options.jobId ?? (options.deduplicate ? `check:${monitorId}` : undefined);

  const job = await queue.add(
    'check-monitor',
    { monitorId },
    {
      jobId,
      ...options.jobOptions,
    },
  );

  logger.debug({ monitorId, jobId: job.id }, 'Health check job enqueued');

  return job;
}

/**
 * Closes the health check queue instance cleanly.
 */
async function closeHealthCheckQueue() {
  if (healthCheckQueue) {
    await healthCheckQueue.close();
    healthCheckQueue = null;
  }
}

module.exports = {
  QUEUE_NAME,
  DEFAULT_JOB_OPTIONS,
  getHealthCheckQueue,
  enqueueHealthCheck,
  closeHealthCheckQueue,
};
