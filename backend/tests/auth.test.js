'use strict';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const createApp = require('../src/app');
const createMockDb = require('./helpers/mockDb');

// ── Module mocks ──────────────────────────────────────────────────────────────
// Must be declared before any require() that transitively loads the mocked modules.

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
const { clearBlocklist } = require('../src/lib/tokenBlocklist');

// ── Test helpers ──────────────────────────────────────────────────────────────

const TEST_USER = {
  id:        'user-test-001',
  email:     'alice@example.com',
  password:  '', // filled in beforeAll
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

beforeAll(async () => {
  TEST_USER.password = await bcrypt.hash('password123', 10);
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  it('creates a new user and returns a token (201)', async () => {
    mockDb.user.findUnique.mockResolvedValue(null); // email not taken
    mockDb.user.create.mockResolvedValue({
      ...TEST_USER,
      email: 'new@example.com',
    });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'new@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeDefined();
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.user.email).toBe('new@example.com');
  });

  it('does not return the password hash in the response', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockResolvedValue(TEST_USER);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'password123' });

    expect(res.body.data.user.password).toBeUndefined();
  });

  it('returns 409 when email is already registered', async () => {
    mockDb.user.findUnique.mockResolvedValue(TEST_USER);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'password123' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('returns 400 for an invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when password is too short (< 8 chars)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('password');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('normalises email to lowercase', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...TEST_USER, email: data.email }),
    );

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'Alice@EXAMPLE.COM', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('alice@example.com');
  });

  it('the returned token contains the correct userId', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.create.mockResolvedValue(TEST_USER);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'password123' });

    const payload = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
    expect(payload.sub).toBe(TEST_USER.id);
  });
});

describe('POST /api/v1/auth/login', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  it('returns 200 and a token for valid credentials', async () => {
    mockDb.user.findUnique.mockResolvedValue(TEST_USER);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.id).toBe(TEST_USER.id);
  });

  it('does not return the password hash on login', async () => {
    mockDb.user.findUnique.mockResolvedValue(TEST_USER);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'password123' });

    expect(res.body.data.user.password).toBeUndefined();
  });

  it('returns 401 for wrong password', async () => {
    mockDb.user.findUnique.mockResolvedValue(TEST_USER);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 401 for non-existent email', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the same error message for wrong password and missing user (anti-enumeration)', async () => {
    mockDb.user.findUnique.mockResolvedValue(TEST_USER);
    const wrongPasswordRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'wrongpassword' });

    mockDb.user.findUnique.mockResolvedValue(null);
    const missingUserRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'password123' });

    expect(wrongPasswordRes.body.error.message).toBe(missingUserRes.body.error.message);
  });

  it('returns 400 for missing email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ password: 'password123' });

    expect(res.status).toBe(400);
  });
});

describe('Auth middleware (requireAuth)', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(0);
    app = createApp();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/v1/monitors');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for malformed Bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', 'Bearer notavalidtoken');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for expired token', async () => {
    const expiredToken = jwt.sign(
      { sub: 'user-123' },
      process.env.JWT_SECRET,
      { expiresIn: -1 }, // already expired
    );

    const res = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 401 for token signed with wrong secret', async () => {
    const badToken = jwt.sign({ sub: 'user-123' }, 'wrong-secret');

    const res = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', `Bearer ${badToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('allows access with a valid token', async () => {
    const validToken = jwt.sign({ sub: 'user-123' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/auth/logout', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    clearBlocklist();
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    mockDb.monitor.findMany.mockResolvedValue([]);
    mockDb.monitor.count.mockResolvedValue(0);
    app = createApp();
  });

  it('revokes the current token and prevents subsequent access', async () => {
    const token = jwt.sign({ sub: TEST_USER.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // 1. Can access protected route before logout
    const preRes = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`);
    expect(preRes.status).toBe(200);

    // 2. Call logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.message).toBe('Successfully logged out');

    // 3. Attempt to access protected route after logout -> TOKEN_REVOKED
    const postRes = await request(app)
      .get('/api/v1/monitors')
      .set('Authorization', `Bearer ${token}`);
    expect(postRes.status).toBe(401);
    expect(postRes.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('returns 401 when calling logout without a token', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/v1/auth/me', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    clearBlocklist();
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  it('returns sanitized profile of the authenticated user', async () => {
    mockDb.user.findUnique.mockResolvedValue(TEST_USER);
    const token = jwt.sign({ sub: TEST_USER.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(TEST_USER.id);
    expect(res.body.data.user.email).toBe(TEST_USER.email);
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('returns 404 when user does not exist in DB', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    const token = jwt.sign({ sub: 'ghost-user' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('Resource Authorization & Isolation across users', () => {
  let app;
  let mockDb;

  const USER_A_TOKEN = `Bearer ${jwt.sign({ sub: 'user-a' }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
  const USER_B_MONITOR_ID = 'mon-user-b';

  beforeEach(() => {
    clearBlocklist();
    mockDb = createMockDb();
    getDb.mockReturnValue(mockDb);
    app = createApp();
  });

  it('User A cannot view User B monitor (returns 404)', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null); // Not found for user-a

    const res = await request(app)
      .get(`/api/v1/monitors/${USER_B_MONITOR_ID}`)
      .set('Authorization', USER_A_TOKEN);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('User A cannot update User B monitor (returns 404)', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch(`/api/v1/monitors/${USER_B_MONITOR_ID}`)
      .set('Authorization', USER_A_TOKEN)
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(404);
    expect(mockDb.monitor.update).not.toHaveBeenCalled();
  });

  it('User A cannot delete User B monitor (returns 404)', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .delete(`/api/v1/monitors/${USER_B_MONITOR_ID}`)
      .set('Authorization', USER_A_TOKEN);

    expect(res.status).toBe(404);
    expect(mockDb.monitor.delete).not.toHaveBeenCalled();
  });

  it('User A cannot view checks for User B monitor (returns 404)', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/monitors/${USER_B_MONITOR_ID}/checks`)
      .set('Authorization', USER_A_TOKEN);

    expect(res.status).toBe(404);
  });

  it('User A cannot view analytics for User B monitor (returns 404)', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/monitors/${USER_B_MONITOR_ID}/analytics`)
      .set('Authorization', USER_A_TOKEN);

    expect(res.status).toBe(404);
  });

  it('User A cannot view notifications for User B monitor (returns 404)', async () => {
    mockDb.monitor.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/monitors/${USER_B_MONITOR_ID}/notifications`)
      .set('Authorization', USER_A_TOKEN);

    expect(res.status).toBe(404);
  });

  it('User A cannot retry User B notification (returns 404)', async () => {
    mockDb.notification.findUnique.mockResolvedValue({
      id: 'notif-b',
      userId: 'user-b', // Owned by User B
      status: 'FAILED',
    });

    const res = await request(app)
      .post('/api/v1/notifications/notif-b/retry')
      .set('Authorization', USER_A_TOKEN);

    expect(res.status).toBe(404);
  });
});

