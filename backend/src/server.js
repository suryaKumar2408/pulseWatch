'use strict';

const config = require('./config');
const logger = require('./lib/logger');
const { disconnectDb } = require('./lib/db');
const { disconnectRedis } = require('./lib/redis');
const { createHealthCheckWorker, closeHealthCheckQueue } = require('./queue');
const { getMonitorScheduler } = require('./scheduler');
const createApp = require('./app');

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    'PulseWatch backend started'
  );
});

// ── Background Processing Orchestration ────────────────────────────────────

let worker = null;
let scheduler = null;

if (config.NODE_ENV !== 'test') {
  if (config.ENABLE_BACKGROUND_WORKER) {
    worker = createHealthCheckWorker();
    logger.info('Health check background worker initialized');
  }

  if (config.ENABLE_SCHEDULER) {
    scheduler = getMonitorScheduler({
      tickIntervalMs: config.SCHEDULER_TICK_INTERVAL_MS,
    });
    scheduler.start();
    logger.info('Monitor scheduler initialized and started');
  }
}

// ── Graceful Shutdown ──────────────────────────────────────────────────────

let shuttingDown = false;

/**
 * Graceful shutdown sequence:
 * 1. Stop scheduler to prevent new job dispatches.
 * 2. Close worker to let in-flight jobs finish.
 * 3. Close BullMQ queue.
 * 4. Stop HTTP server and drain active client requests.
 * 5. Close database and Redis connection pools.
 * 6. Exit cleanly.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutdown signal received, draining connections and background tasks…');

  // 1. Stop scheduler
  if (scheduler) {
    try {
      await scheduler.stop();
      logger.info('Scheduler stopped');
    } catch (err) {
      logger.error({ err }, 'Error stopping scheduler');
    }
  }

  // 2. Close worker
  if (worker) {
    try {
      await worker.close();
      logger.info('Worker closed');
    } catch (err) {
      logger.error({ err }, 'Error closing worker');
    }
  }

  // 3. Close queue
  try {
    await closeHealthCheckQueue();
    logger.info('Health check queue closed');
  } catch (err) {
    logger.error({ err }, 'Error closing queue');
  }

  // 4. Stop HTTP server
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await Promise.allSettled([disconnectDb(), disconnectRedis()]);
      logger.info('All connections closed — exiting');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during database/redis disconnect');
      process.exit(1);
    }
  });

  // Force-exit after 10 seconds if drain takes too long
  setTimeout(() => {
    logger.error('Forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled promise rejections — log and exit so the process manager can restart
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});

module.exports = server; // exported for testing
