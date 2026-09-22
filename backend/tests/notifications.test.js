'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../src/app');
const createMockDb = require('./helpers/mockDb');
const {
  dispatchStateChangeNotification,
  retryNotification,
  NotificationEvents,
} = require('../src/notifications/notificationService');
const {
  ProviderRegistry,
  EmailProvider,
  WebhookProvider,
  BaseNotificationProvider,
} = require('../src/notifications/providers');
const { processMonitorCheckJob } = require('../src/queue');
const { MonitorStatus } = require('../src/lib/stateManager');

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

const USER_ID    = 'user-notif-001';
const OTHER_USER = 'user-notif-002';
const MONITOR_ID = 'monitor-notif-100';

function makeToken(userId = USER_ID) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

const AUTH_HEADER = `Bearer ${makeToken()}`;

const MONITOR_FIXTURE = {
  id:                   MONITOR_ID,
  userId:               USER_ID,
  name:                 'Payment Gateway',
  url:                  'https://payments.example.com/health',
  method:               'GET',
  intervalSeconds:      60,
  timeoutSeconds:       10,
  expectedCodes:        [200],
  enabled:              true,
  status:               MonitorStatus.UP,
  consecutiveFailures:  0,
  consecutiveSuccesses: 10,
  lastCheckedAt:        new Date('2026-03-01T12:00:00Z'),
  lastResponseTimeMs:   35,
};

const SAMPLE_NOTIFICATIONS = [
  {
    id:         'notif-001',
    userId:     USER_ID,
    monitorId:  MONITOR_ID,
    incidentId: 'inc-001',
    event:      'MONITOR_DOWN',
    channel:    'EMAIL',
    recipient:  'admin@example.com',
    subject:    '[Outage Alert] Payment Gateway is DOWN',
    body:       'Monitor is DOWN',
    status:     'DELIVERED',
    error:      null,
    attempts:   1,
    sentAt:     new Date('2026-03-01T12:00:00Z'),
    createdAt:  new Date('2026-03-01T12:00:00Z'),
  },
  {
    id:         'notif-002',
    userId:     USER_ID,
    monitorId:  MONITOR_ID,
    incidentId: 'inc-001',
    event:      'MONITOR_RECOVERED',
    channel:    'EMAIL',
    recipient:  'admin@example.com',
    subject:    '[Recovery] Payment Gateway is UP',
    body:       'Monitor has recovered',
    status:     'FAILED',
    error:      'SMTP connection timed out',
    attempts:   1,
    sentAt:     null,
    createdAt:  new Date('2026-03-01T12:05:00Z'),
  },
];

describe('Notification System for Monitoring State Changes', () => {
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

  // ── Dispatch & Event Triggers ──────────────────────────────────────────────

  describe('dispatchStateChangeNotification', () => {
    it('sends and records a MONITOR_DOWN notification on outage transition', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: USER_ID, email: 'ops@example.com' });
      mockDb.notification.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'notif-down-1', ...data }),
      );
      mockDb.notification.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'notif-down-1', ...data, status: 'DELIVERED', sentAt: new Date() }),
      );

      const mockSend = jest.fn().mockResolvedValue({ messageId: 'msg-1' });
      const testRegistry = new ProviderRegistry();
      testRegistry.register('EMAIL', new EmailProvider({ sendMail: mockSend }));

      const result = await dispatchStateChangeNotification({
        monitor: MONITOR_FIXTURE,
        transition: {
          from: MonitorStatus.UP,
          to: MonitorStatus.DOWN,
          timestamp: new Date('2026-03-01T12:03:00Z'),
        },
        incident: { id: 'inc-1', cause: 'Received HTTP 503' },
        checkResult: { errorMessage: 'Received HTTP 503', errorCode: 'HTTP_ERROR' },
        db: mockDb,
        registry: testRegistry,
      });

      expect(result.delivered).toBe(true);
      expect(mockDb.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          monitorId: MONITOR_ID,
          event: NotificationEvents.MONITOR_DOWN,
          recipient: 'ops@example.com',
          status: 'PENDING',
        }),
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: 'ops@example.com',
          subject: expect.stringContaining('Payment Gateway is DOWN'),
        }),
      );

      expect(mockDb.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-down-1' },
          data: expect.objectContaining({ status: 'DELIVERED' }),
        }),
      );
    });

    it('sends and records a MONITOR_RECOVERED notification on recovery with duration', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: USER_ID, email: 'ops@example.com' });
      mockDb.notification.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'notif-rec-1', ...data }),
      );
      mockDb.notification.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'notif-rec-1', ...data, status: 'DELIVERED' }),
      );

      const mockSend = jest.fn().mockResolvedValue({ messageId: 'msg-rec' });
      const testRegistry = new ProviderRegistry();
      testRegistry.register('EMAIL', new EmailProvider({ sendMail: mockSend }));

      const result = await dispatchStateChangeNotification({
        monitor: MONITOR_FIXTURE,
        transition: {
          from: MonitorStatus.DOWN,
          to: MonitorStatus.UP,
          timestamp: new Date('2026-03-01T12:10:00Z'),
        },
        incident: { id: 'inc-1', durationSeconds: 420 },
        checkResult: { success: true, statusCode: 200 },
        db: mockDb,
        registry: testRegistry,
      });

      expect(result.delivered).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('Payment Gateway is UP'),
          body: expect.stringContaining('420s'),
        }),
      );
    });

    it('does not send notifications for non-outage transitions (UNKNOWN -> UP or UP -> UP)', async () => {
      const result = await dispatchStateChangeNotification({
        monitor: MONITOR_FIXTURE,
        transition: {
          from: MonitorStatus.UNKNOWN,
          to: MonitorStatus.UP,
          timestamp: new Date(),
        },
        db: mockDb,
      });

      expect(result).toBeNull();
      expect(mockDb.notification.create).not.toHaveBeenCalled();
    });
  });

  // ── Fault Isolation: Notification Failures Do Not Break Monitoring ─────────

  describe('Fault isolation', () => {
    it('marks notification as FAILED without throwing when provider delivery fails', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: USER_ID, email: 'ops@example.com' });
      mockDb.notification.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'notif-fail-1', ...data }),
      );
      mockDb.notification.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'notif-fail-1', ...data, status: 'FAILED' }),
      );

      // Provider throws error
      const mockSend = jest.fn().mockRejectedValue(new Error('SMTP server unreachable'));
      const testRegistry = new ProviderRegistry();
      testRegistry.register('EMAIL', new EmailProvider({ sendMail: mockSend }));

      const result = await dispatchStateChangeNotification({
        monitor: MONITOR_FIXTURE,
        transition: {
          from: MonitorStatus.UP,
          to: MonitorStatus.DOWN,
          timestamp: new Date(),
        },
        db: mockDb,
        registry: testRegistry,
      });

      // Does not throw!
      expect(result.delivered).toBe(false);
      expect(result.error).toBe('SMTP server unreachable');

      expect(mockDb.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'notif-fail-1' },
          data: expect.objectContaining({
            status: 'FAILED',
            error: 'SMTP server unreachable',
          }),
        }),
      );
    });

    it('guarantees worker check execution completes successfully even if notification fails', async () => {
      mockDb.monitor.findUnique.mockResolvedValue(MONITOR_FIXTURE);

      const mockCheck = jest.fn().mockResolvedValue({
        success: false,
        statusCode: 500,
        responseTimeMs: 30,
        errorCode: 'HTTP_ERROR',
        errorMessage: 'Server Error',
      });

      // State transition to DOWN
      const mockState = jest.fn().mockResolvedValue({
        currentStatus: MonitorStatus.DOWN,
        previousStatus: MonitorStatus.UP,
        hasTransition: true,
        transition: { from: MonitorStatus.UP, to: MonitorStatus.DOWN, timestamp: new Date() },
        incident: { id: 'inc-fail-test' },
      });

      // Notification function throws an unhandled error
      const failingNotificationDispatch = jest.fn().mockRejectedValue(new Error('Fatal notification crash'));

      const job = { data: { monitorId: MONITOR_ID }, id: 'job-isolation' };

      // Worker MUST NOT crash
      const outcome = await processMonitorCheckJob(job, {
        db: mockDb,
        checkMonitor: mockCheck,
        processCheckResult: mockState,
        validateUrlSsrf: jest.fn().mockResolvedValue({ safe: true }),
        dispatchStateChangeNotification: failingNotificationDispatch,
      });

      expect(outcome.outcome).toBe('PROCESSED');
      expect(outcome.status).toBe(MonitorStatus.DOWN);
      expect(outcome.hasTransition).toBe(true);
      expect(failingNotificationDispatch).toHaveBeenCalled();
    });
  });

  // ── Extensible Providers & Registry ────────────────────────────────────────

  describe('Extensible Providers and Registry', () => {
    it('delivers notifications via WebhookProvider', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      const webhookProvider = new WebhookProvider({ fetch: mockFetch });

      const result = await webhookProvider.send({
        recipient: 'https://hooks.slack.com/services/test',
        subject: 'Alert',
        body: 'Down',
        metadata: { event: 'MONITOR_DOWN' },
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/test',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('rejects invalid webhook URLs in WebhookProvider', async () => {
      const webhookProvider = new WebhookProvider();
      await expect(webhookProvider.send({ recipient: 'not-a-url' })).rejects.toThrow('Invalid webhook URL');
    });

    it('allows registering custom notification providers in ProviderRegistry', () => {
      class PagerDutyProvider extends BaseNotificationProvider {
        constructor() { super('PAGERDUTY'); }
        async send() { return { success: true }; }
      }

      const registry = new ProviderRegistry();
      expect(registry.has('PAGERDUTY')).toBe(false);

      registry.register('PAGERDUTY', new PagerDutyProvider());
      expect(registry.has('PAGERDUTY')).toBe(true);
      expect(registry.get('PAGERDUTY')).toBeInstanceOf(PagerDutyProvider);
    });
  });

  // ── Recoverability & Retry ─────────────────────────────────────────────────

  describe('retryNotification', () => {
    it('retries a failed notification and updates status to DELIVERED upon success', async () => {
      const failedNotif = {
        id: 'notif-failed-retry',
        channel: 'EMAIL',
        recipient: 'user@example.com',
        subject: 'Test alert',
        body: 'Test body',
        status: 'FAILED',
        attempts: 1,
      };

      mockDb.notification.findUnique.mockResolvedValue(failedNotif);
      mockDb.notification.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...failedNotif, ...data }),
      );

      const mockSend = jest.fn().mockResolvedValue({ id: 'msg-success' });
      const testRegistry = new ProviderRegistry();
      testRegistry.register('EMAIL', new EmailProvider({ sendMail: mockSend }));

      const result = await retryNotification('notif-failed-retry', {
        db: mockDb,
        registry: testRegistry,
      });

      expect(result.delivered).toBe(true);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ recipient: 'user@example.com' }),
      );
      expect(mockDb.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DELIVERED',
            error: null,
          }),
        }),
      );
    });

    it('throws when retrying non-existent notification', async () => {
      mockDb.notification.findUnique.mockResolvedValue(null);
      await expect(retryNotification('does-not-exist', { db: mockDb })).rejects.toThrow('Notification not found');
    });
  });

  // ── API Endpoints ──────────────────────────────────────────────────────────

  describe('Notification API routes', () => {
    beforeEach(() => {
      mockDb.monitor.findFirst.mockResolvedValue(MONITOR_FIXTURE);
      mockDb.notification.findMany.mockResolvedValue(SAMPLE_NOTIFICATIONS);
      mockDb.notification.count.mockResolvedValue(SAMPLE_NOTIFICATIONS.length);
    });

    it('GET /api/v1/monitors/:id/notifications returns paginated notifications for owned monitor', async () => {
      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/notifications`)
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.total).toBe(2);

      const notif = res.body.data[0];
      expect(notif.event).toBe('MONITOR_DOWN');
      expect(notif.status).toBe('DELIVERED');
      expect(notif.recipient).toBe('admin@example.com');
    });

    it('returns 404 when querying notifications for a monitor owned by another user', async () => {
      mockDb.monitor.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/v1/monitors/${MONITOR_ID}/notifications`)
        .set('Authorization', `Bearer ${makeToken(OTHER_USER)}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('GET /api/v1/notifications returns user-level notification history', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?status=DELIVERED')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(mockDb.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            status: 'DELIVERED',
          }),
        }),
      );
    });

    it('POST /api/v1/notifications/:id/retry triggers notification retry', async () => {
      const failedNotif = {
        ...SAMPLE_NOTIFICATIONS[1],
        userId: USER_ID,
      };

      mockDb.notification.findUnique.mockResolvedValue(failedNotif);
      mockDb.notification.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...failedNotif, ...data, status: 'DELIVERED' }),
      );

      const res = await request(app)
        .post('/api/v1/notifications/notif-002/retry')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.delivered).toBe(true);
    });

    it('returns 400 when attempting to retry an already DELIVERED notification', async () => {
      const deliveredNotif = {
        ...SAMPLE_NOTIFICATIONS[0], // status is DELIVERED
        userId: USER_ID,
      };

      mockDb.notification.findUnique.mockResolvedValue(deliveredNotif);

      const res = await request(app)
        .post('/api/v1/notifications/notif-001/retry')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NOTIFICATION_ALREADY_DELIVERED');
    });

    it('returns 404 when attempting to retry a notification owned by another user', async () => {
      const notifOtherUser = {
        ...SAMPLE_NOTIFICATIONS[0],
        userId: OTHER_USER,
      };

      mockDb.notification.findUnique.mockResolvedValue(notifOtherUser);

      const res = await request(app)
        .post('/api/v1/notifications/notif-001/retry')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 when calling notification endpoints unauthenticated', async () => {
      const res = await request(app).get('/api/v1/notifications');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
