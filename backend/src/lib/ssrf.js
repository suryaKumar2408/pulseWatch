'use strict';

/**
 * SSRF Protection Utility
 *
 * Validates that a user-supplied URL does not target internal/private
 * infrastructure. Applied at monitor creation and update time.
 *
 * Two layers of protection:
 *   1. Synchronous: parse hostname; block if it is a literal private/loopback IP
 *      or a known-bad hostname (localhost, .local, cloud metadata, etc.)
 *   2. Asynchronous: DNS-resolve the hostname; block if any resolved A/AAAA
 *      record falls in a blocked range.
 *
 * DNS rebinding is an additional concern addressed in the monitoring worker
 * (Stage 4) where we re-validate the resolved IP on every check.
 *
 * The `resolve4` / `resolve6` options are injected to allow deterministic
 * unit testing without real network calls.
 */

const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const logger = require('./logger');

// ── Blocked hostnames ─────────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localtest.me',    // wildcard DNS → 127.0.0.1
  'broadcasthost',
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.local',         // mDNS / Bonjour
  '.internal',      // internal DNS zones
  '.corp',
  '.home',
  '.lan',
  '.example',
  '.invalid',
  '.test',
  '.localhost',
  '.cluster.local', // Kubernetes internal
  '.svc',           // Kubernetes internal services
];

// Cloud metadata endpoints by hostname or IP
const CLOUD_METADATA_HOSTS = new Set([
  '169.254.169.254',          // AWS / Azure / GCP / DigitalOcean
  'metadata.google.internal', // GCP
  'instance-data',            // OpenStack
  '100.100.100.200',          // Alibaba Cloud
  '192.0.0.192',              // Oracle Cloud
  'fd00:ec2::254',            // AWS IMDSv2 IPv6
  '[fd00:ec2::254]',
]);

// Restricted ports prone to cross-protocol exploitation (SSH, SMTP, databases, cache)
const BLOCKED_PORTS = new Set([
  22,    // SSH
  25,    // SMTP
  110,   // POP3
  143,   // IMAP
  465,   // SMTPS
  587,   // Submission
  3306,  // MySQL
  5432,  // PostgreSQL
  6379,  // Redis
  11211, // Memcached
  27017, // MongoDB
]);

// ── Blocked IPv4 ranges ───────────────────────────────────────────────────────

/**
 * Converts a dotted-decimal IPv4 string to an unsigned 32-bit integer.
 */
function ipv4ToInt(ip) {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) | parseInt(octet, 10)) >>> 0, 0);
}

const BLOCKED_IPV4_RANGES = [
  // This network
  { start: ipv4ToInt('0.0.0.0'),     end: ipv4ToInt('0.255.255.255') },
  // Loopback
  { start: ipv4ToInt('127.0.0.0'),   end: ipv4ToInt('127.255.255.255') },
  // Private (RFC 1918)
  { start: ipv4ToInt('10.0.0.0'),    end: ipv4ToInt('10.255.255.255') },
  { start: ipv4ToInt('172.16.0.0'),  end: ipv4ToInt('172.31.255.255') },
  { start: ipv4ToInt('192.168.0.0'), end: ipv4ToInt('192.168.255.255') },
  // Link-local (includes all cloud metadata IPs)
  { start: ipv4ToInt('169.254.0.0'), end: ipv4ToInt('169.254.255.255') },
  // Carrier-grade NAT (RFC 6598)
  { start: ipv4ToInt('100.64.0.0'),  end: ipv4ToInt('100.127.255.255') },
  // IETF protocol assignments
  { start: ipv4ToInt('192.0.0.0'),   end: ipv4ToInt('192.0.0.255') },
  // Documentation ranges (RFC 5737)
  { start: ipv4ToInt('192.0.2.0'),   end: ipv4ToInt('192.0.2.255') },
  { start: ipv4ToInt('198.51.100.0'),end: ipv4ToInt('198.51.100.255') },
  { start: ipv4ToInt('203.0.113.0'), end: ipv4ToInt('203.0.113.255') },
  // Benchmark testing (RFC 2544)
  { start: ipv4ToInt('198.18.0.0'),  end: ipv4ToInt('198.19.255.255') },
  // Multicast
  { start: ipv4ToInt('224.0.0.0'),   end: ipv4ToInt('239.255.255.255') },
  // Reserved / broadcast
  { start: ipv4ToInt('240.0.0.0'),   end: ipv4ToInt('255.255.255.255') },
];

function isBlockedIPv4(ip) {
  if (!net.isIPv4(ip)) return false;
  const n = ipv4ToInt(ip);
  return BLOCKED_IPV4_RANGES.some(({ start, end }) => n >= start && n <= end);
}

// ── Blocked IPv6 ranges ───────────────────────────────────────────────────────

function isBlockedIPv6(ip) {
  if (!net.isIPv6(ip)) return false;

  // Normalize: strip brackets that may appear in URL hostnames
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');

  return (
    normalized === '::1' ||                    // loopback
    normalized === '::' ||                     // unspecified
    normalized.startsWith('fc') ||             // Unique local (RFC 4193)
    normalized.startsWith('fd') ||             // Unique local (RFC 4193)
    normalized.startsWith('fe80') ||           // Link-local
    normalized.startsWith('::ffff:') ||        // IPv4-mapped (check underlying IPv4 below)
    normalized.startsWith('2001:db8') ||       // Documentation (RFC 3849)
    normalized.startsWith('100::') ||          // Discard
    normalized === '0:0:0:0:0:0:0:1' ||
    normalized === '0:0:0:0:0:0:0:0'
  );
}

/**
 * Checks if a literal IP address (v4 or v6) is in a blocked range.
 * Returns a reason string if blocked, null otherwise.
 */
function checkLiteralIp(ip) {
  const clean = ip.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Handle IPv4-mapped IPv6 addresses like ::ffff:192.168.1.1
  const ipv4MappedMatch = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4MappedMatch) {
    if (isBlockedIPv4(ipv4MappedMatch[1])) {
      return `IPv4-mapped address ${ipv4MappedMatch[1]} is in a blocked range`;
    }
    return null;
  }

  if (net.isIPv4(clean) && isBlockedIPv4(clean)) {
    return `IP address ${clean} is in a blocked range (private/loopback/link-local)`;
  }
  if (net.isIPv6(clean) && isBlockedIPv6(clean)) {
    return `IPv6 address ${clean} is blocked (loopback/link-local/unique-local)`;
  }
  return null;
}

// ── Main validation function ──────────────────────────────────────────────────

/**
 * Validates a URL for SSRF risks.
 *
 * @param {string} rawUrl - The URL to validate.
 * @param {object} [options]
 * @param {Function} [options.resolve4] - Override dns.resolve4 (for testing)
 * @param {Function} [options.resolve6] - Override dns.resolve6 (for testing)
 * @param {number}   [options.dnsTimeoutMs] - DNS timeout (default 5000)
 * @returns {Promise<{safe: boolean, reason?: string}>}
 */
async function validateUrlSsrf(rawUrl, options = {}) {
  const resolve4 = options.resolve4 ?? dns.resolve4.bind(dns);
  const resolve6 = options.resolve6 ?? dns.resolve6.bind(dns);
  const dnsTimeoutMs = options.dnsTimeoutMs ?? 5_000;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'URL is malformed' };
  }

  // ── 0. Strict scheme restriction (http/https only) ────────────────────────
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Scheme '${parsed.protocol}' is not allowed (must be http or https)` };
  }

  // ── 0b. Dangerous port check ──────────────────────────────────────────────
  if (parsed.port) {
    const portNum = parseInt(parsed.port, 10);
    if (BLOCKED_PORTS.has(portNum)) {
      return { safe: false, reason: `Port ${portNum} is restricted for security reasons` };
    }
  }

  // Allow local/private probing in development if explicitly enabled (not in test suite unless options.allowPrivate)
  if ((process.env.NODE_ENV !== 'test' && process.env.ALLOW_LOCAL_MONITORING === 'true') || options.allowPrivate === true) {
    return { safe: true };
  }

  const hostname = parsed.hostname.toLowerCase();

  // ── 1. Blocked hostname list ───────────────────────────────────────────────
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `Hostname '${hostname}' is not allowed` };
  }

  if (CLOUD_METADATA_HOSTS.has(hostname)) {
    return { safe: false, reason: `Cloud metadata endpoint '${hostname}' is blocked` };
  }

  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { safe: false, reason: `Hostname '${hostname}' matches a blocked pattern` };
  }

  // ── 2. Single-label hostnames (no dots) ───────────────────────────────────
  // e.g. http://internal, http://db — almost always internal services
  if (!hostname.includes('.') && !net.isIPv4(hostname) && !net.isIPv6(hostname.replace(/^\[|\]$/g, ''))) {
    return { safe: false, reason: `Single-label hostname '${hostname}' is not allowed` };
  }

  // ── 3. Literal IP address check (no DNS needed) ───────────────────────────
  const literalIpReason = checkLiteralIp(hostname);
  if (literalIpReason) {
    return { safe: false, reason: literalIpReason };
  }

  // ── 4. DNS resolution + IP range check ───────────────────────────────────
  // Skip for literal IPs (already checked above)
  if (!net.isIPv4(hostname) && !net.isIPv6(hostname.replace(/^\[|\]$/g, ''))) {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DNS timeout')), dnsTimeoutMs),
    );

    const resolveAll = Promise.allSettled([
      Promise.race([resolve4(hostname), timeout]),
      Promise.race([resolve6(hostname), timeout]),
    ]);

    let results;
    try {
      results = await resolveAll;
    } catch (err) {
      // If we can't resolve DNS at all, allow the URL — the actual check will fail naturally
      logger.warn({ hostname, err: err.message }, 'SSRF: DNS resolution failed, allowing');
      return { safe: true };
    }

    const ipv4Results = results[0].status === 'fulfilled' ? results[0].value : [];
    const ipv6Results = results[1].status === 'fulfilled' ? results[1].value : [];
    const allIps = [...ipv4Results, ...ipv6Results];

    for (const ip of allIps) {
      const reason = checkLiteralIp(ip);
      if (reason) {
        return {
          safe: false,
          reason: `Hostname '${hostname}' resolves to a blocked IP: ${reason}`,
        };
      }
    }
  }

  return { safe: true };
}

module.exports = { validateUrlSsrf, isBlockedIPv4, isBlockedIPv6, checkLiteralIp };
