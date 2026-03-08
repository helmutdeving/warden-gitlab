/**
 * Commenter Tests — formatDecisionComment
 * No HTTP calls — tests the markdown rendering only.
 */

import { formatDecisionComment } from '../src/gitlab/commenter.js';

const BASE_REQUEST = {
  recipient: '0x1234567890123456789012345678901234567890',
  amount: 250,
  token: 'USDC',
  description: 'Q1 contractor payment',
};

describe('formatDecisionComment — APPROVE', () => {
  const comment = formatDecisionComment({
    decision: 'APPROVE',
    emoji: '✅',
    rule: 'within_policy',
    reason: 'Transfer of $250 is within limits.',
    request: BASE_REQUEST,
    auditId: 42,
  });

  test('contains APPROVE in header', () => {
    expect(comment).toContain('APPROVE');
  });

  test('contains checkmark emoji', () => {
    expect(comment).toContain('✅');
  });

  test('contains recipient address', () => {
    expect(comment).toContain('0x1234567890123456789012345678901234567890');
  });

  test('contains amount and token', () => {
    expect(comment).toContain('250');
    expect(comment).toContain('USDC');
  });

  test('contains rule name', () => {
    expect(comment).toContain('within_policy');
  });

  test('contains audit ID', () => {
    expect(comment).toContain('42');
  });

  test('contains reason text', () => {
    expect(comment).toContain('within limits');
  });

  test('contains Warden attribution link', () => {
    expect(comment).toContain('helmutdeving/warden-gitlab');
  });

  test('contains execution-may-proceed note', () => {
    expect(comment).toContain('Execution may proceed');
  });
});

describe('formatDecisionComment — REJECT', () => {
  const comment = formatDecisionComment({
    decision: 'REJECT',
    emoji: '❌',
    rule: 'blacklist',
    reason: 'Recipient is blacklisted.',
    request: BASE_REQUEST,
    auditId: 7,
  });

  test('contains REJECT in header', () => {
    expect(comment).toContain('REJECT');
  });

  test('contains blocked note', () => {
    expect(comment).toContain('blocked');
  });

  test('contains blacklist rule', () => {
    expect(comment).toContain('blacklist');
  });
});

describe('formatDecisionComment — ESCALATE', () => {
  const comment = formatDecisionComment({
    decision: 'ESCALATE',
    emoji: '⚠️',
    rule: 'per_tx_limit',
    reason: 'Amount $5000 exceeds auto-approve limit.',
    request: BASE_REQUEST,
    auditId: 99,
  });

  test('contains ESCALATE in header', () => {
    expect(comment).toContain('ESCALATE');
  });

  test('contains action-required message', () => {
    expect(comment).toContain('Action required');
  });

  test('contains human review note', () => {
    expect(comment).toContain('admin');
  });
});

describe('formatDecisionComment — edge cases', () => {
  test('handles null recipient gracefully', () => {
    const comment = formatDecisionComment({
      decision: 'REJECT',
      emoji: '❌',
      rule: 'invalid_recipient',
      reason: 'No valid recipient.',
      request: { recipient: null, amount: 100, token: 'USD' },
      auditId: 1,
    });
    expect(comment).toContain('not specified');
  });

  test('handles null amount gracefully', () => {
    const comment = formatDecisionComment({
      decision: 'REJECT',
      emoji: '❌',
      rule: 'zero_value_guard',
      reason: 'Zero amount.',
      request: { recipient: '0x1234...', amount: null, token: 'USD' },
      auditId: 2,
    });
    expect(comment).toContain('not specified');
  });

  test('handles empty request gracefully', () => {
    const comment = formatDecisionComment({
      decision: 'REJECT',
      emoji: '❌',
      rule: 'invalid_recipient',
      reason: 'Bad request.',
      request: {},
      auditId: 3,
    });
    expect(typeof comment).toBe('string');
    expect(comment.length).toBeGreaterThan(50);
  });
});
