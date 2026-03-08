/**
 * Warden GitLab Commenter
 *
 * Posts Warden's APPROVE/REJECT/ESCALATE decisions back to GitLab
 * as issue/MR comments using the GitLab REST API.
 *
 * Uses AI_FLOW_GITLAB_TOKEN (injected by GitLab when the agent runs).
 */

const GITLAB_API_URL = process.env.CI_API_V4_URL || 'https://gitlab.com/api/v4';

const DECISION_EMOJI = {
  APPROVE: '✅',
  REJECT: '❌',
  ESCALATE: '⚠️',
};

const DECISION_COLOR_HEX = {
  APPROVE: '#28a745',
  REJECT: '#dc3545',
  ESCALATE: '#fd7e14',
};

/**
 * Post a Warden decision comment to a GitLab issue.
 *
 * @param {object} params
 * @param {number} params.projectId  — GitLab project ID
 * @param {number} params.issueIid   — Issue IID (not global ID)
 * @param {string} params.decision   — APPROVE | REJECT | ESCALATE
 * @param {string} params.rule       — Policy rule triggered
 * @param {string} params.reason     — Human-readable reason
 * @param {object} params.request    — Original parsed request
 * @param {number} params.auditId    — Audit log entry ID
 * @param {string} params.token      — AI_FLOW_GITLAB_TOKEN
 */
export async function postDecisionComment({
  projectId,
  issueIid,
  decision,
  rule,
  reason,
  request,
  auditId,
  token,
}) {
  const emoji = DECISION_EMOJI[decision] ?? '🔍';
  const body = formatDecisionComment({
    decision,
    emoji,
    rule,
    reason,
    request,
    auditId,
  });

  const url = `${GITLAB_API_URL}/projects/${projectId}/issues/${issueIid}/notes`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitLab API error ${response.status}: ${err}`);
  }

  return response.json();
}

/**
 * Format the decision comment body.
 * Uses GitLab Markdown for clean rendering.
 */
export function formatDecisionComment({ decision, emoji, rule, reason, request, auditId }) {
  const { recipient, amount, token = 'USD', description } = request ?? {};

  const header = `${emoji} **Warden Treasury Sentinel — ${decision}**`;

  const requestSection = [
    '**Transfer Request**',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Recipient | \`${recipient ?? 'not specified'}\` |`,
    `| Amount | ${amount != null ? `**${amount} ${token}**` : '_not specified_'} |`,
    `| Purpose | ${description ?? '_not specified_'} |`,
  ].join('\n');

  const decisionSection = [
    '**Decision**',
    `| | |`,
    `|-|-|`,
    `| Status | **${decision}** |`,
    `| Policy Rule | \`${rule}\` |`,
    `| Reason | ${reason} |`,
    `| Audit ID | \`#${auditId}\` |`,
  ].join('\n');

  const footer = decision === 'ESCALATE'
    ? `\n> **Action required:** A treasury admin must manually review and authorize this transfer before it proceeds.`
    : decision === 'REJECT'
    ? `\n> This transfer has been **permanently blocked** by policy. Contact a treasury admin if you believe this is an error.`
    : `\n> Transfer is within policy limits and has been logged. Execution may proceed.`;

  return [header, '', requestSection, '', decisionSection, footer, '', `---`, `*Powered by [Warden](https://github.com/helmutdeving/warden-gitlab) + Claude via GitLab AI Gateway*`].join('\n');
}

/**
 * Post a comment when parsing fails (ambiguous request).
 */
export async function postParseErrorComment({
  projectId,
  issueIid,
  rawInput,
  token,
}) {
  const body = [
    `🤔 **Warden Treasury Sentinel — Clarification Needed**`,
    '',
    `I couldn't extract a clear transfer request from your message.`,
    '',
    '**Please include:**',
    '- A recipient address (EVM: `0x...` or Solana: base58)',
    '- An amount and token (e.g., `500 USDC`, `0.5 ETH`)',
    '- A brief purpose (e.g., `for contractor payment`)',
    '',
    '**Example:**',
    '```',
    '@warden transfer 250 USDC to 0xAbCd...1234 for Q1 infrastructure costs',
    '```',
    '',
    `*Raw input received: "${rawInput?.slice(0, 200)}"*`,
  ].join('\n');

  const url = `${GITLAB_API_URL}/projects/${projectId}/issues/${issueIid}/notes`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GitLab API error ${response.status}: ${err}`);
  }

  return response.json();
}
