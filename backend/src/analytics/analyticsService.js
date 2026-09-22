'use strict';

const logger = require('../lib/logger');

/**
 * Calculates a given percentile (e.g. 95, 99) from an array of numbers using the nearest-rank method.
 * Returns null if the array is empty.
 *
 * @param {number[]} values - Array of numerical values (will be sorted ascending)
 * @param {number} percentile - Percentile between 0 and 100
 * @returns {number|null}
 */
function calculatePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const valid = values
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .sort((a, b) => a - b);

  if (valid.length === 0) {
    return null;
  }

  const rank = Math.ceil((percentile / 100) * valid.length);
  const index = Math.max(0, Math.min(valid.length - 1, rank - 1));

  return Number(valid[index].toFixed(2));
}

/**
 * Resolves window boundaries for a given period preset or custom timestamps.
 *
 * @param {string} period - '24h' | '7d' | '30d'
 * @param {string|Date} [customFrom]
 * @param {string|Date} [customTo]
 * @param {Date} [referenceDate=new Date()]
 * @returns {{ name: string, from: Date, to: Date, durationSeconds: number }}
 */
function calculatePeriodBounds(period = '24h', customFrom, customTo, referenceDate = new Date()) {
  const to = customTo ? new Date(customTo) : new Date(referenceDate);
  let from;

  if (customFrom) {
    from = new Date(customFrom);
  } else {
    const toMs = to.getTime();
    switch (period) {
      case '7d':
        from = new Date(toMs - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        from = new Date(toMs - 30 * 24 * 60 * 60 * 1000);
        break;
      case '24h':
      default:
        from = new Date(toMs - 24 * 60 * 60 * 1000);
        break;
    }
  }

  const durationSeconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

  return {
    name: period,
    from,
    to,
    durationSeconds,
  };
}

/**
 * Calculates total downtime and incident duration in seconds for incidents overlapping [from, to].
 * Each incident's duration is clamped to the boundary of the requested window.
 *
 * @param {Array<{ startedAt: Date|string, resolvedAt: Date|string|null }>} incidents
 * @param {Date} from
 * @param {Date} to
 * @param {Date} [referenceDate=new Date()]
 * @returns {{ downtimeSeconds: number, incidentCount: number, incidentDurationSeconds: number }}
 */
function calculateIncidentDowntime(incidents = [], from, to, referenceDate = new Date()) {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const nowMs = referenceDate.getTime();

  let totalDowntimeSeconds = 0;

  for (const inc of incidents) {
    const startMs = new Date(inc.startedAt).getTime();
    const endMs = inc.resolvedAt
      ? new Date(inc.resolvedAt).getTime()
      : Math.min(toMs, nowMs);

    // Clamping to period window
    const clampedStart = Math.max(startMs, fromMs);
    const clampedEnd   = Math.min(endMs, toMs);

    if (clampedEnd > clampedStart) {
      totalDowntimeSeconds += Math.round((clampedEnd - clampedStart) / 1000);
    }
  }

  return {
    downtimeSeconds: totalDowntimeSeconds,
    incidentCount: incidents.length,
    incidentDurationSeconds: totalDowntimeSeconds,
  };
}

/**
 * Calculates summary metrics given checks and incidents in memory.
 * Used directly or as a fallback calculation engine.
 *
 * @param {Object} params
 * @param {Array<{ success: boolean, responseTimeMs: number|null }>} params.checks
 * @param {Array<{ startedAt: Date|string, resolvedAt: Date|string|null }>} params.incidents
 * @param {Date} params.from
 * @param {Date} params.to
 * @param {Date} [params.referenceDate]
 */
function calculateSummary({ checks = [], incidents = [], from, to, referenceDate = new Date() }) {
  const totalChecks = checks.length;
  const successfulChecks = checks.filter((c) => c.success === true).length;
  const failedChecks = totalChecks - successfulChecks;

  const uptimePercentage = totalChecks > 0
    ? Number(((successfulChecks / totalChecks) * 100).toFixed(2))
    : 100.0;

  const responseTimes = checks
    .map((c) => c.responseTimeMs)
    .filter((rt) => typeof rt === 'number' && !Number.isNaN(rt));

  let averageResponseTime = null;
  if (responseTimes.length > 0) {
    const sum = responseTimes.reduce((acc, val) => acc + val, 0);
    averageResponseTime = Number((sum / responseTimes.length).toFixed(2));
  }

  const p95ResponseTime = calculatePercentile(responseTimes, 95);
  const p99ResponseTime = calculatePercentile(responseTimes, 99);

  const { downtimeSeconds, incidentCount, incidentDurationSeconds } = calculateIncidentDowntime(
    incidents,
    from,
    to,
    referenceDate
  );

  return {
    uptimePercentage,
    downtime: downtimeSeconds,
    downtimeSeconds,
    totalChecks,
    successfulChecks,
    failedChecks,
    averageResponseTime,
    p95ResponseTime,
    p99ResponseTime,
    incidentCount,
    incidentDuration: incidentDurationSeconds,
    incidentDurationSeconds,
  };
}

/**
 * Fetches monitoring analytics for a single monitor.
 *
 * @param {Object} db - Prisma client
 * @param {Object} options
 * @param {string} options.monitorId
 * @param {string} [options.period='24h']
 * @param {string} [options.from]
 * @param {string} [options.to]
 * @param {Date}   [options.referenceDate]
 */
async function getMonitorAnalytics(db, { monitorId, period = '24h', from: customFrom, to: customTo, referenceDate }) {
  const bounds = calculatePeriodBounds(period, customFrom, customTo, referenceDate);
  const { from, to } = bounds;

  // 1. Query incidents overlapping [from, to] using indexed monitorId and startedAt
  const incidents = await db.incident.findMany({
    where: {
      monitorId,
      startedAt: { lte: to },
      OR: [
        { resolvedAt: null },
        { resolvedAt: { gte: from } },
      ],
    },
    select: {
      id: true,
      startedAt: true,
      resolvedAt: true,
      durationSeconds: true,
      status: true,
    },
  });

  // 2. Query check results.
  // First try high-performance raw aggregation if supported (PostgreSQL percentile_cont)
  let checkSummary = null;

  try {
    if (typeof db.$queryRaw === 'function') {
      const rawResults = await db.$queryRaw`
        SELECT
          COUNT(*)::int as total_checks,
          COUNT(*) FILTER (WHERE "success" = true)::int as successful_checks,
          COUNT(*) FILTER (WHERE "success" = false)::int as failed_checks,
          ROUND(AVG("responseTimeMs")::numeric, 2)::float as avg_response_time,
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "responseTimeMs")::numeric, 2)::float as p95,
          ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "responseTimeMs")::numeric, 2)::float as p99
        FROM "CheckResult"
        WHERE "monitorId" = ${monitorId}
          AND "checkedAt" >= ${from}
          AND "checkedAt" <= ${to};
      `;

      if (Array.isArray(rawResults) && rawResults.length > 0 && rawResults[0].total_checks !== undefined) {
        const row = rawResults[0];
        const total = Number(row.total_checks) || 0;
        const success = Number(row.successful_checks) || 0;
        const failed = Number(row.failed_checks) || 0;

        checkSummary = {
          totalChecks: total,
          successfulChecks: success,
          failedChecks: failed,
          uptimePercentage: total > 0 ? Number(((success / total) * 100).toFixed(2)) : 100.0,
          averageResponseTime: row.avg_response_time !== null ? Number(row.avg_response_time) : null,
          p95ResponseTime: row.p95 !== null ? Number(row.p95) : null,
          p99ResponseTime: row.p99 !== null ? Number(row.p99) : null,
        };
      }
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Direct $queryRaw aggregation unavailable; falling back to findMany');
  }

  // Fallback to findMany if queryRaw did not return or failed (e.g. in test mocks)
  if (!checkSummary) {
    const checks = await db.checkResult.findMany({
      where: {
        monitorId,
        checkedAt: { gte: from, lte: to },
      },
      select: {
        success: true,
        responseTimeMs: true,
      },
    });

    const summary = calculateSummary({ checks, incidents: [], from, to, referenceDate });
    checkSummary = {
      totalChecks: summary.totalChecks,
      successfulChecks: summary.successfulChecks,
      failedChecks: summary.failedChecks,
      uptimePercentage: summary.uptimePercentage,
      averageResponseTime: summary.averageResponseTime,
      p95ResponseTime: summary.p95ResponseTime,
      p99ResponseTime: summary.p99ResponseTime,
    };
  }

  // 3. Combine with incident downtime & duration
  const incidentStats = calculateIncidentDowntime(incidents, from, to, referenceDate);

  return {
    monitorId,
    period: {
      name: bounds.name,
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
      durationSeconds: bounds.durationSeconds,
    },
    summary: {
      uptimePercentage: checkSummary.uptimePercentage,
      downtime: incidentStats.downtimeSeconds,
      downtimeSeconds: incidentStats.downtimeSeconds,
      totalChecks: checkSummary.totalChecks,
      successfulChecks: checkSummary.successfulChecks,
      failedChecks: checkSummary.failedChecks,
      averageResponseTime: checkSummary.averageResponseTime,
      p95ResponseTime: checkSummary.p95ResponseTime,
      p99ResponseTime: checkSummary.p99ResponseTime,
      incidentCount: incidentStats.incidentCount,
      incidentDuration: incidentStats.incidentDurationSeconds,
      incidentDurationSeconds: incidentStats.incidentDurationSeconds,
    },
  };
}

/**
 * Fetches aggregated monitoring analytics across all monitors owned by a user.
 *
 * @param {Object} db - Prisma client
 * @param {Object} options
 * @param {string} options.userId
 * @param {string} [options.period='24h']
 * @param {string} [options.from]
 * @param {string} [options.to]
 * @param {Date}   [options.referenceDate]
 */
async function getUserAnalytics(db, { userId, period = '24h', from: customFrom, to: customTo, referenceDate }) {
  const bounds = calculatePeriodBounds(period, customFrom, customTo, referenceDate);
  const { from, to } = bounds;

  const monitors = await db.monitor.findMany({
    where: { userId },
    select: { id: true, name: true, url: true, status: true },
  });

  const monitorIds = monitors.map((m) => m.id);

  if (monitorIds.length === 0) {
    return {
      userId,
      period: {
        name: bounds.name,
        from: bounds.from.toISOString(),
        to: bounds.to.toISOString(),
        durationSeconds: bounds.durationSeconds,
      },
      summary: {
        uptimePercentage: 100.0,
        downtime: 0,
        downtimeSeconds: 0,
        totalChecks: 0,
        successfulChecks: 0,
        failedChecks: 0,
        averageResponseTime: null,
        p95ResponseTime: null,
        p99ResponseTime: null,
        incidentCount: 0,
        incidentDuration: 0,
        incidentDurationSeconds: 0,
      },
      monitors: [],
    };
  }

  // Fetch individual monitor summaries
  const monitorSummaries = await Promise.all(
    monitors.map(async (mon) => {
      const res = await getMonitorAnalytics(db, {
        monitorId: mon.id,
        period,
        from: customFrom,
        to: customTo,
        referenceDate,
      });
      return {
        id: mon.id,
        name: mon.name,
        url: mon.url,
        status: mon.status,
        summary: res.summary,
      };
    })
  );

  // Aggregate user-wide summary across all monitors
  let totalChecks = 0;
  let successfulChecks = 0;
  let failedChecks = 0;
  let totalDowntime = 0;
  let totalIncidentCount = 0;
  let totalIncidentDuration = 0;
  const weightedAvgSum = [];

  for (const m of monitorSummaries) {
    totalChecks += m.summary.totalChecks;
    successfulChecks += m.summary.successfulChecks;
    failedChecks += m.summary.failedChecks;
    totalDowntime += m.summary.downtimeSeconds;
    totalIncidentCount += m.summary.incidentCount;
    totalIncidentDuration += m.summary.incidentDurationSeconds;

    if (m.summary.averageResponseTime !== null && m.summary.totalChecks > 0) {
      weightedAvgSum.push({
        avg: m.summary.averageResponseTime,
        weight: m.summary.totalChecks,
      });
    }
  }

  const uptimePercentage = totalChecks > 0
    ? Number(((successfulChecks / totalChecks) * 100).toFixed(2))
    : 100.0;

  let averageResponseTime = null;
  if (weightedAvgSum.length > 0) {
    const totalWeight = weightedAvgSum.reduce((acc, item) => acc + item.weight, 0);
    const sumProduct = weightedAvgSum.reduce((acc, item) => acc + item.avg * item.weight, 0);
    averageResponseTime = Number((sumProduct / totalWeight).toFixed(2));
  }

  return {
    userId,
    period: {
      name: bounds.name,
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
      durationSeconds: bounds.durationSeconds,
    },
    summary: {
      uptimePercentage,
      downtime: totalDowntime,
      downtimeSeconds: totalDowntime,
      totalChecks,
      successfulChecks,
      failedChecks,
      averageResponseTime,
      p95ResponseTime: null, // P95 across heterogeneous monitors is surfaced per monitor
      p99ResponseTime: null,
      incidentCount: totalIncidentCount,
      incidentDuration: totalIncidentDuration,
      incidentDurationSeconds: totalIncidentDuration,
    },
    monitors: monitorSummaries,
  };
}

module.exports = {
  calculatePercentile,
  calculatePeriodBounds,
  calculateIncidentDowntime,
  calculateSummary,
  getMonitorAnalytics,
  getUserAnalytics,
};
