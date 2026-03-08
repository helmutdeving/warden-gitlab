/**
 * Warden Audit Logger
 * Append-only audit log using Node's built-in SQLite (node:sqlite, Node >= 22.5).
 * Falls back to in-memory JSON log when SQLite is unavailable (CI, testing).
 *
 * Every APPROVE/REJECT/ESCALATE decision is recorded with:
 *   - Timestamp (ISO 8601)
 *   - Decision + rule triggered
 *   - Transfer details (recipient, amount, token, description)
 *   - GitLab context (project, issue, user)
 */

let SqliteDatabase;
try {
  // node:sqlite is available in Node >= 22.5.0 (stable in Node 22 LTS)
  const { DatabaseSync } = await import('node:sqlite');
  SqliteDatabase = DatabaseSync;
} catch {
  // Fallback for Node < 22.5 — use in-memory log
  SqliteDatabase = null;
}

const IN_MEMORY_LOG = [];

export class AuditLogger {
  #db = null;
  #dbPath;
  #inMemory = false;

  constructor(dbPath = ':memory:') {
    this.#dbPath = dbPath;

    if (SqliteDatabase) {
      this.#db = new SqliteDatabase(dbPath);
      this.#initSchema();
    } else {
      this.#inMemory = true;
    }
  }

  #initSchema() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp   TEXT    NOT NULL,
        decision    TEXT    NOT NULL,
        rule        TEXT    NOT NULL,
        reason      TEXT    NOT NULL,
        recipient   TEXT,
        amount      REAL,
        token       TEXT,
        description TEXT,
        gitlab_project TEXT,
        gitlab_issue    INTEGER,
        gitlab_user     TEXT,
        daily_spent REAL,
        hourly_count INTEGER
      );
    `);
  }

  /**
   * Record an audit entry.
   * @param {object} entry
   */
  record({
    decision,
    rule,
    reason,
    request = {},
    context = {},
    state = {},
  }) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      decision,
      rule,
      reason,
      recipient: request.recipient ?? null,
      amount: request.amount ?? null,
      token: request.token ?? null,
      description: request.description ?? null,
      gitlab_project: context.project ?? null,
      gitlab_issue: context.issueIid ?? null,
      gitlab_user: context.user ?? null,
      daily_spent: state.dailySpent ?? null,
      hourly_count: state.hourlyTxCount ?? null,
    };

    if (this.#inMemory) {
      IN_MEMORY_LOG.push({ id: IN_MEMORY_LOG.length + 1, ...entry });
      return IN_MEMORY_LOG.length;
    }

    const stmt = this.#db.prepare(`
      INSERT INTO audit_log (
        timestamp, decision, rule, reason,
        recipient, amount, token, description,
        gitlab_project, gitlab_issue, gitlab_user,
        daily_spent, hourly_count
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?
      )
    `);

    const result = stmt.run(
      entry.timestamp, entry.decision, entry.rule, entry.reason,
      entry.recipient, entry.amount, entry.token, entry.description,
      entry.gitlab_project, entry.gitlab_issue, entry.gitlab_user,
      entry.daily_spent, entry.hourly_count
    );

    return result.lastInsertRowid;
  }

  /**
   * Query audit log entries.
   * @param {object} filters — { decision, since, limit }
   */
  query({ decision, since, limit = 50 } = {}) {
    if (this.#inMemory) {
      let results = [...IN_MEMORY_LOG];
      if (decision) results = results.filter(r => r.decision === decision);
      if (since) {
        const sinceDate = this.#parseSince(since);
        results = results.filter(r => new Date(r.timestamp) >= sinceDate);
      }
      return results.slice(-limit);
    }

    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];

    if (decision) {
      query += ' AND decision = ?';
      params.push(decision);
    }
    if (since) {
      query += ' AND timestamp >= ?';
      params.push(this.#parseSince(since).toISOString());
    }
    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    return this.#db.prepare(query).all(...params);
  }

  /**
   * Get spending stats for the current day/hour.
   */
  getState() {
    if (this.#inMemory) {
      const now = new Date();
      const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
      const hourAgo = new Date(now - 60 * 60 * 1000);
      const approved = IN_MEMORY_LOG.filter(r => r.decision === 'APPROVE');
      return {
        dailySpent: approved
          .filter(r => new Date(r.timestamp) >= dayAgo)
          .reduce((sum, r) => sum + (r.amount || 0), 0),
        hourlyTxCount: approved.filter(r => new Date(r.timestamp) >= hourAgo).length,
      };
    }

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const dailyRow = this.#db
      .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM audit_log WHERE decision = 'APPROVE' AND timestamp >= ?`)
      .get(dayAgo);

    const hourlyRow = this.#db
      .prepare(`SELECT COUNT(*) as count FROM audit_log WHERE decision = 'APPROVE' AND timestamp >= ?`)
      .get(hourAgo);

    return {
      dailySpent: dailyRow.total,
      hourlyTxCount: hourlyRow.count,
    };
  }

  /** Parse a human-readable 'since' string like "1h", "24h", "7d" */
  #parseSince(since) {
    const match = String(since).match(/^(\d+)([hdm])$/);
    if (!match) return new Date(0);
    const [, n, unit] = match;
    const ms = { h: 3600000, d: 86400000, m: 60000 }[unit] * Number(n);
    return new Date(Date.now() - ms);
  }

  close() {
    if (this.#db) this.#db.close();
  }
}
