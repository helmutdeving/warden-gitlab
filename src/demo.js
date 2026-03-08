/**
 * Warden GitLab Demo
 *
 * Demonstrates Warden evaluating 6 realistic treasury scenarios
 * without requiring a live GitLab connection or AI gateway.
 *
 * Run: node src/demo.js
 */

import { evaluate, DEFAULT_POLICY } from './policy/engine.js';
import { parseWithRegex } from './gitlab/parser.js';
import { formatDecisionComment } from './gitlab/commenter.js';
import { AuditLogger } from './audit/logger.js';

// ANSI colors
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

const DEMO_POLICY = {
  ...DEFAULT_POLICY,
  autoApproveLimit: 500,
  dailyLimit: 2000,
  maxTxPerHour: 5,
  blacklist: ['0xDead000000000000000000000000000000000000'],
  whitelist: ['0xAbCd1234567890AbCd1234567890AbCd12345678'],
};

const SCENARIOS = [
  {
    label: 'Routine contractor payment (APPROVE)',
    input: '@warden transfer 250 USDC to 0x1234567890123456789012345678901234567890 for Q1 design contractor',
  },
  {
    label: 'Whitelisted address — above daily cap (ESCALATE)',
    input: '@warden please send 3000 USDC to 0xAbCd1234567890AbCd1234567890AbCd12345678 for infrastructure costs',
  },
  {
    label: 'Large transfer — exceeds auto-approve (ESCALATE)',
    input: '@warden transfer 750 ETH to 0xFeed000000000000000000000000000000000001 for token buyback',
  },
  {
    label: 'Blacklisted recipient (REJECT)',
    input: '@warden send 10 USDC to 0xDead000000000000000000000000000000000000 for test',
  },
  {
    label: 'Daily cap exceeded (ESCALATE)',
    input: '@warden transfer 400 USDC to 0x9999999999999999999999999999999999999999 for server costs',
    priorSpend: 1800, // simulates $1800 already spent today
  },
  {
    label: 'Zero-value guard (REJECT)',
    input: '@warden send 0 ETH to 0x5555555555555555555555555555555555555555',
  },
];

async function runDemo() {
  const logger = new AuditLogger(':memory:');
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Warden Treasury Sentinel — GitLab Duo Demo              ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════╝${C.reset}\n`);
  console.log(`${C.dim}Policy: autoApprove=$${DEMO_POLICY.autoApproveLimit} | daily=$${DEMO_POLICY.dailyLimit} | maxTx/hr=${DEMO_POLICY.maxTxPerHour}${C.reset}\n`);

  for (let i = 0; i < SCENARIOS.length; i++) {
    const { label, input, priorSpend } = SCENARIOS[i];
    console.log(`${C.bold}Scenario ${i + 1}: ${label}${C.reset}`);
    console.log(`${C.dim}Input: "${input}"${C.reset}`);

    // Parse
    const request = parseWithRegex(input.replace('@warden', '').trim());

    // State (simulate prior spend if specified)
    const state = priorSpend != null
      ? { dailySpent: priorSpend, hourlyTxCount: 0 }
      : logger.getState();

    // Evaluate
    const { decision, rule, reason } = evaluate(request, DEMO_POLICY, state);

    // Log
    const auditId = logger.record({ decision, rule, reason, request, context: { project: 'demo/project', issueIid: i + 1, user: 'contributor' }, state });

    // Display
    const color = decision === 'APPROVE' ? C.green : decision === 'REJECT' ? C.red : C.yellow;
    console.log(`${color}${C.bold}→ ${decision}${C.reset} ${C.dim}(rule: ${rule}, audit #${auditId})${C.reset}`);
    console.log(`  ${C.dim}${reason}${C.reset}`);

    if (request.recipient || request.amount) {
      const parts = [];
      if (request.amount) parts.push(`${request.amount} ${request.token}`);
      if (request.recipient) parts.push(`to ${request.recipient.slice(0, 10)}...`);
      console.log(`  ${C.dim}Parsed: ${parts.join(' ')}${C.reset}`);
    }

    console.log();
  }

  // Summary
  const log = logger.query({ limit: 10 });
  const counts = log.reduce((acc, r) => {
    acc[r.decision] = (acc[r.decision] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`${C.bold}${C.cyan}━━━ Audit Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`${C.green}  APPROVE:  ${counts.APPROVE ?? 0}${C.reset}`);
  console.log(`${C.red}  REJECT:   ${counts.REJECT ?? 0}${C.reset}`);
  console.log(`${C.yellow}  ESCALATE: ${counts.ESCALATE ?? 0}${C.reset}`);
  console.log(`\n${C.dim}All decisions logged to append-only audit trail.${C.reset}`);
  console.log(`${C.dim}In production: Claude extracts requests via GitLab AI Gateway.${C.reset}`);
  console.log(`${C.dim}Decisions posted as GitLab issue comments automatically.${C.reset}\n`);

  logger.close();
}

runDemo().catch(console.error);
