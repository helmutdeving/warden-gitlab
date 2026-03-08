/**
 * Parser Gateway Tests — Claude AI gateway integration
 *
 * Tests the parseTransferRequest function in gateway mode (AI_FLOW_AI_GATEWAY_TOKEN
 * provided). fetch is mocked to avoid real network calls, allowing us to verify:
 *   - Correct Claude API request format (model, system prompt, messages)
 *   - Successful extraction from Claude response
 *   - Error propagation on HTTP failures
 *   - Graceful handling of malformed Claude responses
 *   - No-token fallback to regex parser
 */

import { jest } from '@jest/globals';
import { parseTransferRequest } from '../src/gitlab/parser.js';

const FAKE_TOKEN = 'glpat-test-token-abc123';

// Minimal successful Claude response payload
function claudeResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
      model: 'claude-3-5-sonnet-20241022',
    }),
    text: async () => text,
  };
}

// Non-OK HTTP response (gateway error)
function errorResponse(status, body) {
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => { throw new Error('not JSON'); },
  };
}

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

// ──────────────────────────────────────────────────────────────────────────────
// No-token fallback
// ──────────────────────────────────────────────────────────────────────────────

describe('parseTransferRequest — no-token fallback', () => {
  test('uses regex fallback when gateway token is null', async () => {
    const result = await parseTransferRequest(
      'transfer 500 USDC to 0x1234567890123456789012345678901234567890',
      null,
    );
    expect(result.via).toBe('regex-fallback');
    expect(result.amount).toBe(500);
    expect(result.token).toBe('USDC');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('uses regex fallback when gateway token is undefined', async () => {
    const result = await parseTransferRequest(
      'send 100 ETH to 0xAbCd1234567890AbCd1234567890AbCd12345678',
      undefined,
    );
    expect(result.via).toBe('regex-fallback');
    expect(result.model).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('uses regex fallback when gateway token is empty string', async () => {
    const result = await parseTransferRequest('pay 50 USD to bob', '');
    expect(result.via).toBe('regex-fallback');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Successful Claude gateway responses
// ──────────────────────────────────────────────────────────────────────────────

describe('parseTransferRequest — gateway success', () => {
  test('extracts transfer details from Claude JSON response', async () => {
    const claudeJson = JSON.stringify({
      recipient: '0x1234567890123456789012345678901234567890',
      amount: 1500,
      token: 'USDC',
      description: 'Q1 contractor payment to Alice',
      confidence: 0.95,
    });
    global.fetch.mockResolvedValue(claudeResponse(claudeJson));

    const result = await parseTransferRequest(
      'please transfer 1500 USDC to 0x1234567890123456789012345678901234567890 for Q1 contractor payment to Alice',
      FAKE_TOKEN,
    );

    expect(result.via).toBe('gitlab-ai-gateway');
    expect(result.recipient).toBe('0x1234567890123456789012345678901234567890');
    expect(result.amount).toBe(1500);
    expect(result.token).toBe('USDC');
    expect(result.description).toContain('Q1 contractor payment');
    expect(result.confidence).toBe(0.95);
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.raw).toContain('1500 USDC');
  });

  test('calls fetch with correct GitLab AI gateway URL and headers', async () => {
    const claudeJson = JSON.stringify({
      recipient: null, amount: 200, token: 'USD',
      description: 'test', confidence: 0.8,
    });
    global.fetch.mockResolvedValue(claudeResponse(claudeJson));

    await parseTransferRequest('pay 200 for server costs', FAKE_TOKEN);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('cloud.gitlab.com/ai/v1/proxy/anthropic');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('sends correct model name in request body', async () => {
    const claudeJson = JSON.stringify({
      recipient: null, amount: 100, token: 'USD',
      description: 'test', confidence: 0.7,
    });
    global.fetch.mockResolvedValue(claudeResponse(claudeJson));

    await parseTransferRequest('pay 100 for something', FAKE_TOKEN);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe('claude-3-5-sonnet-20241022');
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toBe('pay 100 for something');
  });

  test('defaults token to USD when Claude omits it', async () => {
    const claudeJson = JSON.stringify({
      recipient: '0xDEAD000000000000000000000000000000000001',
      amount: 75,
      description: 'tool license',
      confidence: 0.88,
    });
    global.fetch.mockResolvedValue(claudeResponse(claudeJson));

    const result = await parseTransferRequest('pay 75 to 0xDEAD000000000000000000000000000000000001', FAKE_TOKEN);
    expect(result.token).toBe('USD');
  });

  test('defaults confidence to 0.5 when Claude omits it', async () => {
    const claudeJson = JSON.stringify({
      recipient: null, amount: 300, token: 'ETH', description: 'test',
    });
    global.fetch.mockResolvedValue(claudeResponse(claudeJson));

    const result = await parseTransferRequest('send 300 ETH somewhere', FAKE_TOKEN);
    expect(result.confidence).toBe(0.5);
  });

  test('sets amount to null when Claude returns non-numeric amount', async () => {
    const claudeJson = JSON.stringify({
      recipient: '0x1234567890123456789012345678901234567890',
      amount: 'unknown',
      token: 'USDC',
      description: 'unclear amount',
      confidence: 0.4,
    });
    global.fetch.mockResolvedValue(claudeResponse(claudeJson));

    const result = await parseTransferRequest('send some USDC to 0x1234567890123456789012345678901234567890', FAKE_TOKEN);
    expect(result.amount).toBeNull();
  });

  test('falls back to raw text for description when Claude omits it', async () => {
    const claudeJson = JSON.stringify({
      recipient: '0x1234567890123456789012345678901234567890',
      amount: 50,
      token: 'USD',
      confidence: 0.9,
    });
    global.fetch.mockResolvedValue(claudeResponse(claudeJson));

    const input = 'quick payment to team member';
    const result = await parseTransferRequest(input, FAKE_TOKEN);
    expect(result.description).toBeTruthy();
    expect(typeof result.description).toBe('string');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Gateway error handling
// ──────────────────────────────────────────────────────────────────────────────

describe('parseTransferRequest — gateway errors', () => {
  test('throws on HTTP 401 Unauthorized', async () => {
    global.fetch.mockResolvedValue(errorResponse(401, 'Unauthorized'));

    await expect(
      parseTransferRequest('pay 100 to bob', FAKE_TOKEN),
    ).rejects.toThrow('AI gateway error 401');
  });

  test('throws on HTTP 429 Rate Limited', async () => {
    global.fetch.mockResolvedValue(errorResponse(429, 'Too Many Requests'));

    await expect(
      parseTransferRequest('pay 200 to alice', FAKE_TOKEN),
    ).rejects.toThrow('AI gateway error 429');
  });

  test('throws on HTTP 500 Server Error', async () => {
    global.fetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

    await expect(
      parseTransferRequest('transfer 500 to contractor', FAKE_TOKEN),
    ).rejects.toThrow('AI gateway error 500');
  });

  test('error message includes HTTP status code', async () => {
    global.fetch.mockResolvedValue(errorResponse(403, 'Forbidden'));

    try {
      await parseTransferRequest('pay something', FAKE_TOKEN);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).toMatch(/403/);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Malformed Claude response handling
// ──────────────────────────────────────────────────────────────────────────────

describe('parseTransferRequest — malformed Claude responses', () => {
  test('throws when Claude returns non-JSON text', async () => {
    global.fetch.mockResolvedValue(claudeResponse('Sorry, I cannot process this request.'));

    await expect(
      parseTransferRequest('pay 100', FAKE_TOKEN),
    ).rejects.toThrow('Failed to parse Claude response');
  });

  test('throws when Claude returns markdown-wrapped JSON', async () => {
    // Claude sometimes wraps in code fences despite instructions — should fail gracefully
    const markdown = '```json\n{"recipient": null, "amount": 100}\n```';
    global.fetch.mockResolvedValue(claudeResponse(markdown));

    await expect(
      parseTransferRequest('pay 100 for testing', FAKE_TOKEN),
    ).rejects.toThrow('Failed to parse Claude response');
  });

  test('handles missing content array in Claude response', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [] }),  // empty content array
      text: async () => '',
    });

    // Empty content → empty string → JSON.parse('') throws
    await expect(
      parseTransferRequest('pay 100', FAKE_TOKEN),
    ).rejects.toThrow('Failed to parse Claude response');
  });
});
