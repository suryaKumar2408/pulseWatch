'use strict';

/**
 * Health Check Background Worker
 *
 * Pulls health check jobs from the queue and executes them with controlled concurrency.
 *
 * Separation of concerns:
 *  - Monitoring failures (target down, 500, timeout) are business telemetry:
 *    they are saved as CheckResults and update monitor health counters. The job completes successfully.
 *  - Background processing failures (database down, Redis disconnect, unhandled exceptions)
 *    are infrastructure errors: they throw and trigger BullMQ's automatic retry mechanism with backoff.
 */

const { Worker } = require('bullmq');
const { QUEUE_NAME } = require('./healthCheckQueue');
const { getRedisConnectionOptions } = require('../lib/redis');
const { getDb } = require('../lib/db');
const { checkMonitor } = require('../lib/checker');
const { processCheckResult } = require('../lib/stateManager');
const { validateUrlSsrf } = require('../lib/ssrf');
const { dispatchStateChangeNotification } = require('../notifications/notificationService');
const config = require('../config');
const logger = require('../lib/logger');

const DEFAULT_CONCURRENCY = 10;

/**
 * Core job processing logic.
 * Exported independently with dependency injection so it can be thoroughly unit-tested
 * without requiring live Redis or network dependencies.
 *
 * @param {object} job BullMQ job object
 * @param {object} [dependencies] Injected dependencies for testing
 * @returns {Promise<object>} Processing outcome
 */
async function processMonitorCheckJob(job, dependencies = {}) {
  const { monitorId } = job.data;
  if (!monitorId) {
    throw new Error('Invalid job: missing monitorId');
  }

  const db           = dependencies.db ?? getDb();
  const checkFn      = dependencies.checkMonitor ?? checkMonitor;
  const stateFn      = dependencies.processCheckResult ?? processCheckResult;
  const ssrfValidate = dependencies.validateUrlSsrf ?? validateUrlSsrf;

  // 1. Fetch fresh monitor configuration
  const monitor = await db.monitor.findUnique({
    where: { id: monitorId },
  });

  // If the monitor was deleted while queued, complete without failure
  if (!monitor) {
    logger.warn({ monitorId, jobId: job.id }, 'Health check skipped: monitor not found (deleted)');
    return { skipped: true, reason: 'MONITOR_NOT_FOUND', monitorId };
  }

  // If the monitor was disabled while queued, skip execution
  if (!monitor.enabled) {
    logger.info({ monitorId, jobId: job.id }, 'Health check skipped: monitor is disabled');
    return { skipped: true, reason: 'MONITOR_DISABLED', monitorId };
  }

  // 2. SSRF check before making any outbound HTTP request
  const ssrfResult = await ssrfValidate(monitor.url);
  let checkResult;

  if (!ssrfResult.safe) {
    checkResult = {
      success:        false,
      statusCode:     null,
      responseTimeMs: null,
      errorCode:      'SSRF_BLOCKED',
      errorMessage:   `Target URL blocked by SSRF policy: ${ssrfResult.reason}`,
      checkedAt:      new Date(),
    };
  } else {
    // 3. Execute HTTP health check against target
    // Note: checkMonitor never throws — it returns structured success or failure
    checkResult = await checkFn(monitor);
  }

  // 4. Update monitor state and persist check result in PostgreSQL
  // Note: Database errors will throw here and trigger BullMQ job retry
  const stateOutcome = await stateFn(monitor.id, checkResult, { db });

  // 5. Trigger notification on state transition (outage or recovery)
  let notificationOutcome = null;
  if (stateOutcome.hasTransition) {
    const notifyFn = dependencies.dispatchStateChangeNotification ?? dispatchStateChangeNotification;
    try {
      notificationOutcome = await notifyFn({
        monitor:     stateOutcome.monitor ?? monitor,
        transition:  stateOutcome.transition,
        incident:    stateOutcome.incident,
        checkResult,
        db,
        registry:    dependencies.registry,
      });
    } catch (notifErr) {
      // Fault isolation: notification errors must NEVER break monitoring or fail the job
      logger.error(
        { err: notifErr.message, monitorId: monitor.id },
        'Notification dispatch unexpected error — monitoring unaffected',
      );
    }
  }

  logger.debug(
    {
      monitorId:      monitor.id,
      success:        checkResult.success,
      statusCode:     checkResult.statusCode,
      responseTimeMs: checkResult.responseTimeMs,
      currentStatus:  stateOutcome.currentStatus,
      hasTransition:  stateOutcome.hasTransition,
    },
    'Health check job completed',
  );

  return {
    outcome:        'PROCESSED',
    monitorId:      monitor.id,
    success:        checkResult.success,
    statusCode:     checkResult.statusCode,
    responseTimeMs: checkResult.responseTimeMs,
    errorCode:      checkResult.errorCode,
    status:         stateOutcome.currentStatus,
    previousStatus: stateOutcome.previousStatus,
    hasTransition:  stateOutcome.hasTransition,
    transition:     stateOutcome.transition,
    incident:       stateOutcome.incident ?? null,
    notification:   notificationOutcome ?? null,
    ignoredAsStale: stateOutcome.ignoredAsStale ?? false,
  };
}

/**
 * Creates and starts a BullMQ Worker instance with bounded concurrency.
 *
 * @param {object} [options]
 * @param {number} [options.concurrency] Max concurrent jobs (defaults to 10)
 * @param {object} [options.connection] Custom Redis connection options
 * @param {object} [options.dependencies] Injected dependencies for job processor
 * @returns {Worker}
 */
function createHealthCheckWorker(options = {}) {
  const concurrency = options.concurrency ?? config.WORKER_CONCURRENCY ?? DEFAULT_CONCURRENCY;
  const connection  = options.connection ?? getRedisConnectionOptions();

  const worker = new Worker(
    QUEUE_NAME,
    (job) => processMonitorCheckJob(job, options.dependencies),
    {
      connection,
      concurrency,
    },
  );

  worker.on('completed', (job, result) => {
    logger.debug({ jobId: job.id, monitorId: result?.monitorId }, 'Worker job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId:     job?.id,
        monitorId: job?.data?.monitorId,
        attempts:  job?.attemptsMade,
        err:       err.message,
      },
      'Worker job failed — scheduled for retry',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err, queue: QUEUE_NAME }, 'Worker connection error');
  });

  return worker;
}

module.exports = {
  DEFAULT_CONCURRENCY,
  processMonitorCheckJob,
  createHealthCheckWorker,
};
