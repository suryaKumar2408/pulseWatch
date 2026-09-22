'use strict';

/**
 * Monitor Interval Scheduler
 *
 * Continuously evaluates registered monitors and dispatches check jobs to the
 * background queue strictly according to each monitor's configured interval.
 *
 * Design principles:
 *  - Deterministic due-time evaluation (`isMonitorDue`).
 *  - Strict interval enforcement (`intervalSeconds` per monitor).
 *  - Disabled monitors are never scheduled.
 *  - Application restarts are safe: state in PostgreSQL prevents restart spikes.
 *  - Bounded resource usage: delegates execution to BullMQ with controlled concurrency.
 *  - Mutual exclusion: prevents overlapping ticks.
 */

const { getDb } = require('../lib/db');
const { enqueueHealthCheck } = require('../queue');
const logger = require('../lib/logger');

const DEFAULT_TICK_INTERVAL_MS = 5000; // Run evaluation tick every 5 seconds

/**
 * Evaluates whether a monitor is due for a health check at the given point in time.
 *
 * @param {object} monitor
 * @param {boolean} monitor.enabled
 * @param {number} monitor.intervalSeconds
 * @param {Date|string|null} [monitor.lastCheckedAt]
 * @param {Date} [now] Reference time (defaults to Date.now())
 * @returns {boolean}
 */
function isMonitorDue(monitor, now = new Date()) {
  if (!monitor || typeof monitor !== 'object') {
    return false;
  }

  // Disabled monitors are NEVER due
  if (!monitor.enabled) {
    return false;
  }

  // Never checked before: due immediately
  if (!monitor.lastCheckedAt) {
    return true;
  }

  const intervalSeconds = Number(monitor.intervalSeconds) || 60;
  const intervalMs = intervalSeconds * 1000;
  const lastCheckTime = new Date(monitor.lastCheckedAt).getTime();
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();

  const elapsedMs = currentTime - lastCheckTime;

  // Due if elapsed time since last check meets or exceeds configured interval
  return elapsedMs >= intervalMs;
}

/**
 * MonitorScheduler manages recurring evaluation ticks.
 */
class MonitorScheduler {
  constructor(options = {}) {
    this.db = options.db ?? null;
    this.enqueueFn = options.enqueueHealthCheck ?? enqueueHealthCheck;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.logger = options.logger ?? logger;

    this.timer = null;
    this.isRunning = false;
    this.activeTickPromise = null;
  }

  /**
   * Starts the recurring scheduler loop.
   */
  start() {
    if (this.timer) return;

    this.logger.info(
      { intervalMs: this.tickIntervalMs },
      'Monitor scheduler started',
    );

    // Run first tick immediately, then schedule interval
    this.tick().catch((err) => {
      this.logger.error({ err }, 'Initial scheduler tick failed');
    });

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err }, 'Recurring scheduler tick failed');
      });
    }, this.tickIntervalMs);

    // Do not hold Node event loop open in tests if unref is available
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops the recurring scheduler loop and waits for any in-flight tick to finish.
   */
  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.activeTickPromise) {
      await this.activeTickPromise.catch(() => {});
    }

    this.logger.info('Monitor scheduler stopped');
  }

  /**
   * Executes a single evaluation tick.
   *
   * @param {Date} [now] Current timestamp
   * @returns {Promise<object>} Summary of the tick outcome
   */
  async tick(now = new Date()) {
    // Mutex guard: avoid overlapping ticks if previous tick is still processing
    if (this.isRunning) {
      this.logger.debug('Skipping scheduler tick: previous tick still in progress');
      return { skipped: true, reason: 'CONCURRENT_TICK' };
    }

    this.isRunning = true;
    const tickTime = now instanceof Date ? now : new Date(now);

    this.activeTickPromise = (async () => {
      try {
        const dbClient = this.db ?? getDb();

        // Query enabled monitors only
        const monitors = await dbClient.monitor.findMany({
          where: { enabled: true },
          select: {
            id: true,
            intervalSeconds: true,
            lastCheckedAt: true,
            enabled: true,
          },
        });

        const dueMonitors = monitors.filter((m) => isMonitorDue(m, tickTime));
        const dispatchedIds = [];

        for (const monitor of dueMonitors) {
          try {
            const intervalSec = Number(monitor.intervalSeconds) || 60;
            // Deterministic time bucket prevents duplicate jobs in the same interval window
            const timeBucket = Math.floor(tickTime.getTime() / (intervalSec * 1000));
            const jobId = `check:${monitor.id}:${timeBucket}`;

            await this.enqueueFn(monitor.id, { jobId });
            dispatchedIds.push(monitor.id);
          } catch (err) {
            this.logger.error(
              { monitorId: monitor.id, err: err.message },
              'Failed to enqueue health check for due monitor',
            );
          }
        }

        if (dispatchedIds.length > 0) {
          this.logger.debug(
            { count: dispatchedIds.length, total: monitors.length },
            'Dispatched health check jobs for due monitors',
          );
        }

        return {
          totalMonitors: monitors.length,
          dueCount: dueMonitors.length,
          dispatchedCount: dispatchedIds.length,
          dispatchedIds,
          timestamp: tickTime,
        };
      } finally {
        this.isRunning = false;
        this.activeTickPromise = null;
      }
    })();

    return this.activeTickPromise;
  }
}

let schedulerInstance;

function getMonitorScheduler(options = {}) {
  if (!schedulerInstance) {
    schedulerInstance = new MonitorScheduler(options);
  }
  return schedulerInstance;
}

module.exports = {
  DEFAULT_TICK_INTERVAL_MS,
  isMonitorDue,
  MonitorScheduler,
  getMonitorScheduler,
};
