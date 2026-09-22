'use strict';

const http = require('http');
const { checkMonitor, classifyError, ErrorCodes } = require('../src/lib/checker');

// ── Real HTTP server test harness ─────────────────────────────────────────────

describe('HTTP Health-Check Engine', () => {
  let server;
  let serverUrl;
  let receivedHeaders = {};
  let receivedMethod = null;
  let delayMs = 0;
  let responseStatusCode = 200;
  let responseBody = 'OK';
  let shouldDestroySocket = false;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      receivedMethod = req.method;

      if (shouldDestroySocket) {
        req.socket.destroy();
        return;
      }

      if (delayMs > 0) {
        setTimeout(() => {
          res.writeHead(responseStatusCode, { 'Content-Type': 'text/plain' });
          res.end(responseBody);
        }, delayMs);
      } else {
        res.writeHead(responseStatusCode, { 'Content-Type': 'text/plain' });
        res.end(responseBody);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      serverUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    receivedHeaders = {};
    receivedMethod = null;
    delayMs = 0;
    responseStatusCode = 200;
    responseBody = 'OK';
    shouldDestroySocket = false;
  });

  // ── Successful Responses ───────────────────────────────────────────────────

  describe('Successful responses', () => {
    it('returns success: true for 200 OK with default settings', async () => {
      const result = await checkMonitor({
        url: `${serverUrl}/health`,
        method: 'GET',
        timeoutSeconds: 5,
        expectedCodes: [200],
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(typeof result.responseTimeMs).toBe('number');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.errorCode).toBeNull();
      expect(result.errorMessage).toBeNull();
    });

    it('sends correct User-Agent and Accept headers', async () => {
      await checkMonitor({
        url: `${serverUrl}/headers-check`,
        method: 'GET',
        timeoutSeconds: 5,
        expectedCodes: [200],
      });

      expect(receivedHeaders['user-agent']).toBe('PulseWatch/1.0 (uptime-monitor)');
      expect(receivedHeaders['accept']).toBe('*/*');
    });

    it('matches custom expectedCodes (e.g. 204 No Content)', async () => {
      responseStatusCode = 204;
      responseBody = '';

      const result = await checkMonitor({
        url: `${serverUrl}/no-content`,
        method: 'GET',
        timeoutSeconds: 5,
        expectedCodes: [200, 204],
      });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(204);
      expect(result.errorCode).toBeNull();
      expect(result.errorMessage).toBeNull();
    });

    it('defaults method to GET and expectedCodes to [200] when omitted', async () => {
      const result = await checkMonitor({
        url: `${serverUrl}/defaults`,
        timeoutSeconds: 5,
      });

      expect(receivedMethod).toBe('GET');
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('supports extensible HTTP methods (HEAD, POST, PUT, DELETE)', async () => {
      for (const method of ['HEAD', 'POST', 'PUT', 'DELETE']) {
        const result = await checkMonitor({
          url: `${serverUrl}/method-test`,
          method,
          timeoutSeconds: 5,
          expectedCodes: [200],
        });

        expect(receivedMethod).toBe(method);
        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(200);
      }
    });

    it('follows HTTP redirects to final successful endpoint', async () => {
      const redirectServer = http.createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: `${serverUrl}/target` });
          res.end();
        }
      });

      await new Promise((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
      const redirectPort = redirectServer.address().port;

      try {
        const result = await checkMonitor({
          url: `http://127.0.0.1:${redirectPort}/redirect`,
          method: 'GET',
          timeoutSeconds: 5,
          expectedCodes: [200],
        });

        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(200);
      } finally {
        await new Promise((resolve) => redirectServer.close(resolve));
      }
    });
  });

  // ── HTTP Errors ────────────────────────────────────────────────────────────

  describe('HTTP error responses', () => {
    it('returns HTTP_ERROR when server responds with 404 Not Found', async () => {
      responseStatusCode = 404;
      responseBody = 'Not Found';

      const result = await checkMonitor({
        url: `${serverUrl}/not-found`,
        method: 'GET',
        timeoutSeconds: 5,
        expectedCodes: [200],
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.errorCode).toBe(ErrorCodes.HTTP_ERROR);
      expect(result.errorMessage).toBe('Received HTTP 404; expected one of [200]');
      expect(typeof result.responseTimeMs).toBe('number');
    });

    it('returns HTTP_ERROR when server responds with 500 Internal Server Error', async () => {
      responseStatusCode = 500;
      responseBody = 'Server Error';

      const result = await checkMonitor({
        url: `${serverUrl}/error`,
        method: 'GET',
        timeoutSeconds: 5,
        expectedCodes: [200],
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.errorCode).toBe(ErrorCodes.HTTP_ERROR);
      expect(result.errorMessage).toBe('Received HTTP 500; expected one of [200]');
      expect(typeof result.responseTimeMs).toBe('number');
    });

    it('returns HTTP_ERROR when 200 is returned but not in expectedCodes', async () => {
      responseStatusCode = 200;

      const result = await checkMonitor({
        url: `${serverUrl}/expected-check`,
        method: 'GET',
        timeoutSeconds: 5,
        expectedCodes: [201, 204],
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(200);
      expect(result.errorCode).toBe(ErrorCodes.HTTP_ERROR);
      expect(result.errorMessage).toBe('Received HTTP 200; expected one of [201, 204]');
    });
  });

  // ── Timeouts ───────────────────────────────────────────────────────────────

  describe('Timeouts', () => {
    it('returns TIMEOUT when request exceeds configured timeout', async () => {
      delayMs = 400; // Delay response longer than the timeout

      const result = await checkMonitor({
        url: `${serverUrl}/slow`,
        method: 'GET',
        timeoutSeconds: 0.1, // 100ms timeout
        expectedCodes: [200],
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.errorCode).toBe(ErrorCodes.TIMEOUT);
      expect(result.errorMessage).toBe('Request timed out before a response was received');
      expect(typeof result.responseTimeMs).toBe('number');
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(80);
    });
  });

  // ── Network and Connection Failures ────────────────────────────────────────

  describe('Network and connection failures', () => {
    it('returns CONNECTION_ERROR when connecting to an inactive port', async () => {
      // Find an unused port by briefly binding and closing
      const dummy = http.createServer();
      await new Promise((resolve) => dummy.listen(0, '127.0.0.1', resolve));
      const deadPort = dummy.address().port;
      await new Promise((resolve) => dummy.close(resolve));

      const result = await checkMonitor({
        url: `http://127.0.0.1:${deadPort}/test`,
        method: 'GET',
        timeoutSeconds: 2,
        expectedCodes: [200],
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.responseTimeMs).toBeNull();
      expect(result.errorCode).toBe(ErrorCodes.CONNECTION_ERROR);
      expect(result.errorMessage).toMatch(/ECONNREFUSED/);
    });

    it('returns CONNECTION_ERROR when connection is abruptly terminated by peer', async () => {
      shouldDestroySocket = true;

      const result = await checkMonitor({
        url: `${serverUrl}/abrupt-close`,
        method: 'GET',
        timeoutSeconds: 2,
        expectedCodes: [200],
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.errorCode).toBe(ErrorCodes.CONNECTION_ERROR);
    });

    it('returns DNS_ERROR when hostname cannot be resolved', async () => {
      const result = await checkMonitor({
        url: 'http://this-hostname-definitely-does-not-exist-xyz123.invalid/',
        method: 'GET',
        timeoutSeconds: 5,
        expectedCodes: [200],
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.responseTimeMs).toBeNull();
      expect(result.errorCode).toBe(ErrorCodes.DNS_ERROR);
      expect(result.errorMessage).toMatch(/DNS resolution failed/);
    });

    it('returns TLS_ERROR when TLS handshake/certificate validation fails', async () => {
      const tlsError = new TypeError('fetch failed');
      tlsError.cause = {
        code: 'CERT_HAS_EXPIRED',
        message: 'certificate has expired',
      };

      const mockFetch = jest.fn().mockRejectedValue(tlsError);

      const result = await checkMonitor(
        {
          url: 'https://expired.example.com/',
          method: 'GET',
          timeoutSeconds: 5,
          expectedCodes: [200],
        },
        { _fetch: mockFetch },
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.responseTimeMs).toBeNull();
      expect(result.errorCode).toBe(ErrorCodes.TLS_ERROR);
      expect(result.errorMessage).toContain('CERT_HAS_EXPIRED');
    });
  });

  // ── Robustness & Crash Prevention ──────────────────────────────────────────

  describe('Robustness and crash prevention', () => {
    it('returns UNKNOWN_ERROR without crashing when monitor is null or invalid', async () => {
      const resultNull = await checkMonitor(null);
      expect(resultNull.success).toBe(false);
      expect(resultNull.errorCode).toBe(ErrorCodes.UNKNOWN_ERROR);

      const resultEmpty = await checkMonitor({});
      expect(resultEmpty.success).toBe(false);
      expect(resultEmpty.errorCode).toBe(ErrorCodes.UNKNOWN_ERROR);
      expect(resultEmpty.errorMessage).toContain('URL is required');
    });

    it('handles unexpected exceptions thrown by fetch without crashing', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Unexpected runtime exception'));

      const result = await checkMonitor(
        {
          url: 'http://example.com',
          method: 'GET',
          timeoutSeconds: 5,
          expectedCodes: [200],
        },
        { _fetch: mockFetch },
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBeNull();
      expect(result.errorCode).toBe(ErrorCodes.UNKNOWN_ERROR);
      expect(result.errorMessage).toBe('Unexpected runtime exception');
    });

    it('safely handles response without body or when body cancel throws', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        status: 200,
        body: {
          locked: false,
          cancel: jest.fn().mockRejectedValue(new Error('Stream cancel error')),
        },
      });

      const result = await checkMonitor(
        {
          url: 'http://example.com',
          method: 'GET',
          timeoutSeconds: 5,
          expectedCodes: [200],
        },
        { _fetch: mockFetch },
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.errorCode).toBeNull();
    });
  });

  // ── classifyError Unit Tests ───────────────────────────────────────────────

  describe('classifyError', () => {
    it('classifies AbortError and TimeoutError as TIMEOUT', () => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      expect(classifyError(abortErr).errorCode).toBe(ErrorCodes.TIMEOUT);

      const timeoutErr = new Error('Timeout');
      timeoutErr.name = 'TimeoutError';
      expect(classifyError(timeoutErr).errorCode).toBe(ErrorCodes.TIMEOUT);

      const undiciTimeout = new Error('Connect timeout');
      undiciTimeout.code = 'UND_ERR_CONNECT_TIMEOUT';
      expect(classifyError(undiciTimeout).errorCode).toBe(ErrorCodes.TIMEOUT);
    });

    it('classifies DNS error codes as DNS_ERROR', () => {
      const dnsCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL', 'ENODATA', 'EADDRINFO', 'EAI_NONAME'];
      for (const code of dnsCodes) {
        const err = new TypeError('fetch failed');
        err.cause = { code, message: `DNS fail: ${code}` };
        const result = classifyError(err);
        expect(result.errorCode).toBe(ErrorCodes.DNS_ERROR);
        expect(result.errorMessage).toContain(code);
      }
    });

    it('classifies connection error codes as CONNECTION_ERROR', () => {
      const connCodes = ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENETUNREACH', 'ENETDOWN', 'EPIPE', 'ETIMEDOUT'];
      for (const code of connCodes) {
        const err = new TypeError('fetch failed');
        err.cause = { code, message: `Conn fail: ${code}` };
        const result = classifyError(err);
        expect(result.errorCode).toBe(ErrorCodes.CONNECTION_ERROR);
        expect(result.errorMessage).toContain(code);
      }
    });

    it('classifies TLS/SSL error codes as TLS_ERROR', () => {
      const tlsCodes = [
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'CERT_HAS_EXPIRED',
        'CERT_NOT_YET_VALID',
        'CERT_UNTRUSTED',
        'ERR_TLS_CERT_ALTNAME_INVALID',
        'ERR_SSL_WRONG_VERSION_NUMBER',
      ];
      for (const code of tlsCodes) {
        const err = new TypeError('fetch failed');
        err.cause = { code, message: `TLS fail: ${code}` };
        const result = classifyError(err);
        expect(result.errorCode).toBe(ErrorCodes.TLS_ERROR);
        expect(result.errorMessage).toContain(code);
      }
    });

    it('classifies unknown errors as UNKNOWN_ERROR', () => {
      expect(classifyError(new Error('Something weird')).errorCode).toBe(ErrorCodes.UNKNOWN_ERROR);
      expect(classifyError(null).errorCode).toBe(ErrorCodes.UNKNOWN_ERROR);
      expect(classifyError(undefined).errorCode).toBe(ErrorCodes.UNKNOWN_ERROR);
    });
  });
});
