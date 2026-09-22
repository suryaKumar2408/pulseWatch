'use strict';

const request = require('supertest');
const createApp = require('../src/app');

// ── Mocks ──────────────────────────────────────────────────────────────────
// Mock db and redis libs so tests run without real infrastructure.
jest.mock('../src/lib/db', () => ({
  pingDb: jest.fn(),
  disconnectDb: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/redis', () => ({
  pingRedis: jest.fn(),
  disconnectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis: jest.fn(),
}));

const { pingDb } = require('../src/lib/db');
const { pingRedis } = require('../src/lib/redis');

// ── Test suite ─────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('when all services are healthy', () => {
    beforeEach(() => {
      pingDb.mockResolvedValue(true);
      pingRedis.mockResolvedValue(true);
    });

    it('returns HTTP 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('returns status "ok"', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.status).toBe('ok');
    });

    it('returns all services as "ok"', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.services).toEqual({
        database: 'ok',
        redis: 'ok',
      });
    });

    it('includes a requestId in the response', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.requestId).toBeDefined();
      expect(typeof res.body.requestId).toBe('string');
    });

    it('includes a timestamp in ISO 8601 format', async () => {
      const res = await request(app).get('/api/health');
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it('propagates X-Request-Id header when provided by client', async () => {
      const clientId = 'my-trace-id-12345';
      const res = await request(app)
        .get('/api/health')
        .set('X-Request-Id', clientId);

      expect(res.headers['x-request-id']).toBe(clientId);
      expect(res.body.requestId).toBe(clientId);
    });
  });

  describe('when the database is unavailable', () => {
    beforeEach(() => {
      pingDb.mockResolvedValue(false);
      pingRedis.mockResolvedValue(true);
    });

    it('returns HTTP 503', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
    });

    it('returns status "degraded"', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.status).toBe('degraded');
    });

    it('marks database as "unavailable"', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.services.database).toBe('unavailable');
      expect(res.body.services.redis).toBe('ok');
    });
  });

  describe('when Redis is unavailable', () => {
    beforeEach(() => {
      pingDb.mockResolvedValue(true);
      pingRedis.mockResolvedValue(false);
    });

    it('returns HTTP 503', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
    });

    it('marks redis as "unavailable"', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.services.redis).toBe('unavailable');
      expect(res.body.services.database).toBe('ok');
    });
  });

  describe('when all services are unavailable', () => {
    beforeEach(() => {
      pingDb.mockResolvedValue(false);
      pingRedis.mockResolvedValue(false);
    });

    it('returns HTTP 503', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
    });

    it('marks all services as "unavailable"', async () => {
      const res = await request(app).get('/api/health');
      expect(res.body.services).toEqual({
        database: 'unavailable',
        redis: 'unavailable',
      });
    });
  });
});

describe('Unknown routes', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('returns 404 for unknown GET routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for non-API routes', async () => {
    const res = await request(app).get('/some-page');
    expect(res.status).toBe(404);
  });
});

describe('Security headers', () => {
  let app;

  beforeEach(() => {
    pingDb.mockResolvedValue(true);
    pingRedis.mockResolvedValue(true);
    app = createApp();
  });

  it('sets X-Content-Type-Options header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not expose X-Powered-By header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /api/health/live', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('returns HTTP 200 with status "ok"', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('GET /api/health/ready', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('returns HTTP 200 when both database and Redis are ready', async () => {
    pingDb.mockResolvedValue(true);
    pingRedis.mockResolvedValue(true);

    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.database).toBe('ok');
    expect(res.body.redis).toBe('ok');
  });

  it('returns HTTP 503 when database is unavailable', async () => {
    pingDb.mockResolvedValue(false);
    pingRedis.mockResolvedValue(true);

    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.database).toBe('unavailable');
    expect(res.body.redis).toBe('ok');
  });

  it('returns HTTP 503 when Redis is unavailable', async () => {
    pingDb.mockResolvedValue(true);
    pingRedis.mockResolvedValue(false);

    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.database).toBe('ok');
    expect(res.body.redis).toBe('unavailable');
  });
});

