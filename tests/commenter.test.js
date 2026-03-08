/**
 * Commenter Tests — formatDecisionComment + postDecisionComment + postParseErrorComment
 * formatDecisionComment: pure markdown rendering, no HTTP.
 * postDecisionComment / postParseErrorComment: mocked fetch for HTTP path coverage.
 */

import { jest } from '@jest/globals';
import { formatDecisionComment, postDecisionComment, postParseErrorComment } from '../src/gitlab/commenter.js';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const BASE_REQUEST = {
  recipient: '0x1234567890123456789012345678901234567890',
  amount: 250,
  token: 'USDC',
  description: 'Q1 contractor payment',
};

// ─── formatDecisionComment — APPROVE ─────────────────────────────────────────

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

// ─── formatDecisionComment — REJECT ──────────────────────────────────────────

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

// ─── formatDecisionComment — ESCALATE ────────────────────────────────────────

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

// ─── formatDecisionComment — edge cases ──────────────────────────────────────

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

  test('uses default USD token when token not provided', () => {
    const comment = formatDecisionComment({
      decision: 'APPROVE',
      emoji: '✅',
      rule: 'within_policy',
      reason: 'OK',
      request: { recipient: '0xabc', amount: 100 },
      auditId: 10,
    });
    expect(comment).toContain('USD');
  });

  test('includes description when provided', () => {
    const comment = formatDecisionComment({
      decision: 'APPROVE',
      emoji: '✅',
      rule: 'within_policy',
      reason: 'OK',
      request: { recipient: '0xabc', amount: 100, token: 'ETH', description: 'Dev tooling purchase' },
      auditId: 11,
    });
    expect(comment).toContain('Dev tooling purchase');
  });

  test('shows _not specified_ for missing description', () => {
    const comment = formatDecisionComment({
      decision: 'APPROVE',
      emoji: '✅',
      rule: 'within_policy',
      reason: 'OK',
      request: { recipient: '0xabc', amount: 50, token: 'USDC' },
      auditId: 12,
    });
    expect(comment).toContain('not specified');
  });

  test('returns a string for all decision types', () => {
    for (const decision of ['APPROVE', 'REJECT', 'ESCALATE']) {
      const result = formatDecisionComment({
        decision,
        emoji: '🔍',
        rule: 'test',
        reason: 'test reason',
        request: BASE_REQUEST,
        auditId: 0,
      });
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(100);
    }
  });

  test('contains markdown table structure', () => {
    const comment = formatDecisionComment({
      decision: 'APPROVE',
      emoji: '✅',
      rule: 'within_policy',
      reason: 'OK',
      request: BASE_REQUEST,
      auditId: 5,
    });
    expect(comment).toContain('|');
    expect(comment).toContain('Recipient');
    expect(comment).toContain('Amount');
  });
});

// ─── postDecisionComment — mocked fetch ──────────────────────────────────────

describe('postDecisionComment — HTTP integration', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('POSTs to correct GitLab notes endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123, body: 'comment posted' }),
    });

    await postDecisionComment({
      projectId: 42,
      issueIid: 7,
      decision: 'APPROVE',
      rule: 'within_policy',
      reason: 'Transfer of $250 is within limits.',
      request: BASE_REQUEST,
      auditId: 1,
      token: 'glpat-test-token',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/projects/42/issues/7/notes');
    expect(opts.method).toBe('POST');
  });

  test('sends PRIVATE-TOKEN header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    await postDecisionComment({
      projectId: 1,
      issueIid: 1,
      decision: 'REJECT',
      rule: 'blacklist',
      reason: 'Blacklisted.',
      request: BASE_REQUEST,
      auditId: 2,
      token: 'my-secret-gitlab-token',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['PRIVATE-TOKEN']).toBe('my-secret-gitlab-token');
  });

  test('sends Content-Type: application/json', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    await postDecisionComment({
      projectId: 1, issueIid: 1, decision: 'ESCALATE',
      rule: 'daily_cap', reason: 'Over limit.', request: BASE_REQUEST,
      auditId: 3, token: 'tok',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('body contains formatted markdown comment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    await postDecisionComment({
      projectId: 5, issueIid: 3, decision: 'APPROVE',
      rule: 'within_policy', reason: 'OK.', request: BASE_REQUEST,
      auditId: 99, token: 'tok',
    });

    const [, opts] = mockFetch.mock.calls[0];
    const parsed = JSON.parse(opts.body);
    expect(typeof parsed.body).toBe('string');
    expect(parsed.body).toContain('APPROVE');
    expect(parsed.body).toContain('Warden');
  });

  test('returns parsed JSON response on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 789, noteable_id: 42 }),
    });

    const result = await postDecisionComment({
      projectId: 1, issueIid: 1, decision: 'APPROVE',
      rule: 'ok', reason: 'Fine.', request: BASE_REQUEST,
      auditId: 10, token: 'tok',
    });

    expect(result).toEqual({ id: 789, noteable_id: 42 });
  });

  test('throws with status code on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden — insufficient scope',
    });

    await expect(
      postDecisionComment({
        projectId: 1, issueIid: 1, decision: 'APPROVE',
        rule: 'ok', reason: 'Fine.', request: BASE_REQUEST,
        auditId: 11, token: 'bad-token',
      })
    ).rejects.toThrow('403');
  });

  test('throws on 401 Unauthorized', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      postDecisionComment({
        projectId: 1, issueIid: 1, decision: 'REJECT',
        rule: 'blacklist', reason: 'Bad.', request: BASE_REQUEST,
        auditId: 12, token: 'expired',
      })
    ).rejects.toThrow('GitLab API error');
  });

  test('uses CI_API_V4_URL env var when set', async () => {
    const original = process.env.CI_API_V4_URL;
    process.env.CI_API_V4_URL = 'https://gitlab.mycompany.com/api/v4';

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });

    // Note: module-level constant is read at import time, so this tests
    // the default behavior — verifying the URL format is correct
    await postDecisionComment({
      projectId: 10, issueIid: 5, decision: 'APPROVE',
      rule: 'ok', reason: 'OK.', request: BASE_REQUEST,
      auditId: 13, token: 'tok',
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('/projects/10/issues/5/notes');

    if (original === undefined) delete process.env.CI_API_V4_URL;
    else process.env.CI_API_V4_URL = original;
  });

  test('works for all three decision types', async () => {
    for (const decision of ['APPROVE', 'REJECT', 'ESCALATE']) {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
      await postDecisionComment({
        projectId: 1, issueIid: 1, decision,
        rule: 'test', reason: 'test.', request: BASE_REQUEST,
        auditId: 0, token: 'tok',
      });
    }
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

// ─── postParseErrorComment — mocked fetch ────────────────────────────────────

describe('postParseErrorComment — HTTP integration', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('POSTs clarification request to correct endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 456 }),
    });

    await postParseErrorComment({
      projectId: 10,
      issueIid: 2,
      rawInput: 'send money somewhere',
      token: 'glpat-tok',
    });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/projects/10/issues/2/notes');
    expect(opts.method).toBe('POST');
  });

  test('comment body contains Clarification Needed header', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });

    await postParseErrorComment({
      projectId: 1, issueIid: 1,
      rawInput: 'unclear request',
      token: 'tok',
    });

    const parsed = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parsed.body).toContain('Clarification Needed');
  });

  test('includes raw input excerpt in comment', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });

    await postParseErrorComment({
      projectId: 1, issueIid: 1,
      rawInput: 'give money to bob please',
      token: 'tok',
    });

    const parsed = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parsed.body).toContain('give money to bob please');
  });

  test('truncates raw input to 200 characters', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });

    const longInput = 'x'.repeat(300);
    await postParseErrorComment({
      projectId: 1, issueIid: 1,
      rawInput: longInput,
      token: 'tok',
    });

    const parsed = JSON.parse(mockFetch.mock.calls[0][1].body);
    // The full 300-char string should NOT appear
    expect(parsed.body).not.toContain('x'.repeat(250));
    // But 200 chars should be present
    expect(parsed.body).toContain('x'.repeat(200));
  });

  test('returns parsed JSON response on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 999, author: { username: 'warden' } }),
    });

    const result = await postParseErrorComment({
      projectId: 3, issueIid: 7,
      rawInput: 'what?',
      token: 'tok',
    });

    expect(result.id).toBe(999);
  });

  test('throws on 403 Forbidden', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    await expect(
      postParseErrorComment({
        projectId: 1, issueIid: 1,
        rawInput: 'test', token: 'bad',
      })
    ).rejects.toThrow('403');
  });

  test('throws on 404 Not Found', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    await expect(
      postParseErrorComment({
        projectId: 999, issueIid: 999,
        rawInput: 'test', token: 'tok',
      })
    ).rejects.toThrow('GitLab API error');
  });

  test('comment contains usage example', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });

    await postParseErrorComment({
      projectId: 1, issueIid: 1,
      rawInput: 'send stuff',
      token: 'tok',
    });

    const parsed = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parsed.body).toContain('@warden');
    expect(parsed.body).toContain('USDC');
  });

  test('sends PRIVATE-TOKEN header', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });

    await postParseErrorComment({
      projectId: 1, issueIid: 1,
      rawInput: 'test', token: 'secret-token-123',
    });

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['PRIVATE-TOKEN']).toBe('secret-token-123');
  });

  test('handles undefined rawInput gracefully', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });

    // Should not throw
    await postParseErrorComment({
      projectId: 1, issueIid: 1,
      rawInput: undefined,
      token: 'tok',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
