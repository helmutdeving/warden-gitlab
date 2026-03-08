/**
 * Warden Treasury Sentinel — GitLab Duo External Agent
 *
 * Entry point. Reads GitLab-injected environment variables, parses the
 * transfer request using Claude, evaluates policy, posts the decision
 * back to the issue, and exits.
 *
 * Environment (injected by GitLab Duo Agent Platform):
 *   AI_FLOW_INPUT              — raw user message that triggered the agent
 *   AI_FLOW_CONTEXT            — JSON: project, issue, user metadata
 *   AI_FLOW_GITLAB_TOKEN       — token to call GitLab REST API
 *   AI_FLOW_AI_GATEWAY_TOKEN   — token to call Claude via GitLab AI proxy
 *
 * Optional (override for testing):
 *   WARDEN_POLICY              — JSON string of policy config
 *   WARDEN_DB_PATH             — SQLite db path (default: :memory:)
 *   GITLAB_PROJECT_ID          — override project ID
 *   GITLAB_ISSUE_IID           — override issue IID
 */

import { evaluate } from './policy/engine.js';
import { AuditLogger } from './audit/logger.js';
import { parseTransferRequest, parseGitLabContext } from './gitlab/parser.js';
import { postDecisionComment, postParseErrorComment } from './gitlab/commenter.js';

// ─── Environment ────────────────────────────────────────────────────────────

const RAW_INPUT = process.env.AI_FLOW_INPUT ?? process.env.WARDEN_TEST_INPUT ?? '';
const CONTEXT_JSON = process.env.AI_FLOW_CONTEXT ?? '{}';
const GITLAB_TOKEN = process.env.AI_FLOW_GITLAB_TOKEN ?? process.env.GITLAB_TOKEN;
const AI_GATEWAY_TOKEN = process.env.AI_FLOW_AI_GATEWAY_TOKEN;
const DB_PATH = process.env.WARDEN_DB_PATH ?? ':memory:';

let POLICY = {};
try {
  if (process.env.WARDEN_POLICY) {
    POLICY = JSON.parse(process.env.WARDEN_POLICY);
  }
} catch {
  console.error('[Warden] Warning: WARDEN_POLICY is not valid JSON, using defaults.');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const logger = new AuditLogger(DB_PATH);

  console.error('[Warden] Starting treasury evaluation...');
  console.error(`[Warden] Input: "${RAW_INPUT.slice(0, 100)}"`);

  // 1. Parse GitLab context
  const context = parseGitLabContext(CONTEXT_JSON);
  const projectId = process.env.GITLAB_PROJECT_ID ?? context.projectId;
  const issueIid = process.env.GITLAB_ISSUE_IID ?? context.issueIid;

  console.error(`[Warden] Context: project=${context.project}, issue=#${issueIid}, user=${context.user}`);

  // 2. Parse transfer request via Claude
  let request;
  try {
    request = await parseTransferRequest(RAW_INPUT, AI_GATEWAY_TOKEN);
    console.error(`[Warden] Parsed: ${JSON.stringify(request)}`);
  } catch (err) {
    console.error(`[Warden] Parse error: ${err.message}`);
    if (projectId && issueIid && GITLAB_TOKEN) {
      await postParseErrorComment({ projectId, issueIid, rawInput: RAW_INPUT, token: GITLAB_TOKEN });
    }
    process.exit(1);
  }

  // 3. Reject low-confidence extractions (ambiguous request)
  if (request.confidence < 0.4 || !request.recipient || !request.amount) {
    console.error(`[Warden] Low confidence (${request.confidence}) — requesting clarification`);
    if (projectId && issueIid && GITLAB_TOKEN) {
      await postParseErrorComment({ projectId, issueIid, rawInput: RAW_INPUT, token: GITLAB_TOKEN });
    } else {
      // Dry-run mode: output to stdout
      console.log(JSON.stringify({ status: 'ambiguous', request, context }));
    }
    process.exit(0);
  }

  // 4. Get current spending state from audit log
  const state = logger.getState();
  console.error(`[Warden] State: dailySpent=$${state.dailySpent}, hourlyTx=${state.hourlyTxCount}`);

  // 5. Evaluate policy
  const { decision, rule, reason } = evaluate(request, POLICY, state);
  console.error(`[Warden] Decision: ${decision} (${rule})`);

  // 6. Record to audit log
  const auditId = logger.record({ decision, rule, reason, request, context, state });

  // 7. Post decision to GitLab (or dry-run to stdout)
  if (projectId && issueIid && GITLAB_TOKEN) {
    await postDecisionComment({
      projectId,
      issueIid,
      decision,
      rule,
      reason,
      request,
      auditId,
      token: GITLAB_TOKEN,
    });
    console.error(`[Warden] Posted ${decision} comment to issue #${issueIid}`);
  } else {
    // Dry-run mode (local testing without GitLab)
    console.log(JSON.stringify({ decision, rule, reason, request, context, auditId }, null, 2));
  }

  logger.close();
  process.exit(0);
}

main().catch(err => {
  console.error(`[Warden] Fatal error: ${err.message}`);
  process.exit(1);
});
