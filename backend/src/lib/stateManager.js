'use strict';

/**
 * Monitor Health State Manager
 *
 * Manages monitor health states and transitions:
 *  - Computes status transitions between UNKNOWN, UP, and DOWN.
 *  - Maintains consecutive success and failure counters.
 *  - Enforces threshold rules (3 failures to mark DOWN; 1 success to mark UP).
 *  - Deduplicates state transitions (no repeated transitions while already DOWN or UP).
 *  - Ensures atomic, concurrency-safe persistence using database row-level locking
 *    and out-of-order check detection.
 */

const { getDb } = require('./db');
const logger = require('./logger');

const FAILURE_THRESHOLD = 3;

const MonitorStatus = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  UP:      'UP',
  DOWN:    'DOWN',
});

/**
 * Pure function: Computes the next health state and transitions without side-effects.
 *
 * Rules:
 *  1. Successful check resets consecutiveFailures to 0 and increments consecutiveSuccesses.
 *  2. Failed check resets consecutiveSuccesses to 0 and increments consecutiveFailures.
 *  3. First/second failure does NOT mark monitor DOWN (status remains UP or UNKNOWN).
 *  4. 3 consecutive failures transitions UP/UNKNOWN -> DOWN.
 *  5. Successful check while DOWN immediately transitions DOWN -> UP.
 *  6. Repeated failures while DOWN do not emit repeated state transitions.
 *  7. Repeated successes while UP do not emit repeated state transitions.
 *
 * @param {object} currentState
 * @param {string} [currentState.status]
 * @param {number} [currentState.consecutiveFailures]
 * @param {number} [currentState.consecutiveSuccesses]
 * @param {Date|null} [currentState.lastCheckedAt]
 * @param {number|null} [currentState.lastResponseTimeMs]
 * @param {object} checkResult
 * @param {boolean} checkResult.success
 * @param {number|null} [checkResult.statusCode]
 * @param {number|null} [checkResult.responseTimeMs]
 * @param {Date|string} [checkResult.checkedAt]
 * @param {string|null} [checkResult.errorMessage]
 * @param {object} [options]
 * @param {number} [options.failureThreshold] Defaults to 3
 * @returns {object} Next state and transition details
 */
function computeNextState(currentState = {}, checkResult = {}, options = {}) {
  const currentStatus        = currentState.status ?? MonitorStatus.UNKNOWN;
  const consecutiveFailures  = Number(currentState.consecutiveFailures) || 0;
  const consecutiveSuccesses = Number(currentState.consecutiveSuccesses) || 0;
  const failureThreshold     = options.failureThreshold ?? FAILURE_THRESHOLD;

  const isSuccess = Boolean(checkResult.success);
  const checkedAt = checkResult.checkedAt instanceof Date
    ? checkResult.checkedAt
    : new Date(checkResult.checkedAt || Date.now());

  let newStatus;
  let newConsecutiveFailures;
  let newConsecutiveSuccesses;
  let transition = null;
  let lastResponseTimeMs;

  if (isSuccess) {
    newConsecutiveFailures  = 0;
    newConsecutiveSuccesses = consecutiveSuccesses + 1;
    newStatus               = MonitorStatus.UP;
    lastResponseTimeMs      = checkResult.responseTimeMs ?? currentState.lastResponseTimeMs ?? null;

    if (currentStatus === MonitorStatus.DOWN) {
      transition = {
        from:      MonitorStatus.DOWN,
        to:        MonitorStatus.UP,
        timestamp: checkedAt,
      };
    } else if (currentStatus === MonitorStatus.UNKNOWN) {
      transition = {
        from:      MonitorStatus.UNKNOWN,
        to:        MonitorStatus.UP,
        timestamp: checkedAt,
      };
    }
    // If already UP, newStatus remains UP, transition is null (deduplicated)
  } else {
    newConsecutiveSuccesses = 0;
    newConsecutiveFailures  = consecutiveFailures + 1;
    lastResponseTimeMs      = checkResult.responseTimeMs ?? null;

    if (currentStatus === MonitorStatus.DOWN) {
      // Already DOWN: increment failures but do not emit repeated transition
      newStatus  = MonitorStatus.DOWN;
      transition = null;
    } else {
      // Current status is UP or UNKNOWN
      if (newConsecutiveFailures >= failureThreshold) {
        newStatus  = MonitorStatus.DOWN;
        transition = {
          from:      currentStatus,
          to:        MonitorStatus.DOWN,
          timestamp: checkedAt,
        };
      } else {
        // 1st or 2nd failure: retain existing status, no transition
        newStatus  = currentStatus;
        transition = null;
      }
    }
  }

  return {
    status:               newStatus,
    consecutiveFailures:  newConsecutiveFailures,
    consecutiveSuccesses: newConsecutiveSuccesses,
    lastCheckedAt:        checkedAt,
    lastResponseTimeMs,
    hasTransition:        transition !== null,
    transition,
  };
}

/**
 * Atomically updates monitor health state and records the check result in PostgreSQL.
 *
 * Concurrency & duplicate safety:
 *  - Uses an interactive transaction (`$transaction`).
 *  - Acquires a row-level lock (`SELECT ... FOR UPDATE`) to serialize concurrent checks.
 *  - Detects out-of-order checks (`checkedAt < monitor.lastCheckedAt`) and stores the
 *    telemetry without overwriting the monitor's newer state.
 *
 * @param {string} monitorId
 * @param {object} checkResult
 * @param {object} [options]
 * @param {object} [options.db] Injected Prisma client (e.g. for testing)
 * @param {number} [options.failureThreshold]
 * @returns {Promise<object>} Processing outcome
 */
async function processCheckResult(monitorId, checkResult, options = {}) {
  if (!monitorId || typeof monitorId !== 'string') {
    throw new Error('monitorId is required and must be a string');
  }

  if (!checkResult || typeof checkResult !== 'object') {
    throw new Error('checkResult is required and must be an object');
  }

  const dbClient = options.db ?? getDb();

  return dbClient.$transaction(async (tx) => {
    // 1. Acquire pessimistic row-level lock in PostgreSQL
    if (typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT id FROM "Monitor" WHERE id = ${monitorId} FOR UPDATE`;
    }

    // 2. Fetch current monitor state
    const monitor = await tx.monitor.findUnique({
      where: { id: monitorId },
    });

    if (!monitor) {
      throw new Error(`Monitor not found: ${monitorId}`);
    }

    const checkTimestamp = checkResult.checkedAt instanceof Date
      ? checkResult.checkedAt
      : new Date(checkResult.checkedAt || Date.now());

    // 3. Stale / out-of-order check guard
    const isStale = Boolean(
      monitor.lastCheckedAt &&
      checkTimestamp.getTime() < new Date(monitor.lastCheckedAt).getTime()
    );

    if (isStale) {
      const savedCheck = await tx.checkResult.create({
        data: {
          ...(checkResult.id ? { id: checkResult.id } : {}),
          monitorId:      monitor.id,
          userId:         monitor.userId,
          success:        Boolean(checkResult.success),
          statusCode:     checkResult.statusCode ?? null,
          responseTimeMs: checkResult.responseTimeMs ?? null,
          errorCode:      checkResult.errorCode ?? null,
          errorMessage:   checkResult.errorMessage ?? null,
          checkedAt:      checkTimestamp,
        },
      });

      logger.warn(
        { monitorId, checkTimestamp, lastCheckedAt: monitor.lastCheckedAt },
        'Stale check result recorded in history; monitor health state update skipped',
      );

      return {
        monitor,
        previousStatus: monitor.status,
        currentStatus:  monitor.status,
        transition:     null,
        hasTransition:  false,
        checkResult:    savedCheck,
        ignoredAsStale: true,
      };
    }

    // 4. Compute next health state and transitions
    const nextState = computeNextState(monitor, { ...checkResult, checkedAt: checkTimestamp }, {
      failureThreshold: options.failureThreshold,
    });

    // 5. Persist CheckResult history record
    const savedCheck = await tx.checkResult.create({
      data: {
        ...(checkResult.id ? { id: checkResult.id } : {}),
        monitorId:      monitor.id,
        userId:         monitor.userId,
        success:        Boolean(checkResult.success),
        statusCode:     checkResult.statusCode ?? null,
        responseTimeMs: checkResult.responseTimeMs ?? null,
        errorCode:      checkResult.errorCode ?? null,
        errorMessage:   checkResult.errorMessage ?? null,
        checkedAt:      checkTimestamp,
      },
    });

    // 6. Update Monitor with new state and counters
    const updatedMonitor = await tx.monitor.update({
      where: { id: monitor.id },
      data: {
        status:               nextState.status,
        consecutiveFailures:  nextState.consecutiveFailures,
        consecutiveSuccesses: nextState.consecutiveSuccesses,
        lastCheckedAt:        nextState.lastCheckedAt,
        lastResponseTimeMs:   nextState.lastResponseTimeMs,
      },
    });

    if (nextState.hasTransition) {
      logger.info(
        {
          monitorId:            monitor.id,
          from:                 nextState.transition.from,
          to:                   nextState.transition.to,
          consecutiveFailures:  nextState.consecutiveFailures,
          consecutiveSuccesses: nextState.consecutiveSuccesses,
        },
        'Monitor health state transition occurred',
      );
    }

    // 7. Incident management: create on DOWN, resolve on UP
    let incident = null;

    if (nextState.hasTransition) {
      if (nextState.transition.to === MonitorStatus.DOWN) {
        // Outage started: create an open incident if not already open
        const existingOpen = await tx.incident.findFirst({
          where: { monitorId: monitor.id, status: 'OPEN' },
        });

        if (!existingOpen) {
          incident = await tx.incident.create({
            data: {
              monitorId:       monitor.id,
              userId:          monitor.userId,
              status:          'OPEN',
              startedAt:       nextState.transition.timestamp,
              cause:           checkResult.errorMessage ?? 'Outage detected: 3 consecutive check failures',
              errorCode:       checkResult.errorCode ?? null,
              statusCode:      checkResult.statusCode ?? null,
            },
          });

          if (incident) {
            logger.warn(
              { incidentId: incident.id, monitorId: monitor.id, cause: incident.cause },
              'Outage incident opened',
            );
          }
        } else {
          incident = existingOpen;
        }
      } else if (
        nextState.transition.from === MonitorStatus.DOWN &&
        nextState.transition.to === MonitorStatus.UP
      ) {
        // Recovery: resolve any active open incident(s) for this monitor
        let openIncidents = [];
        if (typeof tx.incident.findMany === 'function') {
          const found = await tx.incident.findMany({
            where: { monitorId: monitor.id, status: 'OPEN' },
            orderBy: { startedAt: 'desc' },
          });
          if (Array.isArray(found) && found.length > 0) {
            openIncidents = found;
          }
        }
        if (openIncidents.length === 0 && typeof tx.incident.findFirst === 'function') {
          const single = await tx.incident.findFirst({
            where: { monitorId: monitor.id, status: 'OPEN' },
            orderBy: { startedAt: 'desc' },
          });
          if (single) {
            openIncidents = [single];
          }
        }

        if (openIncidents.length > 0) {
          const resolvedAt = nextState.transition.timestamp;
          for (let i = 0; i < openIncidents.length; i++) {
            const openIncident = openIncidents[i];
            const startedAt  = new Date(openIncident.startedAt);
            const durationSeconds = Math.max(
              0,
              Math.round((resolvedAt.getTime() - startedAt.getTime()) / 1000),
            );

            const updated = await tx.incident.update({
              where: { id: openIncident.id },
              data: {
                status:          'RESOLVED',
                resolvedAt,
                durationSeconds,
              },
            });

            if (i === 0) {
              incident = updated;
            }

            if (updated) {
              logger.info(
                {
                  incidentId:      updated.id,
                  monitorId:       monitor.id,
                  durationSeconds: updated.durationSeconds,
                },
                'Outage incident resolved',
              );
            }
          }
        }
      }
    }

    return {
      monitor:        updatedMonitor,
      previousStatus: monitor.status,
      currentStatus:  nextState.status,
      transition:     nextState.transition,
      hasTransition:  nextState.hasTransition,
      checkResult:    savedCheck,
      incident,
      ignoredAsStale: false,
    };
  });
}

module.exports = {
  FAILURE_THRESHOLD,
  MonitorStatus,
  computeNextState,
  processCheckResult,
};
