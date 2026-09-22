'use strict';

/**
 * HTTP Health-Check Engine
 *
 * Performs a single HTTP request against a monitor target and returns a
 * structured result describing the outcome.
 *
 * Design principles:
 *  - Never throws to the caller — all errors are captured and returned.
 *  - HTTP method-agnostic: the caller passes the method from monitor config.
 *  - Response body is always discarded to return the connection to the pool.
 *  - Timing covers the full request lifecycle (DNS + connect + headers + body drain).
 *  - Error codes are normalised so the worker can make decisions without
 *    parsing raw error messages.
 *  - The fetch function is injectable (via options._fetch) so tests can use
 *    a controlled HTTP server without mocking globals.
 */

const { performance } = require('perf_hooks');
const logger = require('./logger');
const { validateUrlSsrf } = require('./ssrf');

// ── Error code constants ───────────────────────────────────────────────────────

/**
 * Normalised error codes returned in CheckResult.errorCode.
 * These are stored in the database and used by the worker to classify failures.
 */
const ErrorCodes = Object.freeze({
  /** The request did not complete within the configured timeout. */
  TIMEOUT: 'TIMEOUT',

  /** The hostname could not be resolved (ENOTFOUND, EAI_AGAIN, etc.). */
  DNS_ERROR: 'DNS_ERROR',

  /** TCP connection could not be established (ECONNREFUSED, ECONNRESET, etc.). */
  CONNECTION_ERROR: 'CONNECTION_ERROR',

  /** TLS/SSL handshake or certificate validation failed. */
  TLS_ERROR: 'TLS_ERROR',

  /** HTTP response received but status code was not in expectedCodes. */
  HTTP_ERROR: 'HTTP_ERROR',

  /** Target URL or redirect blocked by SSRF policy. */
  SSRF_BLOCKED: 'SSRF_BLOCKED',

  /** Any other failure that does not fit the above categories. */
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

// ── Error code sets for classification ─────────────────────────────────────────

// These codes appear in err.cause.code from Node.js's native fetch (undici-backed).

const DNS_ERROR_CODES = new Set([
  'ENOTFOUND',   // Hostname not found in DNS
  'EAI_AGAIN',   // Temporary DNS failure (try again)
  'ESERVFAIL',   // DNS server returned SERVFAIL
  'ENODATA',     // DNS returned no data for the record type
  'EADDRINFO',   // Generic address resolution failure
  'EAI_NONAME',  // Hostname not known
  'EAI_FAIL',    // Non-recoverable failure in name resolution
  'EAI_NODATA',  // No address associated with hostname
]);

const TLS_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_UNSUPPORTED_PROTOCOL',
]);

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',  // Port not listening
  'ECONNRESET',    // Connection forcibly closed by remote
  'ECONNABORTED',  // Connection aborted locally
  'ENETUNREACH',   // Network is unreachable
  'ENETDOWN',      // Network interface is down
  'EHOSTUNREACH',  // No route to host
  'EHOSTDOWN',     // Host is down
  'EPIPE',         // Broken pipe (remote closed before we finished)
  'ETIMEDOUT',     // OS-level connect timeout
  'UND_ERR_SOCKET',// Undici socket error
]);

// ── Error classifier ───────────────────────────────────────────────────────────

/**
 * Translates a raw caught error from fetch() into a structured
 * { errorCode, errorMessage } pair.
 *
 * Node.js native fetch (undici-backed) error shapes (verified on v22):
 *  - Abort/timeout:       DOMException { name: 'AbortError' } or TimeoutError
 *  - DNS failure:         TypeError    { cause: { code: 'ENOTFOUND', ... } }
 *  - Connection refused:  TypeError    { cause: { code: 'ECONNREFUSED', ... } }
 *  - TLS error:           TypeError    { cause: { code: 'CERT_HAS_EXPIRED', ... } }
 *
 * Exported so it can be independently unit-tested against mock error objects.
 *
 * @param {Error|any} err
 * @returns {{ errorCode: string, errorMessage: string }}
 */
function classifyError(err) {
  if (!err) {
    return {
      errorCode: ErrorCodes.UNKNOWN_ERROR,
      errorMessage: 'Unknown error',
    };
  }

  // ── AbortController signal fired / timeout errors ──────────────────────────
  if (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    err.name === 'ConnectTimeoutError' ||
    err.cause?.name === 'ConnectTimeoutError' ||
    err.cause?.name === 'HeadersTimeoutError' ||
    err.cause?.name === 'BodyTimeoutError' ||
    err.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT'
  ) {
    return {
      errorCode: ErrorCodes.TIMEOUT,
      errorMessage: 'Request timed out before a response was received',
    };
  }

  // ── Extract system error code from Node.js fetch's cause chain ────────────
  const code = err.code ?? err.cause?.code ?? err.cause?.cause?.code;
  const causeMessage = err.cause?.message ?? err.message ?? String(err);

  if (code && (DNS_ERROR_CODES.has(code) || String(code).startsWith('EAI_'))) {
    return {
      errorCode: ErrorCodes.DNS_ERROR,
      errorMessage: `DNS resolution failed (${code}): ${causeMessage}`,
    };
  }

  if (
    code &&
    (TLS_ERROR_CODES.has(code) ||
      (typeof code === 'string' &&
        (code.startsWith('ERR_TLS_') ||
          code.startsWith('ERR_SSL_') ||
          code.includes('CERT'))))
  ) {
    return {
      errorCode: ErrorCodes.TLS_ERROR,
      errorMessage: `TLS/SSL error (${code}): ${causeMessage}`,
    };
  }

  if (code && CONNECTION_ERROR_CODES.has(code)) {
    return {
      errorCode: ErrorCodes.CONNECTION_ERROR,
      errorMessage: `Connection failed (${code}): ${causeMessage}`,
    };
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return {
    errorCode: ErrorCodes.UNKNOWN_ERROR,
    errorMessage: err.message ?? 'Unknown error',
  };
}

// ── Headers ───────────────────────────────────────────────────────────────────

const MONITOR_HEADERS = Object.freeze({
  'User-Agent': 'PulseWatch/1.0 (uptime-monitor)',
  Accept:       '*/*',
});

// ── Main check function ────────────────────────────────────────────────────────

/**
 * @typedef {object} CheckResult
 * @property {boolean}     success          True when HTTP status was in expectedCodes.
 * @property {number|null} statusCode       HTTP status, or null on network-level failure.
 * @property {number|null} responseTimeMs   Total ms from sending request to headers received, or null on complete failure (preserved on TIMEOUT).
 * @property {string|null} errorCode        One of ErrorCodes, or null on success.
 * @property {string|null} errorMessage     Human-readable failure detail, or null on success.
 */

/**
 * Performs one HTTP health check for a monitor configuration.
 *
 * NEVER throws. All failures — including programmer errors during response
 * handling — are captured and returned as a failed CheckResult so the worker
 * can safely continue processing other monitors.
 *
 * @param {object}   monitor
 * @param {string}   monitor.url             Target URL
 * @param {string}   [monitor.method]        HTTP verb (GET, HEAD, POST, …) defaults to GET
 * @param {number}   [monitor.timeoutSeconds] Per-request timeout (seconds) defaults to 30
 * @param {number[]} [monitor.expectedCodes] HTTP status codes considered successful defaults to [200]
 * @param {object}   [options]
 * @param {Function} [options._fetch]        Override fetch (for integration tests)
 * @returns {Promise<CheckResult>}
 */
async function checkMonitor(monitor, options = {}) {
  const startTime = performance.now();

  if (!monitor || typeof monitor !== 'object') {
    return {
      success: false,
      statusCode: null,
      responseTimeMs: null,
      errorCode: ErrorCodes.UNKNOWN_ERROR,
      errorMessage: 'Invalid monitor configuration provided',
    };
  }

  const url = monitor.url;
  if (!url || typeof url !== 'string') {
    return {
      success: false,
      statusCode: null,
      responseTimeMs: null,
      errorCode: ErrorCodes.UNKNOWN_ERROR,
      errorMessage: 'Monitor URL is required and must be a string',
    };
  }

  const method = (monitor.method || 'GET').toUpperCase();
  const timeoutSeconds = monitor.timeoutSeconds ?? 30;
  const expectedCodes = Array.isArray(monitor.expectedCodes) && monitor.expectedCodes.length > 0
    ? monitor.expectedCodes
    : [200];

  // Allow test injection; production code always uses the global fetch
  const fetchFn = options._fetch ?? globalThis.fetch;
  const ssrfValidate = options._validateSsrf ?? validateUrlSsrf;
  const shouldValidateSsrf = options.validateSsrf ?? (process.env.NODE_ENV !== 'test' || Boolean(options._validateSsrf));
  const skipSsrf = options.skipSsrfValidation === true || !shouldValidateSsrf;

  const controller = new AbortController();
  const timeoutMs  = Math.max(1, timeoutSeconds * 1000);

  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // If validateInitialSsrf is true, validate initial URL before sending
  if (options.validateInitialSsrf && !skipSsrf) {
    const initialCheck = await ssrfValidate(url);
    if (!initialCheck.safe) {
      clearTimeout(timeoutHandle);
      return {
        success: false,
        statusCode: null,
        responseTimeMs: null,
        errorCode: ErrorCodes.SSRF_BLOCKED,
        errorMessage: `Target URL blocked by SSRF policy: ${initialCheck.reason}`,
      };
    }
  }

  let currentUrl = url;
  let redirectCount = 0;
  const maxRedirects = 5;
  let finalResponse = null;

  try {
    while (redirectCount <= maxRedirects) {
      // Validate redirect destination against SSRF policy
      if (redirectCount > 0 && !skipSsrf) {
        const redirectCheck = await ssrfValidate(currentUrl);
        if (!redirectCheck.safe) {
          return {
            success: false,
            statusCode: null,
            responseTimeMs: null,
            errorCode: ErrorCodes.SSRF_BLOCKED,
            errorMessage: `Redirect destination blocked by SSRF policy: ${redirectCheck.reason}`,
          };
        }
      }

      const currentMethod = redirectCount === 0 ? method : (finalResponse?.status === 303 ? 'GET' : method);

      const response = await fetchFn(currentUrl, {
        method: currentMethod,
        signal: controller.signal,
        redirect: 'manual',
        headers: MONITOR_HEADERS,
      });

      finalResponse = response;

      // Drain/discard response body
      if (response.body && !response.body.locked) {
        try {
          await response.body.cancel();
        } catch {
          // Safe to ignore body cancellation failure
        }
      }

      // Check if response is a redirect to follow
      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      const location = response.headers?.get?.('location') || response.headers?.location;

      if (isRedirect && location && !expectedCodes.includes(response.status)) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          return {
            success: false,
            statusCode: response.status,
            responseTimeMs: Math.round(performance.now() - startTime),
            errorCode: ErrorCodes.HTTP_ERROR,
            errorMessage: `Maximum redirect limit (${maxRedirects}) exceeded`,
          };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      break;
    }

    const responseTimeMs = Math.round(performance.now() - startTime);
    const statusCode     = finalResponse.status;
    const success        = expectedCodes.includes(statusCode);

    return {
      success,
      statusCode,
      responseTimeMs,
      errorCode:    success ? null : ErrorCodes.HTTP_ERROR,
      errorMessage: success
        ? null
        : `Received HTTP ${statusCode}; expected one of [${expectedCodes.join(', ')}]`,
    };
  } catch (err) {
    const responseTimeMs     = Math.round(performance.now() - startTime);
    const { errorCode, errorMessage } = classifyError(err);

    logger.debug(
      { url, method, errorCode, errorMessage, responseTimeMs },
      'Monitor check failed',
    );

    return {
      success:      false,
      statusCode:   null,
      // Preserve timing for timeout results — useful to confirm the timeout
      // fired close to the configured value. Null for other failures where
      // the timing has no useful meaning (no bytes were exchanged).
      responseTimeMs: errorCode === ErrorCodes.TIMEOUT ? responseTimeMs : null,
      errorCode,
      errorMessage,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { checkMonitor, classifyError, ErrorCodes };
