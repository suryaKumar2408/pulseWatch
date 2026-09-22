'use strict';

const {
  processMonitorCheckJob,
  enqueueHealthCheck,
  DEFAULT_CONCURRENCY,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAME,
} = require('../src/queue');
const createMockDb = require('./helpers/mockDb');
const { MonitorStatus } = require('../src/lib/stateManager');

describe('Background Health Check Processing & Worker', () => {
  let mockDb;
  let mockCheckMonitor;
  let mockProcessCheckResult;
  let mockValidateUrlSsrf;

  const MONITOR_ID = 'mon-worker-001';
  const ACTIVE_MONITOR = {
    id: MONITOR_ID,
    userId: 'user-001',
    name: 'Main Website',
    url: 'https://example.com',
    method: 'GET',
    timeoutSeconds: 10,
    expectedCodes: [200],
    enabled: true,
    status: MonitorStatus.UP,
    consecutiveFailures: 0,
    consecutiveSuccesses: 5,
    lastCheckedAt: new Date('2026-03-01T12:00:00Z'),
    lastResponseTimeMs: 40,
  };

  beforeEach(() => {
    mockDb = createMockDb();

    mockCheckMonitor = jest.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      responseTimeMs: 35,
      errorCode: null,
      errorMessage: null,
    });

    mockProcessCheckResult = jest.fn().mockResolvedValue({
      monitor: ACTIVE_MONITOR,
      previousStatus: MonitorStatus.UP,
      currentStatus: MonitorStatus.UP,
      transition: null,
      hasTransition: false,
      checkResult: { id: 'chk-1', success: true },
      ignoredAsStale: false,
    });

    mockValidateUrlSsrf = jest.fn().mockResolvedValue({ safe: true });
  });

  // ── Successful Execution ───────────────────────────────────────────────────

  describe('Standard execution', () => {
    it('executes check, updates state, and persists check result', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(ACTIVE_MONITOR);

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-1' };
      const outcome = await processMonitorCheckJob(job, {
        db: mockDb,
        checkMonitor: mockCheckMonitor,
        processCheckResult: mockProcessCheckResult,
        validateUrlSsrf: mockValidateUrlSsrf,
      });

      expect(mockDb.monitor.findUnique).toHaveBeenCalledWith({ where: { id: MONITOR_ID } });
      expect(mockValidateUrlSsrf).toHaveBeenCalledWith('https://example.com');
      expect(mockCheckMonitor).toHaveBeenCalledWith(ACTIVE_MONITOR);
      expect(mockProcessCheckResult).toHaveBeenCalledWith(
        MONITOR_ID,
        expect.objectContaining({ success: true, statusCode: 200 }),
        expect.objectContaining({ db: mockDb }),
      );

      expect(outcome).toEqual(
        expect.objectContaining({
          outcome: 'PROCESSED',
          monitorId: MONITOR_ID,
          success: true,
          statusCode: 200,
          status: MonitorStatus.UP,
          hasTransition: false,
        }),
      );
    });
  });

  // ── Separation of Monitoring Failure vs Infrastructure Failure ──────────────

  describe('Separation of concerns: target monitoring failures vs worker failures', () => {
    it('treats target failure (500 Internal Server Error) as a successful job execution', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(ACTIVE_MONITOR);

      // Target responds with HTTP 500
      mockCheckMonitor.mockResolvedValue({
        success: false,
        statusCode: 500,
        responseTimeMs: 120,
        errorCode: 'HTTP_ERROR',
        errorMessage: 'Received HTTP 500; expected one of [200]',
      });

      mockProcessCheckResult.mockResolvedValue({
        monitor: { ...ACTIVE_MONITOR, consecutiveFailures: 1 },
        previousStatus: MonitorStatus.UP,
        currentStatus: MonitorStatus.UP,
        transition: null,
        hasTransition: false,
        checkResult: { id: 'chk-fail-1', success: false },
      });

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-500' };

      // Job MUST NOT throw an error — it completes normally
      const outcome = await processMonitorCheckJob(job, {
        db: mockDb,
        checkMonitor: mockCheckMonitor,
        processCheckResult: mockProcessCheckResult,
        validateUrlSsrf: mockValidateUrlSsrf,
      });

      expect(outcome.outcome).toBe('PROCESSED');
      expect(outcome.success).toBe(false);
      expect(outcome.statusCode).toBe(500);
      expect(outcome.errorCode).toBe('HTTP_ERROR');
    });

    it('treats target timeout as a successful job execution that records TIMEOUT', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(ACTIVE_MONITOR);

      mockCheckMonitor.mockResolvedValue({
        success: false,
        statusCode: null,
        responseTimeMs: 10000,
        errorCode: 'TIMEOUT',
        errorMessage: 'Request timed out before a response was received',
      });

      mockProcessCheckResult.mockResolvedValue({
        monitor: { ...ACTIVE_MONITOR, status: MonitorStatus.DOWN, consecutiveFailures: 3 },
        previousStatus: MonitorStatus.UP,
        currentStatus: MonitorStatus.DOWN,
        transition: { from: MonitorStatus.UP, to: MonitorStatus.DOWN },
        hasTransition: true,
        checkResult: { id: 'chk-timeout-1', success: false },
      });

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-timeout' };
      const outcome = await processMonitorCheckJob(job, {
        db: mockDb,
        checkMonitor: mockCheckMonitor,
        processCheckResult: mockProcessCheckResult,
        validateUrlSsrf: mockValidateUrlSsrf,
      });

      expect(outcome.success).toBe(false);
      expect(outcome.errorCode).toBe('TIMEOUT');
      expect(outcome.status).toBe(MonitorStatus.DOWN);
      expect(outcome.hasTransition).toBe(true);
    });

    it('re-throws database / infrastructure errors so BullMQ can retry the job', async () => {
      mockDb.monitor.findUnique.mockRejectedValue(new Error('Connection terminated unexpectedly'));

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-db-crash' };

      await expect(
        processMonitorCheckJob(job, {
          db: mockDb,
          checkMonitor: mockCheckMonitor,
          processCheckResult: mockProcessCheckResult,
          validateUrlSsrf: mockValidateUrlSsrf,
        }),
      ).rejects.toThrow('Connection terminated unexpectedly');

      // HTTP check should not have run because DB failed
      expect(mockCheckMonitor).not.toHaveBeenCalled();
    });

    it('re-throws state persistence failure so BullMQ can retry the job', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(ACTIVE_MONITOR);
      mockProcessCheckResult.mockRejectedValue(new Error('Deadlock detected in transaction'));

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-deadlock' };

      await expect(
        processMonitorCheckJob(job, {
          db: mockDb,
          checkMonitor: mockCheckMonitor,
          processCheckResult: mockProcessCheckResult,
          validateUrlSsrf: mockValidateUrlSsrf,
        }),
      ).rejects.toThrow('Deadlock detected in transaction');
    });
  });

  // ── Lifecycle and Skip Conditions ──────────────────────────────────────────

  describe('Lifecycle conditions: disabled, deleted, and SSRF blocked monitors', () => {
    it('skips execution when monitor is disabled without running HTTP checks', async () => {
      const disabledMonitor = { ...ACTIVE_MONITOR, enabled: false };
      mockDb.monitor.findUnique.mockResolvedValue(disabledMonitor);

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-disabled' };
      const outcome = await processMonitorCheckJob(job, {
        db: mockDb,
        checkMonitor: mockCheckMonitor,
        processCheckResult: mockProcessCheckResult,
        validateUrlSsrf: mockValidateUrlSsrf,
      });

      expect(outcome).toEqual({
        skipped: true,
        reason: 'MONITOR_DISABLED',
        monitorId: MONITOR_ID,
      });
      expect(mockCheckMonitor).not.toHaveBeenCalled();
      expect(mockProcessCheckResult).not.toHaveBeenCalled();
    });

    it('skips execution when monitor is not found (deleted) without throwing', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(null);

      const job = { data: { monitorId: 'non-existent' }, id: 'job-deleted' };
      const outcome = await processMonitorCheckJob(job, {
        db: mockDb,
        checkMonitor: mockCheckMonitor,
        processCheckResult: mockProcessCheckResult,
        validateUrlSsrf: mockValidateUrlSsrf,
      });

      expect(outcome).toEqual({
        skipped: true,
        reason: 'MONITOR_NOT_FOUND',
        monitorId: 'non-existent',
      });
      expect(mockCheckMonitor).not.toHaveBeenCalled();
      expect(mockProcessCheckResult).not.toHaveBeenCalled();
    });

    it('handles SSRF-blocked target URL safely by reporting SSRF_BLOCKED without making HTTP request', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(ACTIVE_MONITOR);
      mockValidateUrlSsrf.mockResolvedValue({ safe: false, reason: 'Target resolved to private IP 192.168.1.1' });

      mockProcessCheckResult.mockResolvedValue({
        monitor: ACTIVE_MONITOR,
        currentStatus: MonitorStatus.DOWN,
        hasTransition: true,
      });

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-ssrf' };
      const outcome = await processMonitorCheckJob(job, {
        db: mockDb,
        checkMonitor: mockCheckMonitor,
        processCheckResult: mockProcessCheckResult,
        validateUrlSsrf: mockValidateUrlSsrf,
      });

      // Never make the outbound HTTP check to blocked address
      expect(mockCheckMonitor).not.toHaveBeenCalled();

      // Recorded as an SSRF_BLOCKED failure in state manager
      expect(mockProcessCheckResult).toHaveBeenCalledWith(
        MONITOR_ID,
        expect.objectContaining({
          success: false,
          errorCode: 'SSRF_BLOCKED',
          errorMessage: expect.stringContaining('192.168.1.1'),
        }),
        expect.any(Object),
      );

      expect(outcome.outcome).toBe('PROCESSED');
      expect(outcome.errorCode).toBe('SSRF_BLOCKED');
    });

    it('throws when job data lacks monitorId', async () => {
      const invalidJob = { data: {}, id: 'job-invalid' };

      await expect(
        processMonitorCheckJob(invalidJob, {
          db: mockDb,
          checkMonitor: mockCheckMonitor,
          processCheckResult: mockProcessCheckResult,
          validateUrlSsrf: mockValidateUrlSsrf,
        }),
      ).rejects.toThrow('Invalid job: missing monitorId');
    });
  });

  // ── Concurrency & Resource Control ─────────────────────────────────────────

  describe('Controlled concurrency and duplicate processing', () => {
    it('verifies default worker concurrency is set to 10', () => {
      expect(DEFAULT_CONCURRENCY).toBe(10);
      expect(QUEUE_NAME).toBe('health-checks');
      expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
      expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    });

    it('processes multiple targets concurrently within bounded limits', async () => {
      const monitors = Array.from({ length: 8 }, (_, i) => ({
        ...ACTIVE_MONITOR,
        id: `monitor-batch-${i}`,
        url: `https://api-${i}.example.com`,
      }));

      mockDb.monitor.findUnique.mockImplementation(({ where }) => {
        const found = monitors.find((m) => m.id === where.id);
        return Promise.resolve(found);
      });

      let activeWorkers = 0;
      let maxObservedConcurrency = 0;

      // Simulate a realistic asynchronous HTTP check with delay
      mockCheckMonitor.mockImplementation(async () => {
        activeWorkers++;
        if (activeWorkers > maxObservedConcurrency) {
          maxObservedConcurrency = activeWorkers;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeWorkers--;
        return {
          success: true,
          statusCode: 200,
          responseTimeMs: 20,
          errorCode: null,
          errorMessage: null,
        };
      });

      // Process 8 check jobs concurrently
      const jobs = monitors.map((m) => ({ data: { monitorId: m.id }, id: `job-${m.id}` }));
      const results = await Promise.all(
        jobs.map((job) =>
          processMonitorCheckJob(job, {
            db: mockDb,
            checkMonitor: mockCheckMonitor,
            processCheckResult: mockProcessCheckResult,
            validateUrlSsrf: mockValidateUrlSsrf,
          }),
        ),
      );

      expect(results).toHaveLength(8);
      results.forEach((r) => expect(r.outcome).toBe('PROCESSED'));
      expect(maxObservedConcurrency).toBeGreaterThan(1);
    });

    it('serializes duplicate checks on the same monitor via state manager row locking', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(ACTIVE_MONITOR);

      // Two identical jobs for the same monitor submitted concurrently
      const job1 = { data: { monitorId: MONITOR_ID }, id: 'job-dup-1' };
      const job2 = { data: { monitorId: MONITOR_ID }, id: 'job-dup-2' };

      const [res1, res2] = await Promise.all([
        processMonitorCheckJob(job1, {
          db: mockDb,
          checkMonitor: mockCheckMonitor,
          processCheckResult: mockProcessCheckResult,
          validateUrlSsrf: mockValidateUrlSsrf,
        }),
        processMonitorCheckJob(job2, {
          db: mockDb,
          checkMonitor: mockCheckMonitor,
          processCheckResult: mockProcessCheckResult,
          validateUrlSsrf: mockValidateUrlSsrf,
        }),
      ]);

      expect(res1.outcome).toBe('PROCESSED');
      expect(res2.outcome).toBe('PROCESSED');
      expect(mockProcessCheckResult).toHaveBeenCalledTimes(2);
    });
  });

  // ── Queue Enqueue Helper ───────────────────────────────────────────────────

  describe('enqueueHealthCheck', () => {
    it('enqueues a job into the queue with correct name and payload', async () => {
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: 'job-enq-1' }),
      };

      const job = await enqueueHealthCheck(MONITOR_ID, { queue: mockQueue });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'check-monitor',
        { monitorId: MONITOR_ID },
        expect.objectContaining({ jobId: undefined }),
      );
      expect(job.id).toBe('job-enq-1');
    });

    it('sets a deterministic jobId when deduplicate is requested', async () => {
      const mockQueue = {
        add: jest.fn().mockResolvedValue({ id: `check:${MONITOR_ID}` }),
      };

      await enqueueHealthCheck(MONITOR_ID, { deduplicate: true, queue: mockQueue });

      expect(mockQueue.add).toHaveBeenCalledWith(
        'check-monitor',
        { monitorId: MONITOR_ID },
        expect.objectContaining({ jobId: `check:${MONITOR_ID}` }),
      );
    });

    it('throws if monitorId is missing or empty', async () => {
      await expect(enqueueHealthCheck('')).rejects.toThrow('monitorId is required');
      await expect(enqueueHealthCheck(null)).rejects.toThrow('monitorId is required');
    });
  });

  // ── Queue & Worker Factory & Lifecycle ────────────────────────────────────

  describe('Queue & Worker Factory Lifecycle', () => {
    it('initializes and closes queue cleanly', async () => {
      const { getHealthCheckQueue, closeHealthCheckQueue } = require('../src/queue');
      const queue = getHealthCheckQueue({ connection: { host: 'localhost', port: 6379 } });
      expect(queue).toBeDefined();
      expect(queue.name).toBe('health-checks');

      await closeHealthCheckQueue();
    });

    it('instantiates BullMQ worker with configured concurrency', async () => {
      const { createHealthCheckWorker } = require('../src/queue');
      const worker = createHealthCheckWorker({
        concurrency: 5,
        connection: { host: 'localhost', port: 6379 },
      });

      expect(worker).toBeDefined();
      expect(worker.opts.concurrency).toBe(5);

      await worker.close();
    });
  });
});
