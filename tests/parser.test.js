/**
 * Parser Tests — regex fallback (no AI gateway required)
 */

import { parseWithRegex, parseGitLabContext } from '../src/gitlab/parser.js';

describe('parseWithRegex — amount extraction', () => {
  test('extracts plain USD amount', () => {
    const r = parseWithRegex('transfer 500 to 0x1234567890123456789012345678901234567890');
    expect(r.amount).toBe(500);
    expect(r.token).toBe('USD');
  });

  test('extracts USDC amount', () => {
    const r = parseWithRegex('send 250 USDC to 0x1234567890123456789012345678901234567890');
    expect(r.amount).toBe(250);
    expect(r.token).toBe('USDC');
  });

  test('extracts USDT amount', () => {
    const r = parseWithRegex('transfer 1000 USDT to 0x1234567890123456789012345678901234567890');
    expect(r.amount).toBe(1000);
    expect(r.token).toBe('USDT');
  });

  test('extracts ETH amount', () => {
    const r = parseWithRegex('send 0.5 ETH to 0x1234567890123456789012345678901234567890');
    expect(r.amount).toBe(0.5);
    expect(r.token).toBe('ETH');
  });

  test('handles dollar sign prefix', () => {
    const r = parseWithRegex('transfer $100 to 0x1234567890123456789012345678901234567890');
    expect(r.amount).toBe(100);
  });
});

describe('parseWithRegex — recipient extraction', () => {
  test('extracts EVM address', () => {
    const r = parseWithRegex('send 100 to 0xAbCd1234567890AbCd1234567890AbCd12345678');
    expect(r.recipient).toBe('0xAbCd1234567890AbCd1234567890AbCd12345678');
  });

  test('extracts EVM address from complex sentence', () => {
    const r = parseWithRegex('please transfer 500 USDC to 0x1111111111111111111111111111111111111111 for Q1 costs');
    expect(r.recipient).toBe('0x1111111111111111111111111111111111111111');
  });

  test('returns null recipient when none found', () => {
    const r = parseWithRegex('just send some money somewhere');
    expect(r.recipient).toBeNull();
  });
});

describe('parseWithRegex — description extraction', () => {
  test('extracts purpose after "for"', () => {
    const r = parseWithRegex('transfer 100 USDC to 0x1234567890123456789012345678901234567890 for contractor payment');
    expect(r.description).toContain('contractor payment');
  });

  test('falls back to raw text when no "for" keyword', () => {
    const input = 'pay 50 USDC to 0x1234567890123456789012345678901234567890';
    const r = parseWithRegex(input);
    expect(r.description).toBeDefined();
    expect(typeof r.description).toBe('string');
  });
});

describe('parseWithRegex — confidence scoring', () => {
  test('high confidence when both recipient and amount present', () => {
    const r = parseWithRegex('send 100 USDC to 0x1234567890123456789012345678901234567890');
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('low confidence when neither recipient nor amount present', () => {
    const r = parseWithRegex('please help me send money');
    expect(r.confidence).toBeLessThan(0.5);
  });

  test('includes raw text in result', () => {
    const input = 'test input 123';
    const r = parseWithRegex(input);
    expect(r.raw).toBe(input);
  });

  test('via field is regex-fallback', () => {
    const r = parseWithRegex('send 100 to 0x1234567890123456789012345678901234567890');
    expect(r.via).toBe('regex-fallback');
  });
});

describe('parseGitLabContext', () => {
  test('parses full GitLab context JSON', () => {
    const ctx = JSON.stringify({
      project: { path_with_namespace: 'org/treasury', id: 42 },
      issue: { iid: 7, title: 'Q1 payments', web_url: 'https://gitlab.com/org/treasury/-/issues/7' },
      user: { username: 'alice', id: 99 },
    });
    const result = parseGitLabContext(ctx);
    expect(result.project).toBe('org/treasury');
    expect(result.projectId).toBe(42);
    expect(result.issueIid).toBe(7);
    expect(result.user).toBe('alice');
    expect(result.webUrl).toBe('https://gitlab.com/org/treasury/-/issues/7');
  });

  test('handles null context gracefully', () => {
    const result = parseGitLabContext(null);
    expect(result).toEqual({});
  });

  test('handles invalid JSON gracefully', () => {
    const result = parseGitLabContext('not json');
    expect(result).toBeDefined();
  });

  test('accepts parsed object directly', () => {
    const ctx = { project: { path_with_namespace: 'foo/bar' }, user: { username: 'bob' } };
    const result = parseGitLabContext(ctx);
    expect(result.project).toBe('foo/bar');
    expect(result.user).toBe('bob');
  });
});
