/**
 * Integration tests for Warden's main entrypoint (dry-run mode)
 *
 * These tests verify the full evaluation pipeline end-to-end:
 *   parseTransferRequest (regex fallback) → evaluate → AuditLogger → dry-run JSON output
 *
 * Dry-run mode activates when GitLab env vars (GITLAB_PROJECT_ID, etc.)
 * are absent — Warden prints a JSON decision to stdout instead of posting
 * a GitLab comment. The AI gateway is also absent, so the regex parser
 * handles extraction.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dir, '..', 'src', 'index.js');
const NODE = process.execPath;

/**
 * Build a clean env for running Warden in dry-run mode.
 * Strips all GitLab and AI gateway vars so Warden uses:
 *   - WARDEN_TEST_INPUT as the raw input (WARDEN_TEST_INPUT)
 *   - Regex fallback for parsing (no AI_FLOW_AI_GATEWAY_TOKEN)
 *   - stdout JSON output (no GITLAB_PROJECT_ID / GITLAB_ISSUE_IID)
 */
function buildEnv(input, overrides = {}) {
  const env = { ...process.env };

  // Remove GitLab env vars (so dry-run mode activates)
  const gitlabVars = [
    'AI_FLOW_INPUT',
    'AI_FLOW_CONTEXT',
    'AI_FLOW_GITLAB_TOKEN',
    'AI_FLOW_AI_GATEWAY_TOKEN',
    'GITLAB_PROJECT_ID',
    'GITLAB_ISSUE_IID',
  ];
  for (const key of gitlabVars) delete env[key];

  // Set test-specific vars
  env.WARDEN_TEST_INPUT = input;
  env.WARDEN_DB_PATH = ':memory:';

  // Apply caller overrides
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }

  return env;
}

/**
 * Run the Warden entrypoint in dry-run mode and return parsed stdout JSON.
 */
function runWarden(input, overrides = {}) {
  const result = spawnSync(
    NODE,
    ['--experimental-vm-modules', INDEX],
    {
      env: buildEnv(input, overrides),
      encoding: 'utf8',
      timeout: 12_000,
    }
  );

  let output = null;
  // The subprocess may print pretty-printed JSON (multi-line) or single-line.
  // Try the full stdout first; fall back to line-by-line scan.
  try {
    output = JSON.parse(result.stdout.trim());
  } catch {
    try {
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          output = JSON.parse(lines[i]);
          break;
        } catch {
          // keep scanning
        }
      }
    } catch {
      // ignore
    }
  }

  return { output, stdout: result.stdout, stderr: result.stderr, status: result.status };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ADDR_A = '0x1234567890123456789012345678901234567890';
const ADDR_BLACKLIST = '0xDeadDeadDeadDeadDeadDeadDeadDeadDeadDead';

// ─── Test Cases ──────────────────────────────────────────────────────────────

describe('Warden integration — dry-run mode (regex parser)', () => {
  test('approves a routine small transfer', () => {
    const { output, status } = runWarden(
      `@warden transfer 100 USDC to ${ADDR_A} for contractor payment`
    );
    expect(status).toBe(0);
    expect(output).not.toBeNull();
    expect(output.decision).toBe('APPROVE');
    expect(output.request.amount).toBe(100);
    expect(output.auditId).toBeTruthy();
  });

  test('marks zero-value transfer as ambiguous (amount: 0 fails confidence check)', () => {
    // Zero-amount requests: regex parser produces amount=0, confidence=0.3.
    // The entrypoint guards on `!request.amount` (since !0 === true) and returns
    // {status: "ambiguous"} before the policy engine runs — correct behavior,
    // as a zero-value request is most likely a mis-typed message.
    const { output, status } = runWarden(
      `@warden send 0 ETH to ${ADDR_A}`
    );
    expect(status).toBe(0);
    expect(output).not.toBeNull();
    expect(output.status).toBe('ambiguous');
    // The regex still extracts a recipient and token
    expect(output.request.recipient).toBeTruthy();
    expect(output.request.token).toBe('ETH');
  });

  test('escalates a transfer above auto-approve limit', () => {
    const { output, status } = runWarden(
      `@warden transfer 200 USDC to ${ADDR_A} for server costs`,
      { WARDEN_POLICY: JSON.stringify({ autoApproveLimit: 50 }) }
    );
    expect(status).toBe(0);
    expect(output).not.toBeNull();
    expect(output.decision).toBe('ESCALATE');
  });

  test('rejects a blacklisted recipient', () => {
    const { output, status } = runWarden(
      `@warden send 10 USDC to ${ADDR_BLACKLIST} for test`,
      { WARDEN_POLICY: JSON.stringify({ blacklist: [ADDR_BLACKLIST.toLowerCase()] }) }
    );
    expect(status).toBe(0);
    expect(output).not.toBeNull();
    expect(output.decision).toBe('REJECT');
    expect(output.rule).toBe('blacklist');
  });

  test('returns all required fields in output', () => {
    const { output } = runWarden(
      `@warden transfer 50 USDC to ${ADDR_A} for marketing`
    );
    expect(output).not.toBeNull();
    expect(output).toHaveProperty('decision');
    expect(output).toHaveProperty('rule');
    expect(output).toHaveProperty('reason');
    expect(output).toHaveProperty('request');
    expect(output).toHaveProperty('auditId');
    expect(['APPROVE', 'REJECT', 'ESCALATE']).toContain(output.decision);
  });

  test('exits 0 on successful evaluation', () => {
    const { status } = runWarden(
      `@warden transfer 100 USDC to ${ADDR_A} for payroll`
    );
    expect(status).toBe(0);
  });

  test('respects high limits in custom WARDEN_POLICY', () => {
    const { output } = runWarden(
      `@warden transfer 5000 USDC to ${ADDR_A} for infrastructure`,
      { WARDEN_POLICY: JSON.stringify({ autoApproveLimit: 10000, dailyLimit: 100000 }) }
    );
    expect(output).not.toBeNull();
    expect(output.decision).toBe('APPROVE');
  });

  test('handles malformed WARDEN_POLICY gracefully (falls back to defaults)', () => {
    const { status, output } = runWarden(
      `@warden transfer 50 USDC to ${ADDR_A} for test`,
      { WARDEN_POLICY: 'not-valid-json' }
    );
    expect(status).toBe(0);
    expect(output).not.toBeNull();
    expect(output.decision).toBeTruthy();
  });

  test('escalates when daily cap would be exceeded', () => {
    // Default daily limit is $10,000. Use a tiny limit so $200 triggers it.
    const { output } = runWarden(
      `@warden transfer 200 USDC to ${ADDR_A} for ops`,
      { WARDEN_POLICY: JSON.stringify({ dailyLimit: 100, autoApproveLimit: 500 }) }
    );
    expect(output).not.toBeNull();
    // dailyLimit < amount → ESCALATE
    expect(output.decision).toBe('ESCALATE');
  });
});
