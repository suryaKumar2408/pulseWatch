'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../src/app');
const createMockDb = require('./helpers/mockDb');
const {
  calculatePercentile,
  calculatePeriodBounds,
  calculateIncidentDowntime,
  calculateSummary,
  getMonitorAnalytics,
  getUserAnalytics,
} = require('../src/analytics/analyticsService');

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

const USER_ID    = 'user-analytics-001';
const OTHER_USER = 'user-analytics-002';
const MONITOR_ID = 'monitor-analytics-100';

function makeToken(userId = USER_ID) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const AUTH_HEADER = `Bearer ${makeToken()}`;

const MONITOR_FIXTURE = {
  id:                   MONITOR_ID,
  userId:               USER_ID,
  name:                 'Production Gateway',
  url:                  'https://api.example.com/gateway',
  method:               'GET',
  intervalSeconds:      60,
  timeoutSeconds:       10,
  expectedCodes:        [200],
  enabled:              true,
  status:               'UP',
  consecutiveFailures:  0,
  consecutiveSuccesses: 10,
  lastCheckedAt:        new Date('2026-03-01T12:00:00Z'),
  lastResponseTimeMs:   45,
  createdAt:            new Date('2026-01-01T00:00:00Z'),
  updatedAt:            new Date('2026-01-01T00:00:00Z'),
};

describe('Stage 10: Monitoring Analytics Engine', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Pure Calculation Algorithms
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Algorithmic calculations', () => {
    describe('calculatePercentile', () => {
      it('returns null for empty array or non-array inputs', () => {
        expect(calculatePercentile([], 95)).toBeNull();
        expect(calculatePercentile(null, 95)).toBeNull();
        expect(calculatePercentile(undefined, 95)).toBeNull();
      });

      it('correctly calculates percentiles for a single-element array', () => {
        expect(calculatePercentile([150], 95)).toBe(150);
        expect(calculatePercentile([150], 99)).toBe(150);
        expect(calculatePercentile([150], 50)).toBe(150);
      });

      it('correctly calculates P95 and P99 for a 100-item sequential dataset', () => {
        // Dataset from 1 to 100
        const data = Array.from({ length: 100 }, (_, i) => i + 1);
        expect(calculatePercentile(data, 95)).toBe(95);
        expect(calculatePercentile(data, 99)).toBe(99);
        expect(calculatePercentile(data, 50)).toBe(50);
      });

      it('handles unordered data and ignores non-numeric values', () => {
        const unordered = [100, 20, null, 'invalid', 40, 60, 80];
        // Valid sorted: [20, 40, 60, 80, 100] (length 5)
        // P95: ceil(0.95 * 5) = 5 -> index 4 -> 100
        expect(calculatePercentile(unordered, 95)).toBe(100);
      });
    });

    describe('calculatePeriodBounds', () => {
      const fixedRef = new Date('2026-09-21T12:00:00.000Z');

      it('calculates 24h period bounds', () => {
        const bounds = calculatePeriodBounds('24h', undefined, undefined, fixedRef);
        expect(bounds.name).toBe('24h');
        expect(bounds.to.toISOString()).toBe('2026-09-21T12:00:00.000Z');
        expect(bounds.from.toISOString()).toBe('2026-09-20T12:00:00.000Z');
        expect(bounds.durationSeconds).toBe(86400);
      });

      it('calculates 7d period bounds', () => {
        const bounds = calculatePeriodBounds('7d', undefined, undefined, fixedRef);
        expect(bounds.name).toBe('7d');
        expect(bounds.from.toISOString()).toBe('2026-09-14T12:00:00.000Z');
        expect(bounds.durationSeconds).toBe(7 * 86400);
      });

      it('calculates 30d period bounds', () => {
        const bounds = calculatePeriodBounds('30d', undefined, undefined, fixedRef);
        expect(bounds.name).toBe('30d');
        expect(bounds.from.toISOString()).toBe('2026-08-22T12:00:00.000Z');
        expect(bounds.durationSeconds).toBe(30 * 86400);
      });

      it('accepts custom from and to bounds', () => {
        const customFrom = '2026-09-01T00:00:00.000Z';
        const customTo   = '2026-09-02T00:00:00.000Z';
        const bounds = calculatePeriodBounds('24h', customFrom, customTo, fixedRef);
        expect(bounds.from.toISOString()).toBe(customFrom);
        expect(bounds.to.toISOString()).toBe(customTo);
        expect(bounds.durationSeconds).toBe(86400);
      });
    });

    describe('calculateIncidentDowntime', () => {
      const windowStart = new Date('2026-09-20T00:00:00.000Z');
      const windowEnd   = new Date('2026-09-21T00:00:00.000Z'); // 24 hour window (86400s)

      it('returns 0 downtime when there are no incidents', () => {
        const res = calculateIncidentDowntime([], windowStart, windowEnd);
        expect(res.downtimeSeconds).toBe(0);
        expect(res.incidentCount).toBe(0);
        expect(res.incidentDurationSeconds).toBe(0);
      });

      it('calculates duration for a resolved incident fully within window', () => {
        const incidents = [
          {
            startedAt:  new Date('2026-09-20T01:00:00.000Z'),
            resolvedAt: new Date('2026-09-20T01:30:00.000Z'), // 30 mins = 1800s
          },
        ];
        const res = calculateIncidentDowntime(incidents, windowStart, windowEnd);
        expect(res.downtimeSeconds).toBe(1800);
        expect(res.incidentCount).toBe(1);
      });

      it('clamps an incident that started before window start', () => {
        const incidents = [
          {
            // Started 2 hours before window, resolved 1 hour into window
            startedAt:  new Date('2026-09-19T22:00:00.000Z'),
            resolvedAt: new Date('2026-09-20T01:00:00.000Z'),
          },
        ];
        const res = calculateIncidentDowntime(incidents, windowStart, windowEnd);
        // Only 1 hour (3600s) belongs inside window
        expect(res.downtimeSeconds).toBe(3600);
      });

      it('clamps an ongoing unresolved incident (resolvedAt: null)', () => {
        const refNow = new Date('2026-09-20T06:00:00.000Z');
        const incidents = [
          {
            // Started at 04:00, still ongoing at 06:00
            startedAt:  new Date('2026-09-20T04:00:00.000Z'),
            resolvedAt: null,
          },
        ];
        const res = calculateIncidentDowntime(incidents, windowStart, windowEnd, refNow);
        // Duration is from 04:00 to 06:00 = 2 hours = 7200s
        expect(res.downtimeSeconds).toBe(7200);
      });

      it('accumulates multiple incidents correctly', () => {
        const incidents = [
          {
            startedAt:  new Date('2026-09-20T01:00:00.000Z'),
            resolvedAt: new Date('2026-09-20T01:10:00.000Z'), // 600s
          },
          {
            startedAt:  new Date('2026-09-20T05:00:00.000Z'),
            resolvedAt: new Date('2026-09-20T05:20:00.000Z'), // 1200s
          },
        ];
        const res = calculateIncidentDowntime(incidents, windowStart, windowEnd);
        expect(res.downtimeSeconds).toBe(1800);
        expect(res.incidentCount).toBe(2);
      });
    });

    describe('calculateSummary', () => {
      const from = new Date('2026-09-20T00:00:00.000Z');
      const to   = new Date('2026-09-21T00:00:00.000Z');

      it('handles empty checks history (zero checks)', () => {
        const summary = calculateSummary({ checks: [], incidents: [], from, to });
        expect(summary.totalChecks).toBe(0);
        expect(summary.successfulChecks).toBe(0);
        expect(summary.failedChecks).toBe(0);
        expect(summary.uptimePercentage).toBe(100.0);
        expect(summary.averageResponseTime).toBeNull();
        expect(summary.p95ResponseTime).toBeNull();
        expect(summary.p99ResponseTime).toBeNull();
        expect(summary.downtime).toBe(0);
        expect(summary.incidentCount).toBe(0);
      });

      it('calculates 100% uptime with successful checks', () => {
        const checks = [
          { success: true, responseTimeMs: 100 },
          { success: true, responseTimeMs: 200 },
        ];
        const summary = calculateSummary({ checks, incidents: [], from, to });
        expect(summary.uptimePercentage).toBe(100.0);
        expect(summary.totalChecks).toBe(2);
        expect(summary.successfulChecks).toBe(2);
        expect(summary.failedChecks).toBe(0);
        expect(summary.averageResponseTime).toBe(150);
        expect(summary.p95ResponseTime).toBe(200);
        expect(summary.p99ResponseTime).toBe(200);
      });

      it('calculates partial uptime and ignores null response times (network errors)', () => {
        const checks = [
          { success: true, responseTimeMs: 50 },
          { success: true, responseTimeMs: 70 },
          { success: false, responseTimeMs: null }, // network timeout
          { success: false, responseTimeMs: 500 },  // 500 server error
        ];
        const summary = calculateSummary({ checks, incidents: [], from, to });
        expect(summary.totalChecks).toBe(4);
        expect(summary.successfulChecks).toBe(2);
        expect(summary.failedChecks).toBe(2);
        expect(summary.uptimePercentage).toBe(50.0);
        // Average of [50, 70, 500] = 620 / 3 = 206.67
        expect(summary.averageResponseTime).toBe(206.67);
      });

      it('calculates 0% uptime when all checks fail', () => {
        const checks = [
          { success: false, responseTimeMs: null },
          { success: false, responseTimeMs: null },
        ];
        const summary = calculateSummary({ checks, incidents: [], from, to });
        expect(summary.totalChecks).toBe(2);
        expect(summary.successfulChecks).toBe(0);
        expect(summary.failedChecks).toBe(2);
        expect(summary.uptimePercentage).toBe(0.0);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Service Layer: getMonitorAnalytics & getUserAnalytics
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Service Layer', () => {
    it('aggregates monitor data correctly using findMany fallback', async () => {
      mockDb.incident.findMany.mockResolvedValue([
        {
          id: 'inc-1',
          startedAt:  new Date(Date.now() - 3600 * 1000),
          resolvedAt: new Date(Date.now() - 1800 * 1000), // 1800s
          durationSeconds: 1800,
          status: 'RESOLVED',
        },
      ]);

      mockDb.checkResult.findMany.mockResolvedValue([
        { success: true, responseTimeMs: 40 },
        { success: true, responseTimeMs: 60 },
        { success: false, responseTimeMs: null },
      ]);

      const res = await getMonitorAnalytics(mockDb, {
        monitorId: MONITOR_ID,
        period: '24h',
      });

      expect(res.monitorId).toBe(MONITOR_ID);
      expect(res.period.name).toBe('24h');
      expect(res.summary.totalChecks).toBe(3);
      expect(res.summary.successfulChecks).toBe(2);
      expect(res.summary.failedChecks).toBe(1);
      expect(res.summary.uptimePercentage).toBe(66.67);
      expect(res.summary.downtimeSeconds).toBe(1800);
      expect(res.summary.incidentCount).toBe(1);
      expect(res.summary.averageResponseTime).toBe(50);
    });

    it('uses $queryRaw when direct PostgreSQL aggregates are available', async () => {
      mockDb.incident.findMany.mockResolvedValue([]);
      mockDb.$queryRaw.mockResolvedValue([
        {
          total_checks: 1000,
          successful_checks: 995,
          failed_checks: 5,
          avg_response_time: 42.5,
          p95: 85.0,
          p99: 140.0,
        },
      ]);

      const res = await getMonitorAnalytics(mockDb, {
        monitorId: MONITOR_ID,
        period: '7d',
      });

      expect(res.summary.totalChecks).toBe(1000);
      expect(res.summary.successfulChecks).toBe(995);
      expect(res.summary.failedChecks).toBe(5);
      expect(res.summary.uptimePercentage).toBe(99.5);
      expect(res.summary.averageResponseTime).toBe(42.5);
      expect(res.summary.p95ResponseTime).toBe(85.0);
      expect(res.summary.p99ResponseTime).toBe(140.0);
    });

    it('getUserAnalytics aggregates metrics across multiple monitors', async () => {
      mockDb.monitor.findMany.mockResolvedValue([
        { id: 'mon-1', name: 'API 1', url: 'https://api1.example.com', status: 'UP' },
        { id: 'mon-2', name: 'API 2', url: 'https://api2.example.com', status: 'DOWN' },
      ]);

      mockDb.incident.findMany
        .mockResolvedValueOnce([]) // mon-1
        .mockResolvedValueOnce([   // mon-2
          {
            id: 'inc-2',
            startedAt: new Date(Date.now() - 600 * 1000),
            resolvedAt: null,
            durationSeconds: null,
            status: 'OPEN',
          },
        ]);

      mockDb.checkResult.findMany
        .mockResolvedValueOnce([ // mon-1
          { success: true, responseTimeMs: 100 },
          { success: true, responseTimeMs: 100 },
        ])
        .mockResolvedValueOnce([ // mon-2
          { success: false, responseTimeMs: null },
          { success: false, responseTimeMs: null },
        ]);

      const res = await getUserAnalytics(mockDb, { userId: USER_ID, period: '24h' });

      expect(res.userId).toBe(USER_ID);
      expect(res.summary.totalChecks).toBe(4);
      expect(res.summary.successfulChecks).toBe(2);
      expect(res.summary.failedChecks).toBe(2);
      expect(res.summary.uptimePercentage).toBe(50.0);
      expect(res.summary.incidentCount).toBe(1);
      expect(res.monitors).toHaveLength(2);
    });

    it('getUserAnalytics handles user with zero monitors', async () => {
      mockDb.monitor.findMany.mockResolvedValue([]);

      const res = await getUserAnalytics(mockDb, { userId: USER_ID, period: '24h' });

      expect(res.userId).toBe(USER_ID);
      expect(res.summary.totalChecks).toBe(0);
      expect(res.summary.uptimePercentage).toBe(100.0);
      expect(res.monitors).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. API Route Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe('API Endpoints', () => {
    describe('GET /api/v1/monitors/:id/analytics', () => {
      it('returns analytics for an owned monitor', async () => {
        mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
        mockDb.incident.findMany.mockResolvedValue([]);
        mockDb.checkResult.findMany.mockResolvedValue([
          { success: true, responseTimeMs: 80 },
          { success: true, responseTimeMs: 120 },
        ]);

        const res = await request(app)
          .get(`/api/v1/monitors/${MONITOR_ID}/analytics?period=24h`)
          .set('Authorization', AUTH_HEADER);

        expect(res.status).toBe(200);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.monitorId).toBe(MONITOR_ID);
        expect(res.body.data.period.name).toBe('24h');
        expect(res.body.data.summary).toMatchObject({
          uptimePercentage: 100.0,
          downtime: 0,
          downtimeSeconds: 0,
          totalChecks: 2,
          successfulChecks: 2,
          failedChecks: 0,
          averageResponseTime: 100,
          p95ResponseTime: 120,
          p99ResponseTime: 120,
          incidentCount: 0,
          incidentDuration: 0,
          incidentDurationSeconds: 0,
        });
      });

      it('supports 7d and 30d periods', async () => {
        mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
        mockDb.incident.findMany.mockResolvedValue([]);
        mockDb.checkResult.findMany.mockResolvedValue([]);

        const res7d = await request(app)
          .get(`/api/v1/monitors/${MONITOR_ID}/analytics?period=7d`)
          .set('Authorization', AUTH_HEADER);

        expect(res7d.status).toBe(200);
        expect(res7d.body.data.period.name).toBe('7d');

        const res30d = await request(app)
          .get(`/api/v1/monitors/${MONITOR_ID}/analytics?period=30d`)
          .set('Authorization', AUTH_HEADER);

        expect(res30d.status).toBe(200);
        expect(res30d.body.data.period.name).toBe('30d');
      });

      it('returns 400 when invalid period is supplied', async () => {
        const res = await request(app)
          .get(`/api/v1/monitors/${MONITOR_ID}/analytics?period=99days`)
          .set('Authorization', AUTH_HEADER);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('returns 400 when from is after to date', async () => {
        const res = await request(app)
          .get(`/api/v1/monitors/${MONITOR_ID}/analytics?from=2026-09-25T00:00:00Z&to=2026-09-20T00:00:00Z`)
          .set('Authorization', AUTH_HEADER);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it('returns 404 when querying a monitor owned by another user', async () => {
        mockDb.monitor.findFirst.mockResolvedValue(null);

        const res = await request(app)
          .get(`/api/v1/monitors/${MONITOR_ID}/analytics`)
          .set('Authorization', AUTH_HEADER);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });

      it('returns 401 when unauthenticated', async () => {
        const res = await request(app).get(`/api/v1/monitors/${MONITOR_ID}/analytics`);
        expect(res.status).toBe(401);
      });
    });

    describe('GET /api/v1/analytics', () => {
      it('returns user-level aggregated analytics across all monitors', async () => {
        mockDb.monitor.findMany.mockResolvedValue([
          { id: 'mon-1', name: 'Service 1', url: 'https://s1.example.com', status: 'UP' },
        ]);
        mockDb.incident.findMany.mockResolvedValue([]);
        mockDb.checkResult.findMany.mockResolvedValue([
          { success: true, responseTimeMs: 150 },
        ]);

        const res = await request(app)
          .get('/api/v1/analytics?period=24h')
          .set('Authorization', AUTH_HEADER);

        expect(res.status).toBe(200);
        expect(res.body.data.userId).toBe(USER_ID);
        expect(res.body.data.summary.totalChecks).toBe(1);
        expect(res.body.data.summary.uptimePercentage).toBe(100.0);
        expect(res.body.data.monitors).toHaveLength(1);
      });

      it('returns 401 when unauthenticated', async () => {
        const res = await request(app).get('/api/v1/analytics');
        expect(res.status).toBe(401);
      });
    });
  });
});
