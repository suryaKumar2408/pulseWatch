'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../src/app');
const createMockDb = require('./helpers/mockDb');
const { processCheckResult, MonitorStatus } = require('../src/lib/stateManager');

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('../src/lib/db', () => ({
  getDb:        jest.fn(),
  disconnectDb: jest.fn().mockResolvedValue(undefined),
  pingDb:       jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/lib/redis', () => ({
  pingRedis:       jest.fn().mockResolvedValue(true),
  disconnectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis:        jest.fn(),
}));

jest.mock('../src/lib/ssrf', () => ({
  validateUrlSsrf: jest.fn().mockResolvedValue({ safe: true }),
}));

const { getDb } = require('../src/lib/db');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID    = 'user-inc-001';
const OTHER_USER = 'user-inc-002';
const MONITOR_ID = 'monitor-inc-100';

function makeToken(userId = USER_ID) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const AUTH_HEADER = `Bearer ${makeToken()}`;

const MONITOR_FIXTURE = {
  id:                   MONITOR_ID,
  userId:               USER_ID,
  name:                 'Checkout API',
  url:                  'https://api.example.com/checkout',
  method:               'GET',
  intervalSeconds:      60,
  timeoutSeconds:       10,
  expectedCodes:        [200],
  enabled:              true,
  status:               'UP',
  consecutiveFailures:  0,
  consecutiveSuccesses: 10,
  lastCheckedAt:        new Date('2026-03-01T12:00:00Z'),
  lastResponseTimeMs:   50,
  createdAt:            new Date('2026-01-01T00:00:00Z'),
  updatedAt:            new Date('2026-01-01T00:00:00Z'),
};

const SAMPLE_INCIDENTS = [
  {
    id:              'inc-001',
    monitorId:       MONITOR_ID,
    userId:          USER_ID,
    status:          'RESOLVED',
    cause:           'Received HTTP 500; expected one of [200]',
    errorCode:       'HTTP_ERROR',
    statusCode:      500,
    startedAt:       new Date('2026-03-01T10:00:00Z'),
    resolvedAt:      new Date('2026-03-01T10:05:00Z'),
    durationSeconds: 300,
    createdAt:       new Date('2026-03-01T10:00:00Z'),
    updatedAt:       new Date('2026-03-01T10:05:00Z'),
  },
  {
    id:              'inc-002',
    monitorId:       MONITOR_ID,
    userId:          USER_ID,
    status:          'OPEN',
    cause:           'Request timed out before a response was received',
    errorCode:       'TIMEOUT',
    statusCode:      null,
    startedAt:       new Date('2026-03-01T11:00:00Z'),
    resolvedAt:      null,
    durationSeconds: null,
    createdAt:       new Date('2026-03-01T11:00:00Z'),
    updatedAt:       new Date('2026-03-01T11:00:00Z'),
  },
];

describe('Incident Management', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Incident Lifecycle: Creation, Deduplication, Resolution ─────────────────

  describe('Incident lifecycle in state manager', () => {
    it('creates an OPEN incident when monitor transitions to DOWN (3rd failure)', async () => {
      const monitorWithTwoFailures = {
        ...MONITOR_FIXTURE,
        status: MonitorStatus.UP,
        consecutiveFailures: 2,
        consecutiveSuccesses: 0,
      };

      mockDb.monitor.findUnique.mockResolvedValue(monitorWithTwoFailures);
      mockDb.incident.findFirst.mockResolvedValue(null); // No active open incident
      mockDb.incident.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'new-inc-1', ...data }),
      );
      mockDb.checkResult.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'chk-1', ...data }),
      );
      mockDb.monitor.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...monitorWithTwoFailures, ...data }),
      );

      const checkTime = new Date('2026-03-01T12:03:00Z');
      const failingCheck = {
        success: false,
        statusCode: 503,
        errorCode: 'HTTP_ERROR',
        errorMessage: 'Received HTTP 503; expected one of [200]',
        checkedAt: checkTime,
      };

      const outcome = await processCheckResult(MONITOR_ID, failingCheck, { db: mockDb });

      expect(outcome.currentStatus).toBe(MonitorStatus.DOWN);
      expect(outcome.hasTransition).toBe(true);

      // Verifies OPEN incident created with failure details
      expect(mockDb.incident.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          monitorId: MONITOR_ID,
          userId: USER_ID,
          status: 'OPEN',
          startedAt: checkTime,
          cause: 'Received HTTP 503; expected one of [200]',
          errorCode: 'HTTP_ERROR',
          statusCode: 503,
        }),
      });

      expect(outcome.incident).toBeDefined();
      expect(outcome.incident.status).toBe('OPEN');
    });

    it('does not create multiple incidents during an ongoing outage (4th and 5th failure)', async () => {
      const alreadyDownMonitor = {
        ...MONITOR_FIXTURE,
        status: MonitorStatus.DOWN,
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
      };

      mockDb.monitor.findUnique.mockResolvedValue(alreadyDownMonitor);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-2', ...data }));
      mockDb.monitor.update.mockImplementation(({ data }) => Promise.resolve({ ...alreadyDownMonitor, ...data }));

      const failingCheck = {
        success: false,
        statusCode: 503,
        errorCode: 'HTTP_ERROR',
        errorMessage: 'Still down',
        checkedAt: new Date('2026-03-01T12:04:00Z'),
      };

      const outcome = await processCheckResult(MONITOR_ID, failingCheck, { db: mockDb });

      expect(outcome.currentStatus).toBe(MonitorStatus.DOWN);
      expect(outcome.hasTransition).toBe(false);

      // Must NOT attempt to create another incident
      expect(mockDb.incident.create).not.toHaveBeenCalled();
      expect(outcome.incident).toBeNull();
    });

    it('resolves the open incident when monitor recovers (DOWN → UP) and computes duration', async () => {
      const downMonitor = {
        ...MONITOR_FIXTURE,
        status: MonitorStatus.DOWN,
        consecutiveFailures: 4,
        consecutiveSuccesses: 0,
        lastCheckedAt: new Date('2026-03-01T12:04:00Z'),
      };

      const openIncident = {
        id: 'inc-active',
        monitorId: MONITOR_ID,
        userId: USER_ID,
        status: 'OPEN',
        startedAt: new Date('2026-03-01T12:00:00Z'), // Started 5 minutes ago
      };

      mockDb.monitor.findUnique.mockResolvedValue(downMonitor);
      mockDb.incident.findFirst.mockResolvedValue(openIncident);
      mockDb.incident.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...openIncident, ...data }),
      );
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-rec', ...data }));
      mockDb.monitor.update.mockImplementation(({ data }) => Promise.resolve({ ...downMonitor, ...data }));

      const recoveryTime = new Date('2026-03-01T12:05:00Z'); // 300 seconds later
      const recoveryCheck = {
        success: true,
        statusCode: 200,
        responseTimeMs: 40,
        checkedAt: recoveryTime,
      };

      const outcome = await processCheckResult(MONITOR_ID, recoveryCheck, { db: mockDb });

      expect(outcome.currentStatus).toBe(MonitorStatus.UP);
      expect(outcome.hasTransition).toBe(true);

      // Verifies incident resolved with exact timestamp and duration in seconds
      expect(mockDb.incident.update).toHaveBeenCalledWith({
        where: { id: 'inc-active' },
        data: {
          status: 'RESOLVED',
          resolvedAt: recoveryTime,
          durationSeconds: 300,
        },
      });

      expect(outcome.incident).toBeDefined();
      expect(outcome.incident.status).toBe('RESOLVED');
      expect(outcome.incident.durationSeconds).toBe(300);
    });

    it('idempotently reuses existing open incident if concurrent transition occurred', async () => {
      const monitor = {
        ...MONITOR_FIXTURE,
        status: MonitorStatus.UP,
        consecutiveFailures: 2,
      };

      const existingOpenIncident = {
        id: 'inc-existing',
        monitorId: MONITOR_ID,
        status: 'OPEN',
        startedAt: new Date('2026-03-01T12:01:00Z'),
      };

      mockDb.monitor.findUnique.mockResolvedValue(monitor);
      // findFirst returns an already created open incident
      mockDb.incident.findFirst.mockResolvedValue(existingOpenIncident);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-x', ...data }));
      mockDb.monitor.update.mockResolvedValue(monitor);

      const check = { success: false, statusCode: 500, checkedAt: new Date() };
      const outcome = await processCheckResult(MONITOR_ID, check, { db: mockDb });

      // Does not create a duplicate
      expect(mockDb.incident.create).not.toHaveBeenCalled();
      expect(outcome.incident.id).toBe('inc-existing');
    });

    it('resolves all open incidents for the monitor if multiple were open', async () => {
      const downMonitor = {
        ...MONITOR_FIXTURE,
        status: MonitorStatus.DOWN,
        consecutiveFailures: 3,
      };

      const openIncidents = [
        { id: 'inc-old', monitorId: MONITOR_ID, status: 'OPEN', startedAt: new Date('2026-03-01T10:00:00Z') },
        { id: 'inc-new', monitorId: MONITOR_ID, status: 'OPEN', startedAt: new Date('2026-03-01T11:00:00Z') },
      ];

      mockDb.monitor.findUnique.mockResolvedValue(downMonitor);
      mockDb.incident.findMany.mockResolvedValue(openIncidents);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-y', ...data }));
      mockDb.monitor.update.mockResolvedValue(downMonitor);

      const recoveryCheck = {
        success: true,
        statusCode: 200,
        checkedAt: new Date('2026-03-01T12:00:00Z'),
      };

      await processCheckResult(MONITOR_ID, recoveryCheck, { db: mockDb });

      expect(mockDb.incident.update).toHaveBeenCalledTimes(2);
      expect(mockDb.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inc-old' }, data: expect.objectContaining({ status: 'RESOLVED' }) })
      );
      expect(mockDb.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inc-new' }, data: expect.objectContaining({ status: 'RESOLVED' }) })
      );
    });
  });

  // ── GET /api/v1/monitors/:id/incidents ──────────────────────────────────────

  describe('GET /api/v1/monitors/:id/incidents', () => {
    beforeEach(() => {
      mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
      mockDb.incident.findMany.mockResolvedValue(SAMPLE_INCIDENTS);
      mockDb.incident.count.mockResolvedValue(SAMPLE_INCIDENTS.length);
    });

    it('returns 200 with incidents list and pagination metadata for owned monitor', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/incidents`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);

      const resolved = res.body.data[0];
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.durationSeconds).toBe(300);
      expect(resolved.resolvedAt).toBeDefined();

      const open = res.body.data[1];
      expect(open.status).toBe('OPEN');
      expect(open.durationSeconds).toBeNull();
      expect(open.resolvedAt).toBeNull();

      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('filters incidents by status=OPEN', async () => {
      await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/incidents?status=OPEN`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            monitorId: MONITOR_ID,
            status: 'OPEN',
          }),
        }),
      );
    });

    it('filters incidents by status=RESOLVED', async () => {
      await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/incidents?status=RESOLVED`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            monitorId: MONITOR_ID,
            status: 'RESOLVED',
          }),
        }),
      );
    });

    it('returns 404 when requesting incidents for a monitor owned by another user', async () => {
      mockDb.monitor.findFirst.mockResolvedValue(null);

      const otherUserToken = makeToken(OTHER_USER);
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/incidents`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 when unauthenticated', async () => {
      const res = await request(app).get(`/api/v1/monitors/${MONITOR_ID}/incidents`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ── GET /api/v1/incidents ───────────────────────────────────────────────────

  describe('GET /api/v1/incidents (cross-monitor user overview)', () => {
    beforeEach(() => {
      mockDb.incident.findMany.mockResolvedValue(SAMPLE_INCIDENTS);
      mockDb.incident.count.mockResolvedValue(2);
    });

    it('returns 200 with all incidents for the authenticated user across monitors', async () => {
      const res = await request(app)
        .get('/api/v1/incidents')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(mockDb.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
          }),
        }),
      );
    });

    it('filters by status and monitorId', async () => {
      await request(app)
        .get(`/api/v1/incidents?status=OPEN&monitorId=${MONITOR_ID}`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            status: 'OPEN',
            monitorId: MONITOR_ID,
          }),
        }),
      );
    });

    it('returns 401 when request has no auth token', async () => {
      const res = await request(app).get('/api/v1/incidents');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
