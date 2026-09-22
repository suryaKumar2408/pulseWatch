'use strict';

const { validateUrlSsrf, isBlockedIPv4, isBlockedIPv6, checkLiteralIp } = require('../src/lib/ssrf');

// ── isBlockedIPv4 ─────────────────────────────────────────────────────────────

describe('isBlockedIPv4', () => {
  const blocked = [
    '127.0.0.1',
    '127.255.255.255',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '169.254.169.254',  // AWS metadata
    '169.254.0.1',
    '100.64.0.1',       // CGNAT
    '0.0.0.0',
    '240.0.0.1',        // Reserved
    '255.255.255.255',
    '224.0.0.1',        // Multicast
  ];

  const allowed = [
    '1.1.1.1',
    '8.8.8.8',
    '142.250.180.142',  // Google
    '93.184.216.34',    // example.com
    '51.144.0.0',
    '203.0.112.255',    // just outside documentation range
  ];

  test.each(blocked)('blocks %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
  });

  test.each(allowed)('allows %s', (ip) => {
    expect(isBlockedIPv4(ip)).toBe(false);
  });

  it('returns false for non-IPv4 input', () => {
    expect(isBlockedIPv4('::1')).toBe(false);
    expect(isBlockedIPv4('not-an-ip')).toBe(false);
  });
});

// ── isBlockedIPv6 ─────────────────────────────────────────────────────────────

describe('isBlockedIPv6', () => {
  const blocked = [
    '::1',              // loopback
    '::',               // unspecified
    'fe80::1',          // link-local
    'fc00::1',          // unique local
    'fd12:3456::1',     // unique local
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '2001:db8::1',      // documentation
  ];

  const allowed = [
    '2001:4860:4860::8888',  // Google DNS
    '2606:4700:4700::1111',  // Cloudflare DNS
    '2400:cb00::1',
  ];

  test.each(blocked)('blocks %s', (ip) => {
    expect(isBlockedIPv6(ip)).toBe(true);
  });

  test.each(allowed)('allows %s', (ip) => {
    expect(isBlockedIPv6(ip)).toBe(false);
  });

  it('returns false for non-IPv6 input', () => {
    expect(isBlockedIPv6('1.2.3.4')).toBe(false);
    expect(isBlockedIPv6('hostname')).toBe(false);
  });
});

// ── checkLiteralIp ────────────────────────────────────────────────────────────

describe('checkLiteralIp', () => {
  it('returns a reason string for a private IPv4', () => {
    expect(checkLiteralIp('192.168.1.1')).toMatch(/blocked/i);
  });

  it('returns a reason string for loopback', () => {
    expect(checkLiteralIp('127.0.0.1')).toMatch(/blocked/i);
  });

  it('returns null for a public IPv4', () => {
    expect(checkLiteralIp('1.1.1.1')).toBeNull();
  });

  it('handles IPv6 brackets in URL hostnames', () => {
    // URL hostnames for IPv6 look like [::1]
    expect(checkLiteralIp('[::1]')).toMatch(/blocked/i);
  });

  it('handles IPv4-mapped IPv6 addresses', () => {
    expect(checkLiteralIp('::ffff:10.0.0.1')).toMatch(/blocked/i);
  });

  it('returns null for a public IPv6', () => {
    expect(checkLiteralIp('2001:4860:4860::8888')).toBeNull();
  });
});

// ── validateUrlSsrf ───────────────────────────────────────────────────────────

describe('validateUrlSsrf', () => {
  // ── Literal IP addresses (no DNS needed) ────────────────────────────────────

  it('blocks http://127.0.0.1/ (loopback)', async () => {
    const result = await validateUrlSsrf('http://127.0.0.1/');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/blocked/i);
  });

  it('blocks http://0.0.0.0/', async () => {
    const result = await validateUrlSsrf('http://0.0.0.0/');
    expect(result.safe).toBe(false);
  });

  it('blocks http://10.0.0.1/ (private RFC 1918)', async () => {
    const result = await validateUrlSsrf('http://10.0.0.1/');
    expect(result.safe).toBe(false);
  });

  it('blocks http://172.16.50.1/ (private RFC 1918)', async () => {
    const result = await validateUrlSsrf('http://172.16.50.1/');
    expect(result.safe).toBe(false);
  });

  it('blocks http://192.168.1.1/ (private RFC 1918)', async () => {
    const result = await validateUrlSsrf('http://192.168.1.1/');
    expect(result.safe).toBe(false);
  });

  it('blocks http://169.254.169.254/ (cloud metadata)', async () => {
    const result = await validateUrlSsrf('http://169.254.169.254/');
    expect(result.safe).toBe(false);
  });

  it('blocks http://[::1]/ (IPv6 loopback)', async () => {
    const result = await validateUrlSsrf('http://[::1]/');
    expect(result.safe).toBe(false);
  });

  it('blocks http://[fc00::1]/ (IPv6 unique local)', async () => {
    const result = await validateUrlSsrf('http://[fc00::1]/');
    expect(result.safe).toBe(false);
  });

  it('blocks http://[fe80::1]/ (IPv6 link-local)', async () => {
    const result = await validateUrlSsrf('http://[fe80::1]/');
    expect(result.safe).toBe(false);
  });

  // ── Blocked hostnames (no DNS needed) ────────────────────────────────────────

  it('blocks http://localhost/', async () => {
    const result = await validateUrlSsrf('http://localhost/');
    expect(result.safe).toBe(false);
  });

  it('blocks single-label hostnames like http://internal/', async () => {
    const result = await validateUrlSsrf('http://internal/');
    expect(result.safe).toBe(false);
  });

  it('blocks .local hostnames (mDNS)', async () => {
    const result = await validateUrlSsrf('http://my-service.local/');
    expect(result.safe).toBe(false);
  });

  it('blocks cloud metadata hostname metadata.google.internal', async () => {
    const result = await validateUrlSsrf('http://metadata.google.internal/');
    expect(result.safe).toBe(false);
  });

  // ── DNS-resolved addresses ─────────────────────────────────────────────────
  // Inject mock resolvers so these tests don't hit the network.

  it('blocks a hostname that resolves to a private IP', async () => {
    const result = await validateUrlSsrf('https://evil.example.com', {
      resolve4: () => Promise.resolve(['10.0.0.1']),
      resolve6: () => Promise.reject(new Error('ENODATA')),
    });

    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/10\.0\.0\.1/);
  });

  it('blocks a hostname that resolves to a loopback IP', async () => {
    const result = await validateUrlSsrf('https://rebind.example.com', {
      resolve4: () => Promise.resolve(['127.0.0.1']),
      resolve6: () => Promise.reject(new Error('ENODATA')),
    });

    expect(result.safe).toBe(false);
  });

  it('allows a hostname that resolves to a public IP', async () => {
    const result = await validateUrlSsrf('https://example.com', {
      resolve4: () => Promise.resolve(['93.184.216.34']),
      resolve6: () => Promise.reject(new Error('ENODATA')),
    });

    expect(result.safe).toBe(true);
  });

  it('allows when DNS times out (fail-open, actual check will fail naturally)', async () => {
    // When DNS is unreachable, we allow the URL rather than silently blocking
    // legitimate monitors during a DNS outage.
    const result = await validateUrlSsrf('https://example.com', {
      resolve4: () => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1)),
      resolve6: () => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1)),
      dnsTimeoutMs: 5,
    });

    // Fail-open: allow so legitimate monitors aren't broken during DNS issues
    expect(result.safe).toBe(true);
  });

  it('blocks if any resolved IP is private (even if others are public)', async () => {
    const result = await validateUrlSsrf('https://mixed.example.com', {
      resolve4: () => Promise.resolve(['1.1.1.1', '10.0.0.1']),
      resolve6: () => Promise.reject(new Error('ENODATA')),
    });

    expect(result.safe).toBe(false);
  });

  it('checks IPv6 DNS records as well', async () => {
    const result = await validateUrlSsrf('https://ipv6-internal.example.com', {
      resolve4: () => Promise.reject(new Error('ENODATA')),
      resolve6: () => Promise.resolve(['fc00::1']),
    });

    expect(result.safe).toBe(false);
  });

  // ── Protocol / Scheme restrictions ──────────────────────────────────────────

  describe('Protocol / Scheme restrictions', () => {
    const dangerousSchemes = [
      'file:///etc/passwd',
      'ftp://ftp.example.com/file',
      'gopher://gopher.example.com/',
      'dict://dict.example.com/',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'ldap://ldap.example.com/',
    ];

    test.each(dangerousSchemes)('blocks %s', async (url) => {
      const result = await validateUrlSsrf(url);
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/scheme/i);
    });

    it('allows valid http and https schemes', async () => {
      const httpRes = await validateUrlSsrf('http://93.184.216.34/');
      const httpsRes = await validateUrlSsrf('https://93.184.216.34/');
      expect(httpRes.safe).toBe(true);
      expect(httpsRes.safe).toBe(true);
    });
  });

  // ── Dangerous Port restrictions ─────────────────────────────────────────────

  describe('Dangerous Port restrictions', () => {
    const dangerousPorts = [
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
    ];

    test.each(dangerousPorts)('blocks dangerous port %i', async (port) => {
      const result = await validateUrlSsrf(`http://93.184.216.34:${port}/`);
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/restricted/i);
    });

    it('allows standard web ports (80, 443, 8080, 8443, 3000)', async () => {
      for (const port of [80, 443, 8080, 8443, 3000]) {
        const result = await validateUrlSsrf(`http://93.184.216.34:${port}/`);
        expect(result.safe).toBe(true);
      }
    });
  });

  // ── Extended Cloud Metadata & Internal Domains ──────────────────────────────

  describe('Extended Cloud Metadata & Internal Domains', () => {
    it('blocks Alibaba Cloud metadata (100.100.100.200)', async () => {
      const result = await validateUrlSsrf('http://100.100.100.200/latest/meta-data/');
      expect(result.safe).toBe(false);
    });

    it('blocks Oracle Cloud metadata (192.0.0.192)', async () => {
      const result = await validateUrlSsrf('http://192.0.0.192/latest/meta-data/');
      expect(result.safe).toBe(false);
    });

    it('blocks AWS IMDSv2 IPv6 metadata (fd00:ec2::254)', async () => {
      const result = await validateUrlSsrf('http://[fd00:ec2::254]/latest/meta-data/');
      expect(result.safe).toBe(false);
    });

    it('blocks Kubernetes internal service suffixes (.cluster.local, .svc)', async () => {
      const res1 = await validateUrlSsrf('http://auth-service.production.svc.cluster.local/');
      const res2 = await validateUrlSsrf('http://database.default.svc/');
      expect(res1.safe).toBe(false);
      expect(res2.safe).toBe(false);
    });

    it('blocks decimal, octal, and hex IP notations', async () => {
      // 2130706433 is decimal for 127.0.0.1
      const decimalRes = await validateUrlSsrf('http://2130706433/');
      expect(decimalRes.safe).toBe(false);

      // 0177.0.0.1 is octal for 127.0.0.1
      const octalRes = await validateUrlSsrf('http://0177.0.0.1/');
      expect(octalRes.safe).toBe(false);

      // 0x7f.1 is hex/short for 127.0.0.1
      const hexRes = await validateUrlSsrf('http://0x7f.1/');
      expect(hexRes.safe).toBe(false);
    });
  });
});

// ── Redirect SSRF Protection in HTTP Checker ─────────────────────────────────

const { checkMonitor, ErrorCodes } = require('../src/lib/checker');

describe('Redirect SSRF Protection in checkMonitor', () => {
  it('blocks redirects to internal cloud metadata (169.254.169.254)', async () => {
    let callCount = 0;
    const mockFetch = jest.fn(async (url) => {
      callCount++;
      if (callCount === 1) {
        // First hop: public target returns 302 redirecting to cloud metadata
        return {
          status: 302,
          headers: new Headers({
            location: 'http://169.254.169.254/latest/meta-data/',
          }),
          body: { cancel: jest.fn() },
        };
      }
      return {
        status: 200,
        headers: new Headers(),
        body: { cancel: jest.fn() },
      };
    });

    const result = await checkMonitor(
      {
        url: 'https://public-service.com/health',
        expectedCodes: [200],
      },
      {
        _fetch: mockFetch,
        // The initial target is simulated as safe public domain
        _validateSsrf: async (target) => {
          if (target.includes('169.254.169.254') || target.includes('127.0.0.1')) {
            return { safe: false, reason: 'Restricted address' };
          }
          return { safe: true };
        },
      }
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(ErrorCodes.SSRF_BLOCKED);
    expect(result.errorMessage).toMatch(/redirect destination blocked/i);
    // Verified that fetch was NOT called for the second (internal) hop
    expect(callCount).toBe(1);
  });

  it('blocks redirects to loopback addresses', async () => {
    let callCount = 0;
    const mockFetch = jest.fn(async () => {
      callCount++;
      return {
        status: 301,
        headers: new Headers({
          location: 'http://127.0.0.1:8080/admin',
        }),
        body: { cancel: jest.fn() },
      };
    });

    const result = await checkMonitor(
      { url: 'https://api.example.com/check' },
      {
        _fetch: mockFetch,
        _validateSsrf: async (target) => {
          if (target.includes('127.0.0.1')) {
            return { safe: false, reason: 'Loopback IP is blocked' };
          }
          return { safe: true };
        },
      }
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(ErrorCodes.SSRF_BLOCKED);
    expect(callCount).toBe(1);
  });

  it('detects and terminates redirect loops exceeding 5 hops', async () => {
    let callCount = 0;
    const mockFetch = jest.fn(async () => {
      callCount++;
      return {
        status: 302,
        headers: new Headers({
          location: `https://public.example.com/loop-${callCount}`,
        }),
        body: { cancel: jest.fn() },
      };
    });

    const result = await checkMonitor(
      { url: 'https://public.example.com/loop-0' },
      {
        _fetch: mockFetch,
        _validateSsrf: async () => ({ safe: true }),
      }
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe(ErrorCodes.HTTP_ERROR);
    expect(result.errorMessage).toMatch(/maximum redirect limit/i);
  });
});

// ── WebhookProvider SSRF Protection ──────────────────────────────────────────

const WebhookProvider = require('../src/notifications/providers/webhookProvider');

describe('WebhookProvider SSRF Protection', () => {
  it('rejects sending webhook notifications to private or metadata addresses', async () => {
    const provider = new WebhookProvider();

    await expect(
      provider.send({
        recipient: 'http://169.254.169.254/webhook',
        subject: 'Alert',
        body: 'Down',
      })
    ).rejects.toThrow(/SSRF policy/i);

    await expect(
      provider.send({
        recipient: 'http://127.0.0.1:6379/alert',
        subject: 'Alert',
        body: 'Down',
      })
    ).rejects.toThrow(/SSRF policy/i);
  });
});

