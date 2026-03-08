/**
 * Warden GitLab Parser
 *
 * Calls Claude (via GitLab's AI gateway) to extract a structured transfer request
 * from a natural-language GitLab issue comment or description.
 *
 * GitLab injects:
 *   AI_FLOW_AI_GATEWAY_TOKEN  — bearer token for calling AI models
 *   AI_FLOW_CONTEXT           — JSON blob with issue/MR metadata
 *   AI_FLOW_INPUT             — the raw text that triggered the agent
 *
 * The AI gateway proxies to Anthropic Claude. This integration qualifies
 * Warden for the GitLab + Anthropic Grand Prize ($10K bonus track).
 */

const AI_GATEWAY_URL = 'https://cloud.gitlab.com/ai/v1/proxy/anthropic';
const MODEL = 'claude-claude-3-5-sonnet-20241022';

const EXTRACTION_PROMPT = `You are a treasury compliance assistant. Extract structured financial transfer details from the user's request.

Return ONLY a JSON object with these fields:
{
  "recipient": "<EVM or Solana address, or human name/label>",
  "amount": <number, USD equivalent if not specified>,
  "token": "<token symbol, default 'USD'>",
  "description": "<1-sentence purpose of the transfer>",
  "confidence": <0.0-1.0, how confident you are in the extraction>
}

Rules:
- If you cannot find a recipient, set recipient to null
- If you cannot find an amount, set amount to null
- confidence < 0.6 means the request is ambiguous
- Do NOT invent information. Only extract what is explicitly stated.
- Return raw JSON only. No markdown, no explanation.`;

/**
 * Parse a natural-language transfer request using Claude via GitLab AI gateway.
 *
 * @param {string} text — the raw user message
 * @param {string} gatewayToken — AI_FLOW_AI_GATEWAY_TOKEN from env
 * @returns {Promise<{recipient, amount, token, description, confidence, raw}>}
 */
export async function parseTransferRequest(text, gatewayToken) {
  if (!gatewayToken) {
    // Fallback: simple regex extraction for testing without gateway
    return parseWithRegex(text);
  }

  const response = await fetch(`${AI_GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${gatewayToken}`,
      'x-gitlab-instance-id': process.env.CI_SERVER_URL || 'local',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      system: EXTRACTION_PROMPT,
      messages: [
        { role: 'user', content: text },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI gateway error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text ?? '';

  try {
    const parsed = JSON.parse(content);
    return {
      recipient: parsed.recipient ?? null,
      amount: typeof parsed.amount === 'number' ? parsed.amount : null,
      token: parsed.token ?? 'USD',
      description: parsed.description ?? text.slice(0, 100),
      confidence: parsed.confidence ?? 0.5,
      raw: text,
      model: MODEL,
      via: 'gitlab-ai-gateway',
    };
  } catch {
    throw new Error(`Failed to parse Claude response: ${content}`);
  }
}

/**
 * Regex-based fallback parser (no AI gateway required).
 * Handles common patterns like "transfer 500 USDC to 0x1234..."
 */
export function parseWithRegex(text) {
  // Extract amount + optional token
  const amountMatch = text.match(/\$?(\d+(?:\.\d{1,2})?)\s*(USDC|USDT|ETH|SOL|USD|DAI)?/i);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;
  const token = amountMatch?.[2]?.toUpperCase() ?? 'USD';

  // Extract EVM address (0x...)
  const evmMatch = text.match(/0x[a-fA-F0-9]{40}/);
  // Extract Solana address (base58, ~44 chars)
  const solMatch = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  const recipient = evmMatch?.[0] ?? solMatch?.[0] ?? null;

  // Description: everything after "for" keyword
  const forMatch = text.match(/\bfor\b\s+(.{5,80})/i);
  const description = forMatch?.[1]?.trim() ?? text.slice(0, 100);

  return {
    recipient,
    amount,
    token,
    description,
    confidence: recipient && amount ? 0.75 : 0.3,
    raw: text,
    model: null,
    via: 'regex-fallback',
  };
}

/**
 * Parse the GitLab context blob injected via AI_FLOW_CONTEXT.
 * Returns a structured context object for logging and API calls.
 */
export function parseGitLabContext(contextJson) {
  if (!contextJson) return {};

  try {
    const ctx = typeof contextJson === 'string' ? JSON.parse(contextJson) : contextJson;
    return {
      project: ctx.project?.path_with_namespace ?? ctx.project?.id ?? 'unknown',
      projectId: ctx.project?.id,
      issueIid: ctx.issue?.iid ?? ctx.merge_request?.iid,
      issueTitle: ctx.issue?.title ?? ctx.merge_request?.title,
      user: ctx.user?.username ?? ctx.user?.name ?? 'unknown',
      userId: ctx.user?.id,
      commentId: ctx.note?.id,
      webUrl: ctx.issue?.web_url ?? ctx.merge_request?.web_url,
    };
  } catch {
    return { raw: contextJson };
  }
}
