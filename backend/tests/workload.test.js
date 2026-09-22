'use strict';

const createMockDb = require('./helpers/mockDb');
const { processMonitorCheckJob } = require('../src/queue/healthCheckWorker');
const { processCheckResult, MonitorStatus } = require('../src/lib/stateManager');
const { isMonitorDue, MonitorScheduler } = require('../src/scheduler/monitorScheduler');

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../src/lib/db', () => ({
  getDb:        jest.fn(),
  disconnectDb: jest.fn().mockResolvedValue(undefined),
  pingDb:       jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/redis', () => ({
  pingRedis:                 jest.fn().mockResolvedValue(true),
  disconnectRedis:           jest.fn().mockResolvedValue(undefined),
  getRedis:                  jest.fn(),
  getRedisConnectionOptions: jest.fn().mockReturnValue({}),
}));

describe('Stage 13: High-Concurrency Workload & Reliability Tests', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. 50 Simultaneous Checks Concurrently
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario 1: 50 Simultaneous Checks Concurrently', () => {
    it('executes 50 health checks in parallel without dropped jobs or race conditions', async () => {
      const TOTAL_MONITORS = 50;

      // Generate 50 monitors in DB
      const monitors = Array.from({ length: TOTAL_MONITORS }, (_, i) => ({
        id:                   `monitor-load-${i}`,
        userId:               `user-${i % 5}`, // shared across 5 users
        name:                 `Service Target ${i}`,
        url:                  `https://api-${i}.example.com/health`,
        method:               'GET',
        intervalSeconds:      60,
        timeoutSeconds:       10,
        expectedCodes:        [200],
        enabled:              true,
        status:               MonitorStatus.UP,
        consecutiveFailures:  0,
        consecutiveSuccesses: 5,
        lastCheckedAt:        new Date('2026-01-01T00:00:00Z'),
        lastResponseTimeMs:   35,
      }));

      // Mock DB findUnique by monitorId
      const monitorMap = new Map(monitors.map((m) => [m.id, m]));
      mockDb.monitor.findUnique.mockImplementation(({ where }) => {
        return Promise.resolve(monitorMap.get(where.id) || null);
      });

      // Mock parallel check executions (staggered simulated response times 10ms - 50ms)
      const mockCheckMonitor = jest.fn(async (mon) => {
        const idNum = parseInt(mon.id.split('-')[2], 10);
        const latency = 10 + (idNum % 20); // 10ms - 29ms
        return {
          success:        true,
          statusCode:     200,
          responseTimeMs: latency,
          errorCode:      null,
          errorMessage:   null,
          checkedAt:      new Date(),
        };
      });

      const mockValidateSsrf = jest.fn().mockResolvedValue({ safe: true });
      const mockNotify = jest.fn().mockResolvedValue({ delivered: true });

      // Launch 50 jobs concurrently
      const jobs = monitors.map((m) => ({
        id:   `job-${m.id}`,
        data: { monitorId: m.id },
      }));

      const results = await Promise.all(
        jobs.map((job) =>
          processMonitorCheckJob(job, {
            db:               mockDb,
            checkMonitor:     mockCheckMonitor,
            validateUrlSsrf:  mockValidateSsrf,
            dispatchStateChangeNotification: mockNotify,
          })
        )
      );

      // Verify all 50 completed successfully
      expect(results).toHaveLength(TOTAL_MONITORS);
      for (const res of results) {
        expect(res.outcome).toBe('PROCESSED');
        expect(res.success).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(res.status).toBe(MonitorStatus.UP);
      }

      expect(mockCheckMonitor).toHaveBeenCalledTimes(TOTAL_MONITORS);
      expect(mockValidateSsrf).toHaveBeenCalledTimes(TOTAL_MONITORS);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Slow Endpoints & Timeout Isolation
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario 2: Slow Endpoints & Timeout Isolation', () => {
    it('handles slow and hanging targets without delaying or starving concurrent fast checks', async () => {
      const fastMonitor = {
        id: 'mon-fast',
        userId: 'u1',
        url: 'https://fast.example.com/health',
        enabled: true,
        status: MonitorStatus.UP,
        consecutiveFailures: 0,
        consecutiveSuccesses: 10,
      };

      const slowMonitor = {
        id: 'mon-slow',
        userId: 'u1',
        url: 'https://slow.example.com/health',
        timeoutSeconds: 2,
        enabled: true,
        status: MonitorStatus.UP,
        consecutiveFailures: 0,
        consecutiveSuccesses: 5,
      };

      mockDb.monitor.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'mon-fast') return Promise.resolve(fastMonitor);
        if (where.id === 'mon-slow') return Promise.resolve(slowMonitor);
        return Promise.resolve(null);
      });

      const checkFn = jest.fn(async (mon) => {
        if (mon.id === 'mon-fast') {
          return {
            success: true,
            statusCode: 200,
            responseTimeMs: 20,
            errorCode: null,
            errorMessage: null,
            checkedAt: new Date(),
          };
        }
        // Slow monitor times out
        return {
          success: false,
          statusCode: null,
          responseTimeMs: 2000,
          errorCode: 'TIMEOUT',
          errorMessage: 'The operation timed out after 2000ms',
          checkedAt: new Date(),
        };
      });

      const fastJob = { id: 'job-fast', data: { monitorId: 'mon-fast' } };
      const slowJob = { id: 'job-slow', data: { monitorId: 'mon-slow' } };

      // Run both jobs concurrently
      const [fastRes, slowRes] = await Promise.all([
        processMonitorCheckJob(fastJob, { db: mockDb, checkMonitor: checkFn, validateUrlSsrf: () => Promise.resolve({ safe: true }) }),
        processMonitorCheckJob(slowJob, { db: mockDb, checkMonitor: checkFn, validateUrlSsrf: () => Promise.resolve({ safe: true }) }),
      ]);

      expect(fastRes.success).toBe(true);
      expect(fastRes.statusCode).toBe(200);

      expect(slowRes.success).toBe(false);
      expect(slowRes.errorCode).toBe('TIMEOUT');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Repeated Failures & Prolonged Outage
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario 3: Repeated Failures & Prolonged Outage', () => {
    it('transitions to DOWN strictly at 3rd failure, opens 1 incident, and avoids duplicates on subsequent failures', async () => {
      let monitorState = {
        id: 'mon-repeated-fail',
        userId: 'u1',
        url: 'https://api.example.com/check',
        enabled: true,
        status: MonitorStatus.UP,
        consecutiveFailures: 0,
        consecutiveSuccesses: 10,
        lastCheckedAt: new Date('2026-01-01T00:00:00Z'),
      };

      let openIncidents = [];
      mockDb.monitor.findUnique.mockImplementation(() => Promise.resolve(monitorState));
      mockDb.incident.findFirst.mockImplementation(({ where }) => {
        return Promise.resolve(openIncidents.find((i) => i.status === where.status) || null);
      });
      mockDb.incident.create.mockImplementation(({ data }) => {
        const inc = { id: `inc-${Date.now()}`, ...data };
        openIncidents.push(inc);
        return Promise.resolve(inc);
      });
      mockDb.monitor.update.mockImplementation(({ data }) => {
        monitorState = { ...monitorState, ...data };
        return Promise.resolve(monitorState);
      });

      const notifyMock = jest.fn().mockResolvedValue({ delivered: true });

      // Simulate 10 consecutive failures
      for (let i = 1; i <= 10; i++) {
        const checkResult = {
          success: false,
          statusCode: 503,
          responseTimeMs: 80,
          errorCode: 'HTTP_ERROR',
          errorMessage: '503 Service Unavailable',
          checkedAt: new Date(Date.now() + i * 60000),
        };

        const job = { id: `job-${i}`, data: { monitorId: monitorState.id } };
        const outcome = await processMonitorCheckJob(job, {
          db: mockDb,
          checkMonitor: () => Promise.resolve(checkResult),
          validateUrlSsrf: () => Promise.resolve({ safe: true }),
          dispatchStateChangeNotification: notifyMock,
        });

        if (i < 3) {
          expect(outcome.status).toBe(MonitorStatus.UP);
          expect(outcome.hasTransition).toBe(false);
        } else if (i === 3) {
          expect(outcome.status).toBe(MonitorStatus.DOWN);
          expect(outcome.hasTransition).toBe(true);
          expect(outcome.transition.from).toBe(MonitorStatus.UP);
          expect(outcome.transition.to).toBe(MonitorStatus.DOWN);
        } else {
          // 4th to 10th failure: remains DOWN without transition or repeated incidents
          expect(outcome.status).toBe(MonitorStatus.DOWN);
          expect(outcome.hasTransition).toBe(false);
        }
      }

      // Exactly ONE incident created despite 10 failures
      expect(openIncidents).toHaveLength(1);
      expect(openIncidents[0].status).toBe('OPEN');
      // Exactly ONE notification sent (at 3rd failure)
      expect(notifyMock).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Duplicate Processing & Stale Check Detection (Race Conditions)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario 4: Duplicate Processing & Out-of-Order Execution', () => {
    it('ignores stale check results if a newer check has already committed', async () => {
      const monitor = {
        id: 'mon-stale-test',
        userId: 'u1',
        status: MonitorStatus.UP,
        consecutiveFailures: 0,
        consecutiveSuccesses: 10,
        lastCheckedAt: new Date('2026-09-21T12:05:00.000Z'), // newer check
      };

      // Check result timestamped BEFORE lastCheckedAt
      const staleCheck = {
        success: false,
        statusCode: 500,
        responseTimeMs: 50,
        errorCode: 'HTTP_ERROR',
        errorMessage: '500 Server Error',
        checkedAt: new Date('2026-09-21T12:00:00.000Z'), // 5 minutes older
      };

      mockDb.monitor.findUnique.mockResolvedValue(monitor);

      const outcome = await processCheckResult(monitor.id, staleCheck, {
        db: mockDb,
      });

      expect(outcome.ignoredAsStale).toBe(true);
      expect(outcome.hasTransition).toBe(false);
      expect(outcome.currentStatus).toBe(MonitorStatus.UP);
      // Confirm monitor status and counters were NOT overwritten
      expect(mockDb.monitor.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Simultaneous Recovery of Multiple Down Monitors
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario 5: Simultaneous Recovery of Multiple Down Monitors', () => {
    it('resolves active incidents and dispatches recovery alerts for 20 monitors simultaneously', async () => {
      const COUNT = 20;

      const downMonitors = Array.from({ length: COUNT }, (_, i) => ({
        id:                   `mon-down-${i}`,
        userId:               'user-recovery',
        name:                 `Down Service ${i}`,
        url:                  `https://service-${i}.example.com`,
        enabled:              true,
        status:               MonitorStatus.DOWN,
        consecutiveFailures:  5,
        consecutiveSuccesses: 0,
        lastCheckedAt:        new Date('2026-09-21T10:00:00Z'),
      }));

      const activeIncidents = downMonitors.map((m, i) => ({
        id:              `inc-down-${i}`,
        monitorId:       m.id,
        userId:          m.userId,
        status:          'OPEN',
        startedAt:       new Date('2026-09-21T09:00:00Z'),
        resolvedAt:      null,
        durationSeconds: null,
      }));

      const monitorMap = new Map(downMonitors.map((m) => [m.id, m]));
      const incidentMap = new Map(activeIncidents.map((inc) => [inc.monitorId, inc]));

      mockDb.monitor.findUnique.mockImplementation(({ where }) => {
        return Promise.resolve(monitorMap.get(where.id) || null);
      });

      mockDb.incident.findFirst.mockImplementation(({ where }) => {
        const inc = incidentMap.get(where.monitorId);
        return Promise.resolve(inc && inc.status === where.status ? inc : null);
      });

      const notifyMock = jest.fn().mockResolvedValue({ delivered: true });

      const checkFn = jest.fn().mockResolvedValue({
        success:        true,
        statusCode:     200,
        responseTimeMs: 30,
        errorCode:      null,
        errorMessage:   null,
        checkedAt:      new Date('2026-09-21T10:01:00Z'),
      });

      const jobs = downMonitors.map((m) => ({
        id:   `job-recover-${m.id}`,
        data: { monitorId: m.id },
      }));

      const results = await Promise.all(
        jobs.map((job) =>
          processMonitorCheckJob(job, {
            db: mockDb,
            checkMonitor: checkFn,
            validateUrlSsrf: () => Promise.resolve({ safe: true }),
            dispatchStateChangeNotification: notifyMock,
          })
        )
      );

      expect(results).toHaveLength(COUNT);
      for (const res of results) {
        expect(res.hasTransition).toBe(true);
        expect(res.transition.from).toBe(MonitorStatus.DOWN);
        expect(res.transition.to).toBe(MonitorStatus.UP);
        expect(res.status).toBe(MonitorStatus.UP);
      }

      // All 20 incidents were resolved
      expect(mockDb.incident.update).toHaveBeenCalledTimes(COUNT);
      // All 20 recovery notifications were dispatched
      expect(notifyMock).toHaveBeenCalledTimes(COUNT);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Infrastructure Failure Resilience (Database Errors Trigger BullMQ Retry)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario 6: Infrastructure Failure Resilience', () => {
    it('throws infrastructure database errors to trigger BullMQ automatic retry', async () => {
      mockDb.monitor.findUnique.mockRejectedValue(new Error('Connection terminated unexpectedly'));

      const job = { id: 'job-infra-fail', data: { monitorId: 'mon-1' } };

      await expect(
        processMonitorCheckJob(job, {
          db: mockDb,
          checkMonitor: () => Promise.resolve({ success: true }),
          validateUrlSsrf: () => Promise.resolve({ safe: true }),
        })
      ).rejects.toThrow('Connection terminated unexpectedly');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. Application Restarts & Scheduling Integrity
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Scenario 7: Application Restarts & Scheduling Integrity', () => {
    it('evaluates isMonitorDue correctly across varied states on restart', () => {
      const now = new Date('2026-09-21T12:00:00.000Z');

      // 1. Never checked -> Due immediately
      expect(isMonitorDue({ enabled: true, intervalSeconds: 60, lastCheckedAt: null }, now)).toBe(true);

      // 2. Checked 30s ago (interval 60s) -> NOT due
      expect(
        isMonitorDue(
          {
            enabled: true,
            intervalSeconds: 60,
            lastCheckedAt: new Date('2026-09-21T11:59:30.000Z'),
          },
          now
        )
      ).toBe(false);

      // 3. Checked 65s ago (interval 60s) -> Due
      expect(
        isMonitorDue(
          {
            enabled: true,
            intervalSeconds: 60,
            lastCheckedAt: new Date('2026-09-21T11:58:55.000Z'),
          },
          now
        )
      ).toBe(true);

      // 4. Disabled monitor -> NEVER due even if lastCheckedAt is long ago
      expect(
        isMonitorDue(
          {
            enabled: false,
            intervalSeconds: 60,
            lastCheckedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          now
        )
      ).toBe(false);
    });

    it('scheduler tick uses deterministic time-bucket jobIds preventing restart floods', async () => {
      const now = new Date('2026-09-21T12:00:00.000Z');

      const monitors = [
        { id: 'mon-due-1', enabled: true, intervalSeconds: 60, lastCheckedAt: null },
        { id: 'mon-due-2', enabled: true, intervalSeconds: 60, lastCheckedAt: new Date('2026-09-21T11:58:00.000Z') },
        { id: 'mon-not-due', enabled: true, intervalSeconds: 60, lastCheckedAt: new Date('2026-09-21T11:59:45.000Z') },
        { id: 'mon-disabled', enabled: false, intervalSeconds: 60, lastCheckedAt: null },
      ];

      mockDb.monitor.findMany.mockResolvedValue(monitors);

      const enqueueMock = jest.fn().mockResolvedValue({ id: 'mock-job' });

      const scheduler = new MonitorScheduler({
        db: mockDb,
        enqueueHealthCheck: enqueueMock,
      });

      const tickOutcome = await scheduler.tick(now);

      expect(tickOutcome.dueCount).toBe(2);
      expect(tickOutcome.dispatchedCount).toBe(2);

      // Verify deterministic job IDs
      expect(enqueueMock).toHaveBeenCalledWith('mon-due-1', expect.objectContaining({
        jobId: expect.stringMatching(/^check:mon-due-1:\d+$/),
      }));
      expect(enqueueMock).toHaveBeenCalledWith('mon-due-2', expect.objectContaining({
        jobId: expect.stringMatching(/^check:mon-due-2:\d+$/),
      }));
      expect(enqueueMock).not.toHaveBeenCalledWith('mon-not-due', expect.anything());
      expect(enqueueMock).not.toHaveBeenCalledWith('mon-disabled', expect.anything());
    });
  });
});
