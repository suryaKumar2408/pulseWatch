'use strict';

const {
  FAILURE_THRESHOLD,
  MonitorStatus,
  computeNextState,
  processCheckResult,
} = require('../src/lib/stateManager');
const createMockDb = require('./helpers/mockDb');

describe('Monitor Health State Management', () => {
  // ── Pure State Machine: computeNextState ───────────────────────────────────

  describe('computeNextState (pure state transitions)', () => {
    describe('Initial state (UNKNOWN)', () => {
      it('transitions UNKNOWN → UP on first successful check', () => {
        const current = {
          status: MonitorStatus.UNKNOWN,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: true,
          statusCode: 200,
          responseTimeMs: 45,
          checkedAt: new Date('2026-03-01T12:00:00Z'),
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.UP);
        expect(next.consecutiveSuccesses).toBe(1);
        expect(next.consecutiveFailures).toBe(0);
        expect(next.lastResponseTimeMs).toBe(45);
        expect(next.hasTransition).toBe(true);
        expect(next.transition).toEqual({
          from: MonitorStatus.UNKNOWN,
          to: MonitorStatus.UP,
          timestamp: new Date('2026-03-01T12:00:00Z'),
        });
      });

      it('retains UNKNOWN on 1st failure (does not mark DOWN)', () => {
        const current = {
          status: MonitorStatus.UNKNOWN,
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: false,
          statusCode: 500,
          errorMessage: 'Server Error',
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.UNKNOWN);
        expect(next.consecutiveFailures).toBe(1);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });

      it('retains UNKNOWN on 2nd consecutive failure (does not mark DOWN)', () => {
        const current = {
          status: MonitorStatus.UNKNOWN,
          consecutiveFailures: 1,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: false,
          statusCode: null,
          errorMessage: 'Timeout',
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.UNKNOWN);
        expect(next.consecutiveFailures).toBe(2);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });

      it('transitions UNKNOWN → DOWN on 3rd consecutive failure', () => {
        const current = {
          status: MonitorStatus.UNKNOWN,
          consecutiveFailures: 2,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: false,
          statusCode: 502,
          errorMessage: 'Bad Gateway',
          checkedAt: new Date('2026-03-01T12:03:00Z'),
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.DOWN);
        expect(next.consecutiveFailures).toBe(3);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(true);
        expect(next.transition).toEqual({
          from: MonitorStatus.UNKNOWN,
          to: MonitorStatus.DOWN,
          timestamp: new Date('2026-03-01T12:03:00Z'),
        });
      });
    });

    describe('Transitions from UP', () => {
      const upMonitor = {
        status: MonitorStatus.UP,
        consecutiveSuccesses: 5,
        consecutiveFailures: 0,
        lastResponseTimeMs: 30,
      };

      it('retains UP and increments consecutiveSuccesses on continued success (no transition)', () => {
        const check = {
          success: true,
          statusCode: 200,
          responseTimeMs: 25,
        };

        const next = computeNextState(upMonitor, check);

        expect(next.status).toBe(MonitorStatus.UP);
        expect(next.consecutiveSuccesses).toBe(6);
        expect(next.consecutiveFailures).toBe(0);
        expect(next.lastResponseTimeMs).toBe(25);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });

      it('retains UP on 1st failure and resets consecutiveSuccesses to 0', () => {
        const check = {
          success: false,
          statusCode: 500,
          errorMessage: 'Internal Server Error',
        };

        const next = computeNextState(upMonitor, check);

        expect(next.status).toBe(MonitorStatus.UP);
        expect(next.consecutiveFailures).toBe(1);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });

      it('retains UP on 2nd consecutive failure (does not mark DOWN)', () => {
        const current = {
          status: MonitorStatus.UP,
          consecutiveFailures: 1,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: false,
          statusCode: null,
          errorMessage: 'Connection refused',
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.UP);
        expect(next.consecutiveFailures).toBe(2);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });

      it('transitions UP → DOWN on 3rd consecutive failure', () => {
        const current = {
          status: MonitorStatus.UP,
          consecutiveFailures: 2,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: false,
          statusCode: 503,
          errorMessage: 'Service Unavailable',
          checkedAt: new Date('2026-03-01T12:05:00Z'),
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.DOWN);
        expect(next.consecutiveFailures).toBe(3);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(true);
        expect(next.transition).toEqual({
          from: MonitorStatus.UP,
          to: MonitorStatus.DOWN,
          timestamp: new Date('2026-03-01T12:05:00Z'),
        });
      });

      it('resets consecutiveFailures back to 0 if a success occurs after 1 or 2 failures', () => {
        const current = {
          status: MonitorStatus.UP,
          consecutiveFailures: 2,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: true,
          statusCode: 200,
          responseTimeMs: 35,
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.UP);
        expect(next.consecutiveFailures).toBe(0);
        expect(next.consecutiveSuccesses).toBe(1);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });
    });

    describe('Transitions while DOWN', () => {
      const downMonitor = {
        status: MonitorStatus.DOWN,
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
        lastResponseTimeMs: null,
      };

      it('retains DOWN on repeated failures without creating repeated transitions (4th failure)', () => {
        const check = {
          success: false,
          statusCode: 500,
          errorMessage: 'Still down',
        };

        const next = computeNextState(downMonitor, check);

        expect(next.status).toBe(MonitorStatus.DOWN);
        expect(next.consecutiveFailures).toBe(4);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });

      it('retains DOWN on 10th failure without repeated transition', () => {
        const current = {
          status: MonitorStatus.DOWN,
          consecutiveFailures: 9,
          consecutiveSuccesses: 0,
        };
        const check = {
          success: false,
          statusCode: 504,
          errorMessage: 'Gateway Timeout',
        };

        const next = computeNextState(current, check);

        expect(next.status).toBe(MonitorStatus.DOWN);
        expect(next.consecutiveFailures).toBe(10);
        expect(next.consecutiveSuccesses).toBe(0);
        expect(next.hasTransition).toBe(false);
        expect(next.transition).toBeNull();
      });

      it('transitions DOWN → UP immediately on 1st successful check', () => {
        const check = {
          success: true,
          statusCode: 200,
          responseTimeMs: 50,
          checkedAt: new Date('2026-03-01T12:10:00Z'),
        };

        const next = computeNextState(downMonitor, check);

        expect(next.status).toBe(MonitorStatus.UP);
        expect(next.consecutiveSuccesses).toBe(1);
        expect(next.consecutiveFailures).toBe(0);
        expect(next.lastResponseTimeMs).toBe(50);
        expect(next.hasTransition).toBe(true);
        expect(next.transition).toEqual({
          from: MonitorStatus.DOWN,
          to: MonitorStatus.UP,
          timestamp: new Date('2026-03-01T12:10:00Z'),
        });
      });
    });

    describe('Custom failure thresholds and edge cases', () => {
      it('respects a custom failure threshold (e.g. 5 failures)', () => {
        const current = {
          status: MonitorStatus.UP,
          consecutiveFailures: 3,
          consecutiveSuccesses: 0,
        };
        const check = { success: false, statusCode: 500 };

        // With threshold 5: 4th failure should keep status UP
        const next4 = computeNextState(current, check, { failureThreshold: 5 });
        expect(next4.status).toBe(MonitorStatus.UP);
        expect(next4.consecutiveFailures).toBe(4);
        expect(next4.hasTransition).toBe(false);

        // 5th failure triggers transition to DOWN
        const next5 = computeNextState(next4, check, { failureThreshold: 5 });
        expect(next5.status).toBe(MonitorStatus.DOWN);
        expect(next5.consecutiveFailures).toBe(5);
        expect(next5.hasTransition).toBe(true);
      });

      it('safely handles empty current state objects with defaults', () => {
        const next = computeNextState({}, { success: true, statusCode: 200 });
        expect(next.status).toBe(MonitorStatus.UP);
        expect(next.consecutiveSuccesses).toBe(1);
        expect(next.consecutiveFailures).toBe(0);
        expect(next.hasTransition).toBe(true);
        expect(next.transition.from).toBe(MonitorStatus.UNKNOWN);
        expect(next.transition.to).toBe(MonitorStatus.UP);
      });
    });
  });

  // ── Database Processing & Concurrency: processCheckResult ──────────────────

  describe('processCheckResult (database integration and concurrency safety)', () => {
    let mockDb;

    beforeEach(() => {
      mockDb = createMockDb();
    });

    const BASE_MONITOR = {
      id: 'monitor-123',
      userId: 'user-001',
      name: 'Production API',
      url: 'https://api.example.com/health',
      status: MonitorStatus.UP,
      consecutiveFailures: 0,
      consecutiveSuccesses: 10,
      lastCheckedAt: new Date('2026-03-01T12:00:00Z'),
      lastResponseTimeMs: 40,
    };

    it('processes a successful check in a transaction with row-level locking', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(BASE_MONITOR);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-1', ...data }));
      mockDb.monitor.update.mockImplementation(({ data }) => Promise.resolve({ ...BASE_MONITOR, ...data }));

      const checkResult = {
        success: true,
        statusCode: 200,
        responseTimeMs: 38,
        checkedAt: new Date('2026-03-01T12:01:00Z'),
      };

      const outcome = await processCheckResult('monitor-123', checkResult, { db: mockDb });

      // Verifies interactive transaction was used
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);

      // Verifies row-level lock query was executed
      expect(mockDb.$queryRaw).toHaveBeenCalled();

      // Verifies CheckResult was created
      expect(mockDb.checkResult.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          monitorId: 'monitor-123',
          userId: 'user-001',
          success: true,
          statusCode: 200,
          responseTimeMs: 38,
        }),
      });

      // Verifies Monitor was updated with reset failures and incremented successes
      expect(mockDb.monitor.update).toHaveBeenCalledWith({
        where: { id: 'monitor-123' },
        data: expect.objectContaining({
          status: MonitorStatus.UP,
          consecutiveFailures: 0,
          consecutiveSuccesses: 11,
          lastResponseTimeMs: 38,
        }),
      });

      expect(outcome.previousStatus).toBe(MonitorStatus.UP);
      expect(outcome.currentStatus).toBe(MonitorStatus.UP);
      expect(outcome.hasTransition).toBe(false);
      expect(outcome.ignoredAsStale).toBe(false);
    });

    it('detects and applies the 3-failure threshold transition UP → DOWN', async () => {
      const monitorWithTwoFailures = {
        ...BASE_MONITOR,
        status: MonitorStatus.UP,
        consecutiveFailures: 2,
        consecutiveSuccesses: 0,
        lastCheckedAt: new Date('2026-03-01T12:02:00Z'),
      };

      mockDb.monitor.findUnique.mockResolvedValue(monitorWithTwoFailures);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-3', ...data }));
      mockDb.monitor.update.mockImplementation(({ data }) => Promise.resolve({ ...monitorWithTwoFailures, ...data }));

      const thirdFailure = {
        success: false,
        statusCode: 503,
        errorMessage: 'Service Unavailable',
        checkedAt: new Date('2026-03-01T12:03:00Z'),
      };

      const outcome = await processCheckResult('monitor-123', thirdFailure, { db: mockDb });

      expect(mockDb.monitor.update).toHaveBeenCalledWith({
        where: { id: 'monitor-123' },
        data: expect.objectContaining({
          status: MonitorStatus.DOWN,
          consecutiveFailures: 3,
          consecutiveSuccesses: 0,
        }),
      });

      expect(outcome.previousStatus).toBe(MonitorStatus.UP);
      expect(outcome.currentStatus).toBe(MonitorStatus.DOWN);
      expect(outcome.hasTransition).toBe(true);
      expect(outcome.transition).toEqual({
        from: MonitorStatus.UP,
        to: MonitorStatus.DOWN,
        timestamp: new Date('2026-03-01T12:03:00Z'),
      });
    });

    it('recovers from DOWN → UP on first successful check', async () => {
      const downMonitor = {
        ...BASE_MONITOR,
        status: MonitorStatus.DOWN,
        consecutiveFailures: 5,
        consecutiveSuccesses: 0,
        lastCheckedAt: new Date('2026-03-01T12:05:00Z'),
      };

      mockDb.monitor.findUnique.mockResolvedValue(downMonitor);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-rec', ...data }));
      mockDb.monitor.update.mockImplementation(({ data }) => Promise.resolve({ ...downMonitor, ...data }));

      const recoveryCheck = {
        success: true,
        statusCode: 200,
        responseTimeMs: 42,
        checkedAt: new Date('2026-03-01T12:06:00Z'),
      };

      const outcome = await processCheckResult('monitor-123', recoveryCheck, { db: mockDb });

      expect(mockDb.monitor.update).toHaveBeenCalledWith({
        where: { id: 'monitor-123' },
        data: expect.objectContaining({
          status: MonitorStatus.UP,
          consecutiveFailures: 0,
          consecutiveSuccesses: 1,
          lastResponseTimeMs: 42,
        }),
      });

      expect(outcome.previousStatus).toBe(MonitorStatus.DOWN);
      expect(outcome.currentStatus).toBe(MonitorStatus.UP);
      expect(outcome.hasTransition).toBe(true);
      expect(outcome.transition).toEqual({
        from: MonitorStatus.DOWN,
        to: MonitorStatus.UP,
        timestamp: new Date('2026-03-01T12:06:00Z'),
      });
    });

    it('ignores stale/out-of-order checks and preserves monitor state', async () => {
      const monitorWithFreshCheck = {
        ...BASE_MONITOR,
        status: MonitorStatus.UP,
        lastCheckedAt: new Date('2026-03-01T12:10:00Z'),
      };

      mockDb.monitor.findUnique.mockResolvedValue(monitorWithFreshCheck);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-stale', ...data }));

      // Check timestamp is older than lastCheckedAt (e.g. out-of-order delivery)
      const staleCheck = {
        success: false,
        statusCode: 500,
        checkedAt: new Date('2026-03-01T12:05:00Z'),
      };

      const outcome = await processCheckResult('monitor-123', staleCheck, { db: mockDb });

      // CheckResult is still recorded in history for telemetry
      expect(mockDb.checkResult.create).toHaveBeenCalled();

      // Monitor health state is NOT updated
      expect(mockDb.monitor.update).not.toHaveBeenCalled();

      expect(outcome.ignoredAsStale).toBe(true);
      expect(outcome.hasTransition).toBe(false);
      expect(outcome.currentStatus).toBe(MonitorStatus.UP);
    });

    it('throws when monitorId or checkResult are invalid', async () => {
      await expect(processCheckResult('', { success: true }, { db: mockDb })).rejects.toThrow('monitorId is required');
      await expect(processCheckResult('monitor-123', null, { db: mockDb })).rejects.toThrow('checkResult is required');
    });

    it('throws when monitor is not found in database', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(null);

      await expect(
        processCheckResult('non-existent', { success: true }, { db: mockDb })
      ).rejects.toThrow('Monitor not found');
    });
  });
});
