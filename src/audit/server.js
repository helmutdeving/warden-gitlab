/**
 * Warden Audit REST API Server
 *
 * Exposes the append-only audit trail via HTTP. Intended as a sidecar to the
 * main Warden GitLab agent, giving treasury admins visibility into all
 * APPROVE/REJECT/ESCALATE decisions without touching the SQLite file directly.
 *
 * Endpoints:
 *   GET /health           — liveness probe
 *   GET /audit            — list log entries (query: decision, since, limit)
 *   GET /stats            — aggregate statistics
 *
 * Usage:
 *   node src/audit/server.js [--port 3000] [--db /path/to/warden.db]
 *
 * Environment:
 *   WARDEN_DB_PATH   — path to SQLite database (default: :memory:)
 *   AUDIT_PORT       — HTTP port (default: 3000)
 */

import { createServer } from 'node:http';
import { AuditLogger } from './logger.js';

// ─── Request Router ──────────────────────────────────────────────────────────

function parseQuery(url) {
  const { searchParams } = new URL(url, 'http://localhost');
  return Object.fromEntries(searchParams.entries());
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function methodNotAllowed(res) {
  json(res, 405, { error: 'Method not allowed' });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

function handleHealth(res, startTime) {
  json(res, 200, {
    status: 'ok',
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
}

function handleAudit(req, res, logger) {
  const q = parseQuery(req.url);
  const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10), 1), 500);
  const filters = {
    limit,
    decision: q.decision?.toUpperCase() || undefined,
    since: q.since || undefined,
  };

  const entries = logger.query(filters);
  json(res, 200, {
    entries,
    count: entries.length,
    filters: {
      decision: filters.decision ?? null,
      since: filters.since ?? null,
      limit,
    },
  });
}

function handleStats(req, res, logger) {
  // Pull all entries (no limit) for aggregation — SQLite is fast
  const all = logger.query({ limit: 10_000 });
  const state = logger.getState();

  const tally = { APPROVE: 0, REJECT: 0, ESCALATE: 0 };
  let totalAmountApproved = 0;

  for (const entry of all) {
    tally[entry.decision] = (tally[entry.decision] ?? 0) + 1;
    if (entry.decision === 'APPROVE' && entry.amount) {
      totalAmountApproved += entry.amount;
    }
  }

  // Unique recipients that received at least one APPROVE
  const approvedRecipients = new Set(
    all
      .filter(e => e.decision === 'APPROVE' && e.recipient)
      .map(e => e.recipient)
  );

  // Most recent entry
  const latest = all[0] ?? null;

  json(res, 200, {
    decisions: {
      approve: tally.APPROVE,
      reject: tally.REJECT,
      escalate: tally.ESCALATE,
      total: all.length,
    },
    amounts: {
      total_approved: totalAmountApproved,
      daily_spent: state.dailySpent,
    },
    recipients: {
      unique_approved: approvedRecipients.size,
    },
    activity: {
      hourly_tx_count: state.hourlyTxCount,
      latest_decision: latest
        ? { id: latest.id, timestamp: latest.timestamp, decision: latest.decision }
        : null,
    },
  });
}

// ─── Server Factory ──────────────────────────────────────────────────────────

/**
 * Create and return an HTTP server backed by a Warden AuditLogger.
 *
 * @param {object} options
 * @param {string} [options.dbPath=':memory:'] — SQLite db path (or ':memory:')
 * @param {AuditLogger} [options.logger]       — pre-existing logger instance
 * @returns {{ server: import('node:http').Server, logger: AuditLogger }}
 */
export function createAuditServer({ dbPath = ':memory:', logger: existingLogger } = {}) {
  const logger = existingLogger ?? new AuditLogger(dbPath);
  const startTime = Date.now();

  const server = createServer((req, res) => {
    const method = req.method.toUpperCase();
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (method !== 'GET') return methodNotAllowed(res);

    if (pathname === '/health') return handleHealth(res, startTime);
    if (pathname === '/audit') return handleAudit(req, res, logger);
    if (pathname === '/stats') return handleStats(req, res, logger);

    return notFound(res);
  });

  // Prevent 'ECONNRESET' crashes on abrupt client disconnects
  server.on('clientError', (_err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return { server, logger };
}

// ─── Standalone Entry ─────────────────────────────────────────────────────────

// Only run as a server when executed directly (not imported as a module)
const isMain = process.argv[1]?.endsWith('server.js');
if (isMain) {
  const port = parseInt(process.env.AUDIT_PORT ?? '3000', 10);
  const dbPath = process.env.WARDEN_DB_PATH ?? ':memory:';

  const { server, logger } = createAuditServer({ dbPath });

  server.listen(port, () => {
    console.log(`[Warden Audit API] Listening on http://0.0.0.0:${port}`);
    console.log(`[Warden Audit API] Database: ${dbPath}`);
    console.log('[Warden Audit API] Routes: GET /health, /audit, /stats');
  });

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`\n[Warden Audit API] Received ${sig}, shutting down...`);
      server.close(() => {
        logger.close();
        process.exit(0);
      });
    });
  }
}
