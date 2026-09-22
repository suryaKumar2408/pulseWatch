'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../src/app');
const createMockDb = require('./helpers/mockDb');
const { processCheckResult } = require('../src/lib/stateManager');

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

const USER_ID    = 'user-checks-001';
const OTHER_USER = 'user-checks-002';
const MONITOR_ID = 'monitor-checks-100';

function makeToken(userId = USER_ID) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const AUTH_HEADER = `Bearer ${makeToken()}`;

const MONITOR_FIXTURE = {
  id:                   MONITOR_ID,
  userId:               USER_ID,
  name:                 'Production Service',
  url:                  'https://example.com/health',
  method:               'GET',
  intervalSeconds:      60,
  timeoutSeconds:       10,
  expectedCodes:        [200],
  enabled:              true,
  status:               'UP',
  consecutiveFailures:  0,
  consecutiveSuccesses: 5,
  lastCheckedAt:        new Date('2026-03-01T12:00:00Z'),
  lastResponseTimeMs:   45,
  createdAt:            new Date('2026-01-01T00:00:00Z'),
  updatedAt:            new Date('2026-01-01T00:00:00Z'),
};

const SAMPLE_CHECKS = [
  {
    id:             'chk-001',
    monitorId:      MONITOR_ID,
    userId:         USER_ID,
    success:        true,
    statusCode:     200,
    responseTimeMs: 35,
    errorCode:      null,
    errorMessage:   null,
    checkedAt:      new Date('2026-03-01T12:00:00Z'),
  },
  {
    id:             'chk-002',
    monitorId:      MONITOR_ID,
    userId:         USER_ID,
    success:        false,
    statusCode:     500,
    responseTimeMs: 120,
    errorCode:      'HTTP_ERROR',
    errorMessage:   'Received HTTP 500; expected one of [200]',
    checkedAt:      new Date('2026-03-01T11:59:00Z'),
  },
  {
    id:             'chk-003',
    monitorId:      MONITOR_ID,
    userId:         USER_ID,
    success:        false,
    statusCode:     null,
    responseTimeMs: 10000,
    errorCode:      'TIMEOUT',
    errorMessage:   'Request timed out before a response was received',
    checkedAt:      new Date('2026-03-01T11:58:00Z'),
  },
];

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('Check History Persistence & Retrieval API', () => {
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

  // ── Authentication & Authorization ─────────────────────────────────────────

  describe('Authentication & ownership enforcement', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app).get(`/api/v1/monitors/${MONITOR_ID}/checks`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token is invalid', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks`)
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('returns 404 when monitor does not exist', async () => {
      mockDb.monitor.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/monitors/non-existent-id/checks')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when monitor is owned by a different user', async () => {
      // requireMonitorOwnership queries with { id, userId: req.user.id }
      mockDb.monitor.findFirst.mockResolvedValue(null);

      const otherUserToken = makeToken(OTHER_USER);
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── Retrieval & Data Structure ─────────────────────────────────────────────

  describe('GET /api/v1/monitors/:id/checks', () => {
    beforeEach(() => {
      mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
      mockDb.checkResult.findMany.mockResolvedValue(SAMPLE_CHECKS);
      mockDb.checkResult.count.mockResolvedValue(SAMPLE_CHECKS.length);
    });

    it('returns 200 with complete check history and metadata', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(3);

      // Verify all required telemetry fields are present
      const firstCheck = res.body.data[0];
      expect(firstCheck).toHaveProperty('id', 'chk-001');
      expect(firstCheck).toHaveProperty('monitorId', MONITOR_ID);
      expect(firstCheck).toHaveProperty('userId', USER_ID);
      expect(firstCheck).toHaveProperty('success', true);
      expect(firstCheck).toHaveProperty('statusCode', 200);
      expect(firstCheck).toHaveProperty('responseTimeMs', 35);
      expect(firstCheck).toHaveProperty('errorCode', null);
      expect(firstCheck).toHaveProperty('errorMessage', null);
      expect(firstCheck).toHaveProperty('checkedAt');

      // Verify failure fields on 2nd check
      const failedCheck = res.body.data[1];
      expect(failedCheck.success).toBe(false);
      expect(failedCheck.statusCode).toBe(500);
      expect(failedCheck.errorCode).toBe('HTTP_ERROR');
      expect(failedCheck.errorMessage).toContain('HTTP 500');

      // Verify pagination block
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });
    });

    it('supports the /history alias route with identical results', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/history`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.pagination.total).toBe(3);
    });
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  describe('Pagination parameters', () => {
    beforeEach(() => {
      mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
      mockDb.checkResult.findMany.mockResolvedValue([]);
      mockDb.checkResult.count.mockResolvedValue(55);
    });

    it('passes custom page and limit to Prisma queries', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?page=3&limit=10`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(mockDb.checkResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20, // (3 - 1) * 10
          take: 10,
        }),
      );

      expect(res.body.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 55,
        totalPages: 6,
      });
    });

    it('rejects limit greater than 100 with 400 validation error', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?limit=101`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid page number with 400 validation error', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?page=0`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── Filtering & Ordering ───────────────────────────────────────────────────

  describe('Filtering and ordering', () => {
    beforeEach(() => {
      mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
      mockDb.checkResult.findMany.mockResolvedValue([]);
      mockDb.checkResult.count.mockResolvedValue(0);
    });

    it('filters by success=true', async () => {
      await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?success=true`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.checkResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            monitorId: MONITOR_ID,
            success: true,
          }),
        }),
      );
    });

    it('filters by success=false', async () => {
      await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?success=false`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.checkResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            monitorId: MONITOR_ID,
            success: false,
          }),
        }),
      );
    });

    it('filters by date range with from and to', async () => {
      const fromStr = '2026-03-01T00:00:00.000Z';
      const toStr   = '2026-03-02T00:00:00.000Z';

      await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?from=${fromStr}&to=${toStr}`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.checkResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            monitorId: MONITOR_ID,
            checkedAt: {
              gte: new Date(fromStr),
              lte: new Date(toStr),
            },
          }),
        }),
      );
    });

    it('rejects invalid date strings with 400 validation error', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?from=not-a-date`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('orders by checkedAt desc by default', async () => {
      await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.checkResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { checkedAt: 'desc' },
        }),
      );
    });

    it('orders by checkedAt asc when requested', async () => {
      await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/checks?order=asc`)
        .set('Authorization', AUTH_HEADER);

      expect(mockDb.checkResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { checkedAt: 'asc' },
        }),
      );
    });
  });

  // ── State Manager Persistence Integration ──────────────────────────────────

  describe('State Manager errorCode persistence', () => {
    it('persists errorCode into checkResult record during processCheckResult', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(MONITOR_FIXTURE);
      mockDb.checkResult.create.mockImplementation(({ data }) => Promise.resolve({ id: 'chk-err-1', ...data }));
      mockDb.monitor.update.mockResolvedValue(MONITOR_FIXTURE);

      const checkWithErrorCode = {
        success: false,
        statusCode: 504,
        responseTimeMs: 5000,
        errorCode: 'TIMEOUT',
        errorMessage: 'Request timed out',
        checkedAt: new Date('2026-03-01T12:05:00Z'),
      };

      await processCheckResult(MONITOR_ID, checkWithErrorCode, { db: mockDb });

      expect(mockDb.checkResult.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          monitorId:      MONITOR_ID,
          userId:         USER_ID,
          success:        false,
          statusCode:     504,
          responseTimeMs: 5000,
          errorCode:      'TIMEOUT',
          errorMessage:   'Request timed out',
        }),
      });
    });
  });
});
