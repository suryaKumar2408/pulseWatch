'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../src/app');
const createMockDb = require('./helpers/mockDb');

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

// Mock SSRF validation so monitor tests don't make real DNS calls.
// Tests that specifically test SSRF behaviour live in ssrf.test.js.
jest.mock('../src/lib/ssrf', () => ({
  validateUrlSsrf: jest.fn().mockResolvedValue({ safe: true }),
}));

const { getDb }          = require('../src/lib/db');
const { validateUrlSsrf } = require('../src/lib/ssrf');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID   = 'user-abc-001';
const OTHER_UID = 'user-abc-002';

function makeToken(userId = USER_ID) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const AUTH_HEADER = `Bearer ${makeToken()}`;

const MONITOR_FIXTURE = {
  id:                   'monitor-001',
  userId:               USER_ID,
  name:                 'My API',
  url:                  'https://example.com/health',
  method:               'GET',
  intervalSeconds:      60,
  timeoutSeconds:       10,
  expectedCodes:        [200],
  enabled:              true,
  status:               'UNKNOWN',
  consecutiveFailures:  0,
  consecutiveSuccesses: 0,
  lastCheckedAt:        null,
  lastResponseTimeMs:   null,
  createdAt:            new Date('2026-01-01T00:00:00Z'),
  updatedAt:            new Date('2026-01-01T00:00:00Z'),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/monitors', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    validateUrlSsrf.mockResolvedValue({ safe: true });
    app = createApp();
  });

  it('creates a monitor and returns 201 with the monitor data', async () => {
    mockDb.monitor.create.mockResolvedValue(MONITOR_FIXTURE);

    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({
        name: 'My API',
        url:  'https://example.com/health',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(MONITOR_FIXTURE.id);
    expect(res.body.data.userId).toBe(USER_ID);
  });

  it('sets the userId from the authenticated user, not from the request body', async () => {
    mockDb.monitor.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...MONITOR_FIXTURE, userId: data.userId }),
    );

    await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'My API', url: 'https://example.com' });

    const [callArg] = mockDb.monitor.create.mock.calls[0];
    expect(callArg.data.userId).toBe(USER_ID);
  });

  it('applies default values for optional fields', async () => {
    mockDb.monitor.create.mockImplementation(({ data }) => Promise.resolve({ ...MONITOR_FIXTURE, ...data, id: 'new-id' }));

    await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Minimal', url: 'https://example.com' });

    const { data } = mockDb.monitor.create.mock.calls[0][0];
    expect(data.method).toBe('GET');
    expect(data.intervalSeconds).toBe(60);
    expect(data.timeoutSeconds).toBe(10);
    expect(data.expectedCodes).toEqual([200]);
    expect(data.enabled).toBe(true);
  });

  it('returns 400 for a missing URL', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'No URL' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a missing name', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-http(s) URL scheme', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'FTP', url: 'ftp://files.example.com' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid URL', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Bad URL', url: 'not a url' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when intervalSeconds is below the 30-second minimum', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Fast', url: 'https://example.com', intervalSeconds: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('intervalSeconds');
  });

  it('returns 400 when timeoutSeconds >= intervalSeconds', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({
        name: 'Bad timeout',
        url: 'https://example.com',
        intervalSeconds: 60,
        timeoutSeconds: 60,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.details.some(d => d.field === 'timeoutSeconds')).toBe(true);
  });

  it('returns 400 when an SSRF URL is submitted', async () => {
    validateUrlSsrf.mockResolvedValueOnce({
      safe: false,
      reason: 'IP address 127.0.0.1 is in a blocked range',
    });

    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Internal', url: 'http://127.0.0.1/' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SSRF_BLOCKED');
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .send({ name: 'My API', url: 'https://example.com' });

    expect(res.status).toBe(401);
  });

  it('rejects an unsupported HTTP method', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Test', url: 'https://example.com', method: 'CONNECT' });

    expect(res.status).toBe(400);
  });

  it('rejects empty expectedCodes array', async () => {
    const res = await request(app)
      .post('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Test', url: 'https://example.com', expectedCodes: [] });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/monitors', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  it('returns paginated monitors owned by the authenticated user', async () => {
    mockDb.monitor.findMany.mockResolvedValue([MONITOR_FIXTURE]);
    mockDb.monitor.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.totalPages).toBe(1);
  });

  it('scopes the query to the authenticated user', async () => {
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(0);

    await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER);

    const [findManyArg] = mockDb.monitor.findMany.mock.calls[0];
    expect(findManyArg.where.userId).toBe(USER_ID);
  });

  it('applies status filter when provided', async () => {
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(0);

    await request(app)
      .get('/api/v1/monitors?status=DOWN')
      .set('Authorization', AUTH_HEADER);

    const [findManyArg] = mockDb.monitor.findMany.mock.calls[0];
    expect(findManyArg.where.status).toBe('DOWN');
  });

  it('applies enabled filter when provided', async () => {
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(0);

    await request(app)
      .get('/api/v1/monitors?enabled=false')
      .set('Authorization', AUTH_HEADER);

    const [findManyArg] = mockDb.monitor.findMany.mock.calls[0];
    expect(findManyArg.where.enabled).toBe(false);
  });

  it('applies pagination parameters', async () => {
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(50);

    const res = await request(app)
      .get('/api/v1/monitors?page=2&limit=10')
      .set('Authorization', AUTH_HEADER);

    const [findManyArg] = mockDb.monitor.findMany.mock.calls[0];
    expect(findManyArg.skip).toBe(10);
    expect(findManyArg.take).toBe(10);
    expect(res.body.pagination.totalPages).toBe(5);
  });

  it('returns 400 for invalid status filter', async () => {
    const res = await request(app)
      .get('/api/v1/monitors?status=INVALID')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(400);
  });

  it('returns 400 for limit > 100', async () => {
    const res = await request(app)
      .get('/api/v1/monitors?limit=200')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(400);
  });

  it('returns an empty array (not 404) when user has no monitors', async () => {
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/v1/monitors/:id', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  it('returns the monitor when it belongs to the authenticated user', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);

    const res = await request(app)
      .get(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(MONITOR_FIXTURE.id);
  });

  it('always scopes the query by userId', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);

    await request(app)
      .get(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER);

    const [findFirstArg] = mockDb.monitor.findFirst.mock.calls[0];
    expect(findFirstArg.where.userId).toBe(USER_ID);
    expect(findFirstArg.where.id).toBe(MONITOR_FIXTURE.id);
  });

  it('returns 404 when monitor does not exist', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/monitors/nonexistent')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 (not 403) for a monitor belonging to a different user', async () => {
    // The query includes userId scoping, so another user's monitor simply isn't found
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const otherUserToken = `Bearer ${makeToken(OTHER_UID)}`;
    const res = await request(app)
      .get(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', otherUserToken);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/monitors/:id', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    validateUrlSsrf.mockResolvedValue({ safe: true });
    app = createApp();
  });

  it('updates allowed fields and returns the updated monitor', async () => {
    const updated = { ...MONITOR_FIXTURE, name: 'Updated Name', enabled: false };
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
    mockDb.monitor.update.mockResolvedValue(updated);

    const res = await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Updated Name', enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.enabled).toBe(false);
  });

  it('performs SSRF check when updating the URL', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
    mockDb.monitor.update.mockResolvedValue({ ...MONITOR_FIXTURE, url: 'https://new.example.com' });

    await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ url: 'https://new.example.com' });

    expect(validateUrlSsrf).toHaveBeenCalledWith('https://new.example.com', undefined);
  });

  it('skips SSRF check when URL is not being updated', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
    mockDb.monitor.update.mockResolvedValue({ ...MONITOR_FIXTURE, name: 'Renamed' });

    await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Renamed' });

    expect(validateUrlSsrf).not.toHaveBeenCalled();
  });

  it('returns 400 when SSRF is detected in updated URL', async () => {
    validateUrlSsrf.mockResolvedValueOnce({ safe: false, reason: 'private IP' });
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);

    const res = await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ url: 'http://192.168.1.1/' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SSRF_BLOCKED');
  });

  it('does not allow setting health-tracking fields via PATCH', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
    mockDb.monitor.update.mockResolvedValue(MONITOR_FIXTURE);

    await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({
        name: 'OK',
        status: 'DOWN',                 // not a valid field in updateMonitorSchema
        consecutiveFailures: 99,
        lastResponseTimeMs: 1,
      });

    const [updateArg] = mockDb.monitor.update.mock.calls[0];
    expect(updateArg.data.status).toBeUndefined();
    expect(updateArg.data.consecutiveFailures).toBeUndefined();
    expect(updateArg.data.lastResponseTimeMs).toBeUndefined();
  });

  it('returns 404 when the monitor does not belong to the authenticated user', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ name: 'Steal' });

    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid update data', async () => {
    const res = await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ intervalSeconds: -1 });

    expect(res.status).toBe(400);
  });

  it('returns 400 when updating only timeoutSeconds to exceed existing intervalSeconds', async () => {
    // Existing fixture has intervalSeconds: 60, timeoutSeconds: 10
    mockDb.monitor.findFirst.mockResolvedValue({ ...MONITOR_FIXTURE, intervalSeconds: 30, timeoutSeconds: 10 });

    const res = await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ timeoutSeconds: 30 }); // 30 is not < 30

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('Timeout must be less than the monitoring interval');
  });

  it('returns 400 when updating only intervalSeconds to be less than or equal to existing timeoutSeconds', async () => {
    // Existing fixture has timeoutSeconds: 10
    mockDb.monitor.findFirst.mockResolvedValue({ ...MONITOR_FIXTURE, intervalSeconds: 60, timeoutSeconds: 30 });

    const res = await request(app)
      .patch(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER)
      .send({ intervalSeconds: 30 }); // 30 is not > 30

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/v1/monitors/:id', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  it('deletes the monitor and returns 204', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
    mockDb.monitor.delete.mockResolvedValue(MONITOR_FIXTURE);

    const res = await request(app)
      .delete(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it('returns 404 when monitor does not exist', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/v1/monitors/nonexistent')
      .set('Authorization', AUTH_HEADER);

    expect(res.status).toBe(404);
  });

  it('does not delete a monitor owned by a different user', async () => {
    // findFirst with userId scoping returns null for a different user's monitor
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const otherToken = `Bearer ${makeToken(OTHER_UID)}`;
    const res = await request(app)
      .delete(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', otherToken);

    expect(res.status).toBe(404);
    expect(mockDb.monitor.delete).not.toHaveBeenCalled();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete(`/api/v1/monitors/${MONITOR_FIXTURE.id}`);
    expect(res.status).toBe(401);
  });
});

describe('Ownership isolation', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    validateUrlSsrf.mockResolvedValue({ safe: true });
    app = createApp();
  });

  it('user A cannot read monitors belonging to user B', async () => {
    // DB returns null because the userId scoping filters it out
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const userBToken = `Bearer ${makeToken(OTHER_UID)}`;
    const res = await request(app)
      .get(`/api/v1/monitors/${MONITOR_FIXTURE.id}`)
      .set('Authorization', userBToken);

    // We verify the WHERE clause contains the requesting user's ID
    const [findArg] = mockDb.monitor.findFirst.mock.calls[0];
    expect(findArg.where.userId).toBe(OTHER_UID); // scoped to user B, not user A
    expect(res.status).toBe(404);
  });

  it('list only returns monitors for the authenticated user', async () => {
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(0);

    const userBToken = `Bearer ${makeToken(OTHER_UID)}`;
    await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', userBToken);

    const [findManyArg] = mockDb.monitor.findMany.mock.calls[0];
    expect(findManyArg.where.userId).toBe(OTHER_UID);
  });
});
