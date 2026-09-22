'use strict';

const {
  isMonitorDue,
  MonitorScheduler,
  DEFAULT_TICK_INTERVAL_MS,
} = require('../src/scheduler');
const createMockDb = require('./helpers/mockDb');

describe('Interval-Based Automatic Monitor Scheduler', () => {
  // ── Pure Interval Logic: isMonitorDue ──────────────────────────────────────

  describe('isMonitorDue (pure interval evaluation)', () => {
    const baseTime = new Date('2026-03-01T12:00:00.000Z');

    it('returns true when an enabled monitor has never been checked', () => {
      const monitor = {
        id: 'mon-1',
        enabled: true,
        intervalSeconds: 60,
        lastCheckedAt: null,
      };

      expect(isMonitorDue(monitor, baseTime)).toBe(true);
    });

    it('returns false when an enabled monitor was checked recently (elapsed < interval)', () => {
      const monitor = {
        id: 'mon-2',
        enabled: true,
        intervalSeconds: 60,
        // Checked 30 seconds ago
        lastCheckedAt: new Date(baseTime.getTime() - 30 * 1000),
      };

      expect(isMonitorDue(monitor, baseTime)).toBe(false);
    });

    it('returns true when an enabled monitor reached or exceeded its interval', () => {
      const monitorExactlyDue = {
        id: 'mon-3',
        enabled: true,
        intervalSeconds: 60,
        // Checked exactly 60 seconds ago
        lastCheckedAt: new Date(baseTime.getTime() - 60 * 1000),
      };

      const monitorOverdue = {
        id: 'mon-4',
        enabled: true,
        intervalSeconds: 60,
        // Checked 90 seconds ago
        lastCheckedAt: new Date(baseTime.getTime() - 90 * 1000),
      };

      expect(isMonitorDue(monitorExactlyDue, baseTime)).toBe(true);
      expect(isMonitorDue(monitorOverdue, baseTime)).toBe(true);
    });

    it('returns false for disabled monitors, even if never checked or overdue', () => {
      const disabledNeverChecked = {
        id: 'mon-disabled-1',
        enabled: false,
        intervalSeconds: 60,
        lastCheckedAt: null,
      };

      const disabledOverdue = {
        id: 'mon-disabled-2',
        enabled: false,
        intervalSeconds: 30,
        lastCheckedAt: new Date(baseTime.getTime() - 1000 * 1000),
      };

      expect(isMonitorDue(disabledNeverChecked, baseTime)).toBe(false);
      expect(isMonitorDue(disabledOverdue, baseTime)).toBe(false);
    });

    it('respects different configured intervals (30s vs 300s)', () => {
      // 45 seconds elapsed
      const lastCheckTime = new Date(baseTime.getTime() - 45 * 1000);

      // 30s interval: 45s > 30s -> DUE
      const monitor30s = {
        enabled: true,
        intervalSeconds: 30,
        lastCheckedAt: lastCheckTime,
      };

      // 300s (5m) interval: 45s < 300s -> NOT DUE
      const monitor300s = {
        enabled: true,
        intervalSeconds: 300,
        lastCheckedAt: lastCheckTime,
      };

      expect(isMonitorDue(monitor300s, baseTime)).toBe(false);
      expect(isMonitorDue(monitor30s, baseTime)).toBe(true);
    });

    it('returns false for null or invalid monitor inputs without throwing', () => {
      expect(isMonitorDue(null)).toBe(false);
      expect(isMonitorDue(undefined)).toBe(false);
      expect(isMonitorDue({})).toBe(false);
    });
  });

  // ── Scheduler Orchestrator & Tick Execution ────────────────────────────────

  describe('MonitorScheduler tick execution', () => {
    let mockDb;
    let mockEnqueue;
    let scheduler;
    const now = new Date('2026-03-01T12:00:00.000Z');

    beforeEach(() => {
      mockDb = createMockDb();
      mockEnqueue = jest.fn().mockResolvedValue({ id: 'job-mock-1' });

      scheduler = new MonitorScheduler({
        db: mockDb,
        enqueueHealthCheck: mockEnqueue,
        tickIntervalMs: 1000,
      });
    });

    afterEach(async () => {
      await scheduler.stop();
    });

    it('queries enabled monitors and enqueues only those due for checking', async () => {
      const monitors = [
        // Due (never checked)
        { id: 'mon-due-1', enabled: true, intervalSeconds: 60, lastCheckedAt: null },
        // Not due (checked 10s ago)
        { id: 'mon-not-due', enabled: true, intervalSeconds: 60, lastCheckedAt: new Date(now.getTime() - 10000) },
        // Due (checked 70s ago)
        { id: 'mon-due-2', enabled: true, intervalSeconds: 60, lastCheckedAt: new Date(now.getTime() - 70000) },
      ];

      mockDb.monitor.findMany.mockResolvedValue(monitors);

      const result = await scheduler.tick(now);

      expect(mockDb.monitor.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
        select: expect.objectContaining({ id: true, intervalSeconds: true, lastCheckedAt: true }),
      });

      expect(result.totalMonitors).toBe(3);
      expect(result.dueCount).toBe(2);
      expect(result.dispatchedCount).toBe(2);
      expect(result.dispatchedIds).toEqual(['mon-due-1', 'mon-due-2']);

      // Verifies deterministic deduplication jobId was used
      expect(mockEnqueue).toHaveBeenCalledWith(
        'mon-due-1',
        expect.objectContaining({ jobId: expect.stringMatching(/^check:mon-due-1:\d+$/) }),
      );
      expect(mockEnqueue).toHaveBeenCalledWith(
        'mon-due-2',
        expect.objectContaining({ jobId: expect.stringMatching(/^check:mon-due-2:\d+$/) }),
      );
      expect(mockEnqueue).not.toHaveBeenCalledWith('mon-not-due', expect.anything());
    });

    it('prevents overlapping ticks using mutex guard', async () => {
      // Slow database query to hold isRunning = true
      let resolveSlowQuery;
      mockDb.monitor.findMany.mockImplementation(
        () => new Promise((resolve) => { resolveSlowQuery = resolve; }),
      );

      const firstTickPromise = scheduler.tick(now);

      // Trigger second tick while first is still pending
      const secondTickResult = await scheduler.tick(now);

      expect(secondTickResult).toEqual({
        skipped: true,
        reason: 'CONCURRENT_TICK',
      });

      // Complete first query
      resolveSlowQuery([]);
      await firstTickPromise;
    });

    it('continues processing remaining monitors if one enqueue call fails', async () => {
      const monitors = [
        { id: 'mon-fail', enabled: true, intervalSeconds: 60, lastCheckedAt: null },
        { id: 'mon-success', enabled: true, intervalSeconds: 60, lastCheckedAt: null },
      ];

      mockDb.monitor.findMany.mockResolvedValue(monitors);

      // First monitor fails to enqueue; second succeeds
      mockEnqueue
        .mockRejectedValueOnce(new Error('Redis connection error'))
        .mockResolvedValueOnce({ id: 'job-ok' });

      const result = await scheduler.tick(now);

      expect(result.totalMonitors).toBe(2);
      expect(result.dueCount).toBe(2);
      expect(result.dispatchedCount).toBe(1);
      expect(result.dispatchedIds).toEqual(['mon-success']);
    });
  });

  // ── Application Restart Scenarios ──────────────────────────────────────────

  describe('Application restart and deduplication resilience', () => {
    let mockDb;
    let mockEnqueue;

    beforeEach(() => {
      mockDb = createMockDb();
      mockEnqueue = jest.fn().mockResolvedValue({ id: 'job-restart-1' });
    });

    it('does not re-enqueue recently checked monitors on application startup/restart', async () => {
      const restartTime = new Date('2026-03-01T12:00:15.000Z');

      // State restored from database across app restart
      const monitors = [
        // Checked 15s ago, 60s interval -> NOT DUE
        {
          id: 'mon-recently-checked',
          enabled: true,
          intervalSeconds: 60,
          lastCheckedAt: new Date('2026-03-01T12:00:00.000Z'),
        },
        // Checked 120s ago, 60s interval -> OVERDUE
        {
          id: 'mon-overdue',
          enabled: true,
          intervalSeconds: 60,
          lastCheckedAt: new Date('2026-03-01T11:58:15.000Z'),
        },
        // Never checked -> DUE
        {
          id: 'mon-new',
          enabled: true,
          intervalSeconds: 60,
          lastCheckedAt: null,
        },
      ];

      mockDb.monitor.findMany.mockResolvedValue(monitors);

      // New scheduler instance started (simulating server boot)
      const freshScheduler = new MonitorScheduler({
        db: mockDb,
        enqueueHealthCheck: mockEnqueue,
      });

      const outcome = await freshScheduler.tick(restartTime);

      expect(outcome.dueCount).toBe(2);
      expect(outcome.dispatchedIds).toEqual(['mon-overdue', 'mon-new']);
      expect(mockEnqueue).not.toHaveBeenCalledWith('mon-recently-checked', expect.anything());

      await freshScheduler.stop();
    });

    it('produces identical deterministic jobIds for ticks within the same interval window', async () => {
      const monitor = {
        id: 'mon-bucket-test',
        enabled: true,
        intervalSeconds: 60,
        lastCheckedAt: null,
      };

      mockDb.monitor.findMany.mockResolvedValue([monitor]);

      const scheduler = new MonitorScheduler({
        db: mockDb,
        enqueueHealthCheck: mockEnqueue,
      });

      // Tick at 12:00:05
      await scheduler.tick(new Date('2026-03-01T12:00:05.000Z'));
      const firstJobId = mockEnqueue.mock.calls[0][1].jobId;

      // Tick at 12:00:25 (same 60-second window: 12:00:00 - 12:01:00)
      await scheduler.tick(new Date('2026-03-01T12:00:25.000Z'));
      const secondJobId = mockEnqueue.mock.calls[1][1].jobId;

      // Deterministic job IDs match -> BullMQ will deduplicate
      expect(firstJobId).toBe(secondJobId);

      await scheduler.stop();
    });
  });

  // ── Scheduler Lifecycle ───────────────────────────────────────────────────

  describe('Scheduler lifecycle (start & stop)', () => {
    it('starts and stops recurring timer cleanly', async () => {
      const mockDb = createMockDb();
      mockDb.monitor.findMany.mockResolvedValue([]);

      const scheduler = new MonitorScheduler({
        db: mockDb,
        enqueueHealthCheck: jest.fn(),
        tickIntervalMs: 50,
      });

      expect(DEFAULT_TICK_INTERVAL_MS).toBe(5000);

      scheduler.start();
      expect(scheduler.timer).toBeDefined();

      // Calling start again is idempotent
      scheduler.start();

      await scheduler.stop();
      expect(scheduler.timer).toBeNull();
    });
  });
});
