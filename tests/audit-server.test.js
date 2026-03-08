/**
 * Warden Audit REST API — Test Suite
 *
 * Tests createAuditServer() using Node's built-in fetch (Node >= 18).
 * No external HTTP client dependencies required.
 */

import { createAuditServer } from '../src/audit/server.js';
import { AuditLogger } from '../src/audit/logger.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Start a test server on a random port and return { url, server, logger, close }. */
async function startTestServer(options = {}) {
  const logger = options.logger ?? new AuditLogger(':memory:');
  const { server } = createAuditServer({ logger });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    server,
    logger,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

/** Make a JSON GET request and return { status, body }. */
async function get(url, path) {
  const res = await fetch(`${url}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

/** Seed the logger with sample decisions. */
function seedLogger(logger) {
  const base = { request: { recipient: '0xABC', amount: 100, token: 'USDC', description: 'test' }, context: {}, state: {} };
  logger.record({ decision: 'APPROVE', rule: 'per-tx-limit', reason: 'Within limit', ...base });
  logger.record({ decision: 'APPROVE', rule: 'whitelist-multiplier', reason: 'Trusted address', ...{ ...base, request: { ...base.request, recipient: '0xTRUSTED', amount: 900 } } });
  logger.record({ decision: 'REJECT', rule: 'blacklist', reason: 'Recipient is blacklisted', ...{ ...base, request: { ...base.request, recipient: '0xBAD' } } });
  logger.record({ decision: 'ESCALATE', rule: 'daily-cap', reason: 'Daily cap exceeded', ...{ ...base, request: { ...base.request, amount: 5000 } } });
}

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  let ctx;
  beforeAll(async () => { ctx = await startTestServer(); });
  afterAll(() => ctx.close());

  test('returns 200 with status ok', async () => {
    const { status, body } = await get(ctx.url, '/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  test('includes uptime_seconds as a non-negative number', async () => {
    const { body } = await get(ctx.url, '/health');
    expect(typeof body.uptime_seconds).toBe('number');
    expect(body.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  test('includes ISO timestamp', async () => {
    const { body } = await get(ctx.url, '/health');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── GET /audit ───────────────────────────────────────────────────────────────

describe('GET /audit', () => {
  let ctx;
  beforeAll(async () => {
    const logger = new AuditLogger(':memory:');
    seedLogger(logger);
    ctx = await startTestServer({ logger });
  });
  afterAll(() => ctx.close());

  test('returns 200 with entries array', async () => {
    const { status, body } = await get(ctx.url, '/audit');
    expect(status).toBe(200);
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.count).toBe('number');
  });

  test('returns all 4 seeded entries by default', async () => {
    const { body } = await get(ctx.url, '/audit');
    expect(body.count).toBe(4);
  });

  test('filters by decision=APPROVE', async () => {
    const { body } = await get(ctx.url, '/audit?decision=APPROVE');
    expect(body.count).toBe(2);
    expect(body.entries.every(e => e.decision === 'APPROVE')).toBe(true);
  });

  test('filters by decision=REJECT', async () => {
    const { body } = await get(ctx.url, '/audit?decision=REJECT');
    expect(body.count).toBe(1);
    expect(body.entries[0].decision).toBe('REJECT');
  });

  test('filters by decision=ESCALATE', async () => {
    const { body } = await get(ctx.url, '/audit?decision=ESCALATE');
    expect(body.count).toBe(1);
  });

  test('respects limit parameter', async () => {
    const { body } = await get(ctx.url, '/audit?limit=2');
    expect(body.entries.length).toBeLessThanOrEqual(2);
    expect(body.filters.limit).toBe(2);
  });

  test('clamps limit to max 500', async () => {
    const { body } = await get(ctx.url, '/audit?limit=9999');
    expect(body.filters.limit).toBe(500);
  });

  test('clamps limit to min 1', async () => {
    const { body } = await get(ctx.url, '/audit?limit=0');
    expect(body.filters.limit).toBe(1);
  });

  test('includes filters in response', async () => {
    const { body } = await get(ctx.url, '/audit?decision=APPROVE&limit=10');
    expect(body.filters.decision).toBe('APPROVE');
    expect(body.filters.limit).toBe(10);
  });

  test('returns empty entries for unknown decision filter', async () => {
    const { body } = await get(ctx.url, '/audit?decision=UNKNOWN');
    expect(body.count).toBe(0);
  });

  test('each entry has required fields', async () => {
    const { body } = await get(ctx.url, '/audit');
    for (const entry of body.entries) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('decision');
      expect(entry).toHaveProperty('rule');
      expect(entry).toHaveProperty('reason');
    }
  });
});

// ─── GET /stats ───────────────────────────────────────────────────────────────

describe('GET /stats', () => {
  let ctx;
  beforeAll(async () => {
    const logger = new AuditLogger(':memory:');
    seedLogger(logger);
    ctx = await startTestServer({ logger });
  });
  afterAll(() => ctx.close());

  test('returns 200', async () => {
    const { status } = await get(ctx.url, '/stats');
    expect(status).toBe(200);
  });

  test('counts decisions correctly', async () => {
    const { body } = await get(ctx.url, '/stats');
    expect(body.decisions.approve).toBe(2);
    expect(body.decisions.reject).toBe(1);
    expect(body.decisions.escalate).toBe(1);
    expect(body.decisions.total).toBe(4);
  });

  test('calculates total amount approved correctly', async () => {
    const { body } = await get(ctx.url, '/stats');
    // 100 + 900 = 1000
    expect(body.amounts.total_approved).toBe(1000);
  });

  test('includes daily_spent', async () => {
    const { body } = await get(ctx.url, '/stats');
    expect(typeof body.amounts.daily_spent).toBe('number');
    expect(body.amounts.daily_spent).toBeGreaterThanOrEqual(0);
  });

  test('includes unique_approved recipients count', async () => {
    const { body } = await get(ctx.url, '/stats');
    // 0xABC and 0xTRUSTED are both approved
    expect(body.recipients.unique_approved).toBe(2);
  });

  test('includes activity metrics', async () => {
    const { body } = await get(ctx.url, '/stats');
    expect(typeof body.activity.hourly_tx_count).toBe('number');
    expect(body.activity.latest_decision).not.toBeNull();
  });

  test('latest_decision has id, timestamp, decision', async () => {
    const { body } = await get(ctx.url, '/stats');
    const { latest_decision } = body.activity;
    expect(latest_decision).toHaveProperty('id');
    expect(latest_decision).toHaveProperty('timestamp');
    expect(latest_decision).toHaveProperty('decision');
  });

  test('empty logger returns zeros', async () => {
    const emptyCtx = await startTestServer({ logger: new AuditLogger(':memory:') });
    const { body } = await get(emptyCtx.url, '/stats');
    expect(body.decisions.total).toBe(0);
    expect(body.amounts.total_approved).toBe(0);
    expect(body.activity.latest_decision).toBeNull();
    await emptyCtx.close();
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('Error handling', () => {
  let ctx;
  beforeAll(async () => { ctx = await startTestServer(); });
  afterAll(() => ctx.close());

  test('returns 404 for unknown routes', async () => {
    const { status } = await get(ctx.url, '/unknown');
    expect(status).toBe(404);
  });

  test('returns 405 for POST requests', async () => {
    const res = await fetch(`${ctx.url}/audit`, { method: 'POST' });
    const body = await res.json();
    expect(res.status).toBe(405);
    expect(body.error).toBeTruthy();
  });

  test('returns 405 for DELETE requests', async () => {
    const res = await fetch(`${ctx.url}/stats`, { method: 'DELETE' });
    expect(res.status).toBe(405);
  });

  test('returns JSON on all error responses', async () => {
    const res = await fetch(`${ctx.url}/not-a-route`);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/json');
  });
});

// ─── Multiple servers (isolation) ─────────────────────────────────────────────

describe('Server isolation', () => {
  test('two servers with different loggers are independent', async () => {
    const logger1 = new AuditLogger(':memory:');
    const logger2 = new AuditLogger(':memory:');
    seedLogger(logger1);
    // logger2 is empty

    const ctx1 = await startTestServer({ logger: logger1 });
    const ctx2 = await startTestServer({ logger: logger2 });

    const { body: body1 } = await get(ctx1.url, '/stats');
    const { body: body2 } = await get(ctx2.url, '/stats');

    expect(body1.decisions.total).toBe(4);
    expect(body2.decisions.total).toBe(0);

    await ctx1.close();
    await ctx2.close();
  });
});

// ─── clientError handler ──────────────────────────────────────────────────────

describe('Server clientError handler', () => {
  test('clientError event sends 400 and ends the socket', (done) => {
    import('net').then(({ createConnection }) => {
      createAuditServer({ logger: new AuditLogger(':memory:') }).then
        ? null
        : null; // server is sync

      const { server } = createAuditServer({ logger: new AuditLogger(':memory:') });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        const socket = createConnection(port, '127.0.0.1', () => {
          // Send malformed HTTP to trigger clientError
          socket.write('INVALID HTTP REQUEST\r\n\r\n');
        });

        let data = '';
        socket.on('data', chunk => { data += chunk.toString(); });
        socket.on('close', () => {
          server.close(() => {
            expect(data).toContain('400 Bad Request');
            done();
          });
        });
        socket.on('error', () => {
          // Socket errors during close are expected
          server.close(() => done());
        });
      });
    });
  });
});
