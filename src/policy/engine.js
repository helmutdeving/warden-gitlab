/**
 * Warden Policy Engine
 * Pure function evaluator — no I/O, no side effects.
 * Evaluates a transfer request against a policy configuration.
 *
 * Decisions:
 *   APPROVE   — within all policy limits, safe to execute
 *   REJECT    — hard violation (blacklist, zero amount, etc.)
 *   ESCALATE  — outside safe thresholds, requires human confirmation
 */

export const Decision = Object.freeze({
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  ESCALATE: 'ESCALATE',
});

/**
 * Default policy — conservative treasury defaults.
 * Override by passing a policy object to evaluate().
 */
export const DEFAULT_POLICY = {
  autoApproveLimit: 100,        // Auto-approve transfers up to this USD amount
  dailyLimit: 1000,              // Escalate if 24h total would exceed this
  maxTxPerHour: 10,              // Escalate if tx rate exceeds this
  whitelistMultiplier: 10,       // Trusted addresses get N× the base limit
  blacklist: [],                 // Always-reject recipients
  whitelist: [],                 // Trusted recipients (elevated limit)
  currency: 'USD',
};

/**
 * Evaluate a transfer request against policy.
 *
 * @param {object} request   — { recipient, amount, token, description }
 * @param {object} policy    — policy config (merged with DEFAULT_POLICY)
 * @param {object} state     — { dailySpent, hourlyTxCount }
 * @returns {{ decision, rule, reason }}
 */
export function evaluate(request, policy = {}, state = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  const { recipient, amount, description = '' } = request;
  const { dailySpent = 0, hourlyTxCount = 0 } = state;

  // 1. Zero/negative amount guard
  if (!amount || amount <= 0) {
    return {
      decision: Decision.REJECT,
      rule: 'zero_value_guard',
      reason: 'Transfer amount must be greater than zero.',
    };
  }

  // 2. Blacklist check
  const normalizedRecipient = (recipient || '').toLowerCase().trim();
  if (p.blacklist.some(addr => addr.toLowerCase() === normalizedRecipient)) {
    return {
      decision: Decision.REJECT,
      rule: 'blacklist',
      reason: `Recipient ${recipient} is on the blacklist. Transfer blocked unconditionally.`,
    };
  }

  // 3. Missing recipient
  if (!recipient || recipient.trim().length < 5) {
    return {
      decision: Decision.REJECT,
      rule: 'invalid_recipient',
      reason: 'No valid recipient address provided.',
    };
  }

  // 4. Determine effective limit for this recipient
  const isWhitelisted = p.whitelist.some(
    addr => addr.toLowerCase() === normalizedRecipient
  );
  const effectiveLimit = isWhitelisted
    ? p.autoApproveLimit * p.whitelistMultiplier
    : p.autoApproveLimit;

  // 5. Per-transaction limit
  if (amount > effectiveLimit) {
    return {
      decision: Decision.ESCALATE,
      rule: 'per_tx_limit',
      reason: `Amount $${amount} exceeds ${isWhitelisted ? 'whitelisted ' : ''}auto-approve limit of $${effectiveLimit}. Human confirmation required.`,
    };
  }

  // 6. Daily cap check
  if (dailySpent + amount > p.dailyLimit) {
    return {
      decision: Decision.ESCALATE,
      rule: 'daily_cap',
      reason: `This transfer would bring 24h total to $${dailySpent + amount}, exceeding daily limit of $${p.dailyLimit}. Human confirmation required.`,
    };
  }

  // 7. Rate limit check
  if (hourlyTxCount >= p.maxTxPerHour) {
    return {
      decision: Decision.ESCALATE,
      rule: 'rate_limit',
      reason: `Transaction rate limit reached (${hourlyTxCount}/${p.maxTxPerHour} per hour). Human confirmation required.`,
    };
  }

  // 8. All checks passed → APPROVE
  return {
    decision: Decision.APPROVE,
    rule: 'within_policy',
    reason: `Transfer of $${amount} to ${recipient} is within policy limits (daily: $${dailySpent + amount}/$${p.dailyLimit}, tx limit: $${effectiveLimit}).`,
  };
}

/**
 * Summarize a policy config for display.
 */
export function summarizePolicy(policy = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  return {
    autoApproveLimit: p.autoApproveLimit,
    dailyLimit: p.dailyLimit,
    maxTxPerHour: p.maxTxPerHour,
    whitelistedAddresses: p.whitelist.length,
    blacklistedAddresses: p.blacklist.length,
  };
}
