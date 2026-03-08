/**
 * Policy Engine Tests
 * 25 test cases covering all decision paths and edge cases.
 */

import { evaluate, Decision, DEFAULT_POLICY } from '../src/policy/engine.js';

const BASE_POLICY = {
  autoApproveLimit: 500,
  dailyLimit: 2000,
  maxTxPerHour: 5,
  blacklist: ['0xdead000000000000000000000000000000000000'],
  whitelist: ['0xabcd1234567890abcd1234567890abcd12345678'],
  whitelistMultiplier: 10,
};

const CLEAN_STATE = { dailySpent: 0, hourlyTxCount: 0 };

describe('Policy Engine — APPROVE paths', () => {
  test('approves transfer within auto-approve limit', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 100 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.APPROVE);
    expect(result.rule).toBe('within_policy');
  });

  test('approves transfer exactly at auto-approve limit', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 500 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.APPROVE);
  });

  test('approves whitelisted address above base limit (elevated effective limit)', () => {
    // Whitelist gives 10× base limit (500) = effective limit 5000.
    // Use 1500: above base limit (would ESCALATE unwhitelisted) but within daily cap ($2000).
    const result = evaluate(
      { recipient: '0xAbCd1234567890AbCd1234567890AbCd12345678', amount: 1500 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.APPROVE);
    expect(result.rule).toBe('within_policy');
  });

  test('approves 1 USDC micro-transfer', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 1, token: 'USDC' },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.APPROVE);
  });

  test('approves with partial daily spend remaining', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 200 },
      BASE_POLICY, { dailySpent: 1500, hourlyTxCount: 0 }
    );
    expect(result.decision).toBe(Decision.APPROVE);
  });

  test('uses default policy when none provided', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 50 },
    );
    expect(result.decision).toBe(Decision.APPROVE);
  });
});

describe('Policy Engine — REJECT paths', () => {
  test('rejects zero amount', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 0 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
    expect(result.rule).toBe('zero_value_guard');
  });

  test('rejects negative amount', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: -50 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
    expect(result.rule).toBe('zero_value_guard');
  });

  test('rejects null amount', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: null },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
  });

  test('rejects blacklisted recipient (exact match)', () => {
    const result = evaluate(
      { recipient: '0xDead000000000000000000000000000000000000', amount: 1 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
    expect(result.rule).toBe('blacklist');
  });

  test('rejects blacklisted recipient (case-insensitive)', () => {
    const result = evaluate(
      { recipient: '0XDEAD000000000000000000000000000000000000', amount: 1 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
    expect(result.rule).toBe('blacklist');
  });

  test('rejects missing recipient', () => {
    const result = evaluate(
      { recipient: null, amount: 100 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
    expect(result.rule).toBe('invalid_recipient');
  });

  test('rejects empty recipient string', () => {
    const result = evaluate(
      { recipient: '', amount: 100 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
  });

  test('rejects short/invalid recipient', () => {
    const result = evaluate(
      { recipient: '0x12', amount: 100 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.REJECT);
  });
});

describe('Policy Engine — ESCALATE paths', () => {
  test('escalates transfer above auto-approve limit', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 501 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.ESCALATE);
    expect(result.rule).toBe('per_tx_limit');
  });

  test('escalates whitelisted address above elevated limit', () => {
    const result = evaluate(
      { recipient: '0xAbCd1234567890AbCd1234567890AbCd12345678', amount: 5001 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.decision).toBe(Decision.ESCALATE);
    expect(result.rule).toBe('per_tx_limit');
  });

  test('escalates when daily cap would be exceeded', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 300 },
      BASE_POLICY, { dailySpent: 1800, hourlyTxCount: 0 }
    );
    expect(result.decision).toBe(Decision.ESCALATE);
    expect(result.rule).toBe('daily_cap');
  });

  test('escalates when daily spend exactly equals limit', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 1 },
      BASE_POLICY, { dailySpent: 2000, hourlyTxCount: 0 }
    );
    expect(result.decision).toBe(Decision.ESCALATE);
    expect(result.rule).toBe('daily_cap');
  });

  test('escalates when rate limit reached', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 10 },
      BASE_POLICY, { dailySpent: 0, hourlyTxCount: 5 }
    );
    expect(result.decision).toBe(Decision.ESCALATE);
    expect(result.rule).toBe('rate_limit');
  });
});

describe('Policy Engine — result shape', () => {
  test('every result has decision, rule, reason', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 100 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('rule');
    expect(result).toHaveProperty('reason');
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  test('reason is informative for escalation', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 9999 },
      BASE_POLICY, CLEAN_STATE
    );
    expect(result.reason).toContain('9999');
  });

  test('reason mentions daily limit when cap exceeded', () => {
    const result = evaluate(
      { recipient: '0x1234567890123456789012345678901234567890', amount: 300 },
      BASE_POLICY, { dailySpent: 1800, hourlyTxCount: 0 }
    );
    expect(result.reason).toContain('daily limit');
  });
});
