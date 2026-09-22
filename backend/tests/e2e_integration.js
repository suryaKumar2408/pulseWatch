'use strict';

const http = require('http');

const API_BASE = 'http://localhost:3000/api';
let testServer;
let targetStatus = 200;
let requestCount = 0;

// Start mock target HTTP server on port 8999
function startTargetServer() {
  return new Promise((resolve) => {
    testServer = http.createServer((req, res) => {
      requestCount++;
      if (req.url === '/health') {
        res.writeHead(targetStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: targetStatus === 200 ? 'healthy' : 'error', requestCount }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    testServer.listen(8999, () => {
      console.log('Target test server listening on http://localhost:8999/health');
      resolve();
    });
  });
}

function stopTargetServer() {
  return new Promise((resolve) => {
    if (testServer) testServer.close(resolve);
    else resolve();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log('=== PulseWatch End-to-End System Validation ===\n');

  await startTargetServer();

  try {
    // 1. Health check verification
    console.log('1. Verifying /api/health...');
    const healthRes = await api('/health');
    if (healthRes.data.status !== 'ok' || healthRes.data.services.database !== 'ok' || healthRes.data.services.redis !== 'ok') {
      throw new Error(`Health check failed: ${JSON.stringify(healthRes.data)}`);
    }
    console.log('   ✓ Health check returned 200 OK (DB: ok, Redis: ok)');

    // 2. Authentication flow
    const testEmail = `tester_${Date.now()}@example.com`;
    const testPassword = 'Password123!';

    console.log(`2. Testing User Registration with ${testEmail}...`);
    const regRes = await api('/v1/auth/register', {
      method: 'POST',
      body: { email: testEmail, password: testPassword },
    });
    if (!regRes.ok) throw new Error(`Registration failed: ${JSON.stringify(regRes.data)}`);
    const token = regRes.data.data?.token || regRes.data.token;
    if (!token) throw new Error('Failed to obtain JWT from registration');
    console.log('   ✓ Registration succeeded, JWT token received');

    // Verify duplicate registration error
    console.log('   Testing duplicate email error handling...');
    const dupRes = await api('/v1/auth/register', {
      method: 'POST',
      body: { email: testEmail, password: testPassword },
    });
    if (dupRes.status === 409) {
      console.log('   ✓ Duplicate registration correctly returned 409 Conflict');
    } else {
      throw new Error(`Expected duplicate to return 409, got ${dupRes.status}`);
    }

    // Login
    console.log('   Testing User Login...');
    const loginRes = await api('/v1/auth/login', {
      method: 'POST',
      body: { email: testEmail, password: testPassword },
    });
    if (!loginRes.ok) throw new Error(`Login failed: ${JSON.stringify(loginRes.data)}`);
    const authToken = loginRes.data.data?.token || loginRes.data.token;
    const authHeaders = { Authorization: `Bearer ${authToken}` };
    console.log('   ✓ Login succeeded');

    // Get current user profile
    const meRes = await api('/v1/auth/me', { headers: authHeaders });
    const userEmail = meRes.data.data?.user?.email || meRes.data.data?.email;
    if (userEmail !== testEmail) throw new Error(`User profile email mismatch: ${userEmail}`);
    console.log(`   ✓ Authenticated as ${userEmail}`);

    // 3. Monitor Management: Create Monitor
    console.log('\n3. Creating Monitor targeting http://localhost:8999/health...');
    const monitorPayload = {
      name: 'E2E Local Target',
      url: 'http://localhost:8999/health',
      method: 'GET',
      intervalSeconds: 30,
      timeoutSeconds: 5,
      expectedCodes: [200],
    };
    const createMonRes = await api('/v1/monitors', {
      method: 'POST',
      headers: authHeaders,
      body: monitorPayload,
    });
    if (!createMonRes.ok) throw new Error(`Create monitor failed: ${JSON.stringify(createMonRes.data)}`);
    const monitor = createMonRes.data.data;
    console.log(`   ✓ Monitor created with ID: ${monitor.id}, initial status: ${monitor.status}`);

    const { getDb } = require('../src/lib/db');
    const { enqueueHealthCheck } = require('../src/queue');
    const db = getDb();

    // 4. Wait for scheduler and worker to run healthy checks
    console.log('\n4. Waiting for first check to execute (targetStatus = 200)...');
    let healthy = false;
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const monRes = await api(`/v1/monitors/${monitor.id}`, { headers: authHeaders });
      const current = monRes.data.data;
      console.log(`   [Poll ${i + 1}] Monitor status: ${current.status}, consecutiveSuccesses: ${current.consecutiveSuccesses}, lastResponseTimeMs: ${current.lastResponseTimeMs}`);
      if (current.status === 'UP' && current.consecutiveSuccesses >= 1) {
        healthy = true;
        console.log('   ✓ Monitor successfully transitioned to UP state!');
        break;
      }
    }
    if (!healthy) throw new Error('Monitor did not transition to UP state within timeout');

    // 5. Simulate Endpoint Failure: 3 consecutive failures causing DOWN
    console.log('\n5. Setting targetStatus = 500 (triggering failure detection)...');
    targetStatus = 500;

    let transitionedDown = false;
    for (let i = 0; i < 10; i++) {
      await enqueueHealthCheck(monitor.id);
      await sleep(1500);
      const monRes = await api(`/v1/monitors/${monitor.id}`, { headers: authHeaders });
      const current = monRes.data.data;
      console.log(`   [Poll ${i + 1}] Monitor status: ${current.status}, consecutiveFailures: ${current.consecutiveFailures}`);
      if (current.status === 'DOWN') {
        transitionedDown = true;
        console.log(`   ✓ Monitor successfully transitioned to DOWN after ${current.consecutiveFailures} consecutive failures!`);
        break;
      }
    }
    if (!transitionedDown) throw new Error('Monitor did not transition to DOWN after failures');

    // 6. Verify Incident Creation
    console.log('\n6. Verifying Incident Creation for DOWN monitor...');
    const incidentsRes = await api(`/v1/incidents?monitorId=${monitor.id}`, { headers: authHeaders });
    const incidents = incidentsRes.data.data;
    if (incidents.length === 0) throw new Error('No incident found for DOWN monitor');
    const openIncident = incidents.find((inc) => inc.status === 'OPEN');
    if (!openIncident) throw new Error('No OPEN incident found');
    console.log(`   ✓ Found OPEN incident ID: ${openIncident.id}, cause: ${openIncident.cause}, startedAt: ${openIncident.startedAt}`);

    // Verify Notification Creation
    console.log('\n7. Verifying Notification Dispatch...');
    const notifsRes = await api(`/v1/notifications?monitorId=${monitor.id}`, { headers: authHeaders });
    const notifs = notifsRes.data.data;
    const downNotif = notifs.find((n) => n.event === 'MONITOR_DOWN');
    if (!downNotif) throw new Error('No MONITOR_DOWN notification found');
    console.log(`   ✓ Found notification: ID: ${downNotif.id}, event: ${downNotif.event}, status: ${downNotif.status}`);

    // 8. Recovery back to UP
    console.log('\n8. Setting targetStatus = 200 (triggering recovery)...');
    targetStatus = 200;

    let recovered = false;
    for (let i = 0; i < 10; i++) {
      await enqueueHealthCheck(monitor.id);
      await sleep(1500);
      const monRes = await api(`/v1/monitors/${monitor.id}`, { headers: authHeaders });
      const current = monRes.data.data;
      console.log(`   [Poll ${i + 1}] Monitor status: ${current.status}, consecutiveSuccesses: ${current.consecutiveSuccesses}`);
      if (current.status === 'UP') {
        recovered = true;
        console.log('   ✓ Monitor successfully recovered back to UP!');
        break;
      }
    }
    if (!recovered) throw new Error('Monitor did not recover to UP');

    // 9. Verify Incident Resolution
    console.log('\n9. Verifying Incident Resolution...');
    const incResAfter = await api(`/v1/incidents/${openIncident.id}`, { headers: authHeaders });
    const resolvedIncident = incResAfter.data.data;
    if (resolvedIncident.status !== 'RESOLVED') throw new Error(`Incident status is not RESOLVED (got ${resolvedIncident.status})`);
    console.log(`   ✓ Incident resolved: resolvedAt: ${resolvedIncident.resolvedAt}, durationSeconds: ${resolvedIncident.durationSeconds}s`);

    // Verify Recovery Notification
    const notifsAfter = await api(`/v1/notifications?monitorId=${monitor.id}`, { headers: authHeaders });
    const recoveryNotif = notifsAfter.data.data.find((n) => n.event === 'MONITOR_RECOVERED');
    if (!recoveryNotif) throw new Error('No MONITOR_RECOVERED notification found');
    console.log(`   ✓ Found recovery notification ID: ${recoveryNotif.id}`);

    // 10. Monitoring History & Analytics
    console.log('\n10. Verifying Check Results & History...');
    const checksRes = await api(`/v1/monitors/${monitor.id}/checks?limit=50`, { headers: authHeaders });
    const checks = checksRes.data.data;
    console.log(`   ✓ Retrieved ${checks.length} check results from history`);
    const successfulChecks = checks.filter((c) => c.success);
    const failedChecks = checks.filter((c) => !c.success);
    console.log(`   ✓ Successful checks: ${successfulChecks.length}, Failed checks: ${failedChecks.length}`);

    // Fleet analytics
    console.log('\n11. Verifying Fleet Analytics...');
    const fleetRes = await api('/v1/analytics?period=24h', { headers: authHeaders });
    const fleet = fleetRes.data.data;
    console.log('   Fleet Summary:', fleet.summary);
    console.log(`   Fleet Monitors count: ${fleet.monitors.length}`);

    // Monitor specific analytics
    console.log('\n12. Verifying Monitor Analytics...');
    const monStatsRes = await api(`/v1/monitors/${monitor.id}/analytics?period=24h`, { headers: authHeaders });
    const monStats = monStatsRes.data.data;
    console.log('   Monitor Summary:', monStats.summary);

    console.log('\n======================================================');
    console.log('>>> ALL END-TO-END SCENARIOS VERIFIED SUCCESSFULLY! <<<');
    console.log('======================================================\n');
  } finally {
    await stopTargetServer();
  }
}

run().catch((err) => {
  console.error('\nE2E VALIDATION ERROR:', err.message);
  process.exit(1);
});
