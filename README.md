# Warden Treasury Sentinel — GitLab Duo External Agent

> AI-powered treasury governance for GitLab projects. Evaluates financial transfer requests in issues using Claude, enforces configurable spending policies, and posts APPROVE/REJECT/ESCALATE decisions as comments.

[![CI](https://github.com/helmutdeving/warden-gitlab/actions/workflows/ci.yml/badge.svg)](https://github.com/helmutdeving/warden-gitlab/actions)
[![Tests](https://img.shields.io/badge/tests-58%20passing-brightgreen)](tests/)
[![GitLab Duo](https://img.shields.io/badge/GitLab%20Duo-External%20Agent-fc6d26)](https://docs.gitlab.com/user/duo_agent_platform/)
[![Anthropic](https://img.shields.io/badge/Powered%20by-Claude%20via%20GitLab%20AI%20Gateway-5A4AF4)](https://docs.gitlab.com/user/duo_agent_platform/agents/external/)

---

## What It Does

Warden is a GitLab Duo [external agent](https://docs.gitlab.com/user/duo_agent_platform/agents/external/) that brings AI-powered treasury governance to your GitLab workflow.

When a team member needs to approve a payment, they post a request in a GitLab issue:

```
@warden transfer 2500 USDC to 0x1234...abcd for Q1 infrastructure costs
```

Warden:
1. **Parses** the request using Claude (via GitLab's AI gateway) to extract recipient, amount, token, and purpose
2. **Evaluates** the request against your configurable spending policy
3. **Posts** an APPROVE / REJECT / ESCALATE decision as a GitLab comment, with full reasoning
4. **Logs** every decision to an append-only audit trail

No spreadsheets. No Slack threads. No manual approvals for routine payments. Just your policy, enforced automatically.

---

## Policy Engine

Five rule categories, evaluated in priority order:

| Priority | Rule | Behaviour |
|----------|------|-----------|
| 1 | **Zero-value guard** | Reject dust/zero transfers immediately |
| 2 | **Blacklist** | Hard reject — always blocked, no exceptions |
| 3 | **Per-tx limit** | Auto-approve ≤ `autoApproveLimit`; escalate above |
| 4 | **Whitelist multiplier** | Trusted addresses get `whitelistMultiplier`× the base limit |
| 5 | **Daily cap** | Escalate when 24h cumulative spend would exceed `dailyLimit` |
| 6 | **Rate limit** | Escalate when tx/hour exceeds `maxTxPerHour` |

All rules are stateless and composable. Policies are plain JavaScript objects.

### Example Policy

```js
{
  autoApproveLimit: 500,      // Auto-approve up to $500/tx
  dailyLimit: 5000,           // Max $5000 in 24 hours
  maxTxPerHour: 10,           // Max 10 transactions/hour
  whitelistMultiplier: 10,    // Trusted addresses: $5000/tx limit
  whitelist: ['0xPayroll...', '0xInfraProvider...'],
  blacklist: ['0xKnownExploit...'],
}
```

---

## Architecture

```
warden-gitlab/
├── .gitlab/duo/agents/warden.yaml   ← GitLab Duo agent config
├── Dockerfile                        ← node:22-slim (GitLab spins this)
├── src/
│   ├── index.js                      ← Main entrypoint (reads env, calls Claude, posts comment)
│   ├── policy/
│   │   └── engine.js                 ← Pure policy evaluator — no I/O
│   ├── audit/
│   │   └── logger.js                 ← Append-only SQLite audit log
│   └── gitlab/
│       ├── parser.js                 ← Claude extraction + regex fallback
│       ├── commenter.js              ← GitLab comment formatting + posting
└── tests/
    ├── policy.test.js                ← 25 tests
    ├── parser.test.js                ← 19 tests
    └── commenter.test.js             ← 14 tests
```

### How GitLab Duo External Agents Work

When a user mentions `@warden` in a GitLab issue:
1. GitLab spins up the Docker container defined in `warden.yaml`
2. Injects environment variables: `AI_FLOW_INPUT`, `AI_FLOW_CONTEXT`, `AI_FLOW_GITLAB_TOKEN`, `AI_FLOW_AI_GATEWAY_TOKEN`
3. Warden runs `src/index.js`, which:
   - Calls **Claude** via `AI_FLOW_AI_GATEWAY_TOKEN` to parse the natural-language request
   - Evaluates the structured request against the policy engine
   - Posts the decision back to the issue via `AI_FLOW_GITLAB_TOKEN`
4. Container exits

The Claude integration uses GitLab's AI gateway (`cloud.gitlab.com/ai/v1/proxy/anthropic`) — qualifying Warden for the **GitLab + Anthropic Grand Prize** track.

---

## Claude Integration (GitLab AI Gateway)

Warden calls Claude with a structured extraction prompt:

```js
// src/gitlab/parser.js
const response = await fetch('https://cloud.gitlab.com/ai/v1/proxy/anthropic/v1/messages', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${AI_FLOW_AI_GATEWAY_TOKEN}`,
    // ...
  },
  body: JSON.stringify({
    model: 'claude-claude-3-5-sonnet-20241022',
    system: EXTRACTION_PROMPT,
    messages: [{ role: 'user', content: issueText }],
  }),
});
```

Claude extracts `{ recipient, amount, token, description, confidence }` from natural language. The policy engine handles the rest.

If the AI gateway is unavailable (testing, CI), Warden falls back to a regex parser automatically — no breakage, graceful degradation.

---

## Running Locally

```bash
# Clone
git clone https://github.com/helmutdeving/warden-gitlab
cd warden-gitlab

# Install
npm install

# Run demo (6 policy scenarios, no GitLab required)
node src/demo.js

# Run tests
npm test
```

### Demo Output

```
╔══════════════════════════════════════════════════════════╗
║   Warden Treasury Sentinel — GitLab Duo Demo              ║
╚══════════════════════════════════════════════════════════╝

Policy: autoApprove=$500 | daily=$2000 | maxTx/hr=5

Scenario 1: Routine contractor payment (APPROVE)
→ APPROVE (rule: within_policy, audit #1)
  Transfer of $250 to 0x1234... is within policy limits.

Scenario 2: Whitelisted address — above daily cap (ESCALATE)
→ ESCALATE (rule: daily_cap, audit #2)
  This transfer would bring 24h total to $3250, exceeding daily limit of $2000.

Scenario 3: Large transfer — exceeds auto-approve (ESCALATE)
→ ESCALATE (rule: per_tx_limit, audit #3)
  Amount $750 exceeds auto-approve limit of $500.

Scenario 4: Blacklisted recipient (REJECT)
→ REJECT (rule: blacklist, audit #4)
  Recipient 0xDead... is on the blacklist.

Scenario 5: Daily cap exceeded (ESCALATE)
→ ESCALATE (rule: daily_cap, audit #5)
  This transfer would bring 24h total to $2200, exceeding daily limit of $2000.

Scenario 6: Zero-value guard (REJECT)
→ REJECT (rule: zero_value_guard, audit #6)
  Transfer amount must be greater than zero.

━━━ Audit Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  APPROVE:  1
  REJECT:   2
  ESCALATE: 3
```

### Simulate GitLab Agent Run (Dry Mode)

```bash
WARDEN_TEST_INPUT="transfer 250 USDC to 0x1234567890123456789012345678901234567890 for contractor" \
  node src/index.js
```

Output (dry-run — no `GITLAB_TOKEN` set):
```json
{
  "decision": "APPROVE",
  "rule": "within_policy",
  "reason": "Transfer of $250 to 0x1234... is within policy limits.",
  "request": { "recipient": "0x1234...", "amount": 250, "token": "USDC" },
  "auditId": 1
}
```

---

## GitLab Comment Format

When Warden approves a transfer:

```markdown
✅ **Warden Treasury Sentinel — APPROVE**

**Transfer Request**
| Field | Value |
|-------|-------|
| Recipient | `0x1234...abcd` |
| Amount | **250 USDC** |
| Purpose | Q1 infrastructure costs |

**Decision**
| | |
|-|-|
| Status | **APPROVE** |
| Policy Rule | `within_policy` |
| Reason | Transfer of $250 to 0x1234... is within policy limits (daily: $250/$5000, tx limit: $500). |
| Audit ID | `#42` |

> Transfer is within policy limits and has been logged. Execution may proceed.
```

---

## Tests

```
Tests: 58 passing

  Policy Engine — APPROVE paths      (6)
  Policy Engine — REJECT paths       (8)
  Policy Engine — ESCALATE paths     (5)
  Policy Engine — result shape       (3)
  parseWithRegex — amount extraction (5)
  parseWithRegex — recipient         (3)
  parseWithRegex — description       (2)
  parseWithRegex — confidence        (4)
  parseGitLabContext                 (4)
  formatDecisionComment — APPROVE    (9)
  formatDecisionComment — REJECT     (3)
  formatDecisionComment — ESCALATE   (3)
  formatDecisionComment — edge cases (3)
```

---

## Deploying to GitLab

1. Push this repo to GitLab (or mirror from GitHub)
2. Build and push the Docker image to your container registry:
   ```bash
   docker build -t registry.gitlab.com/your-org/warden-gitlab:latest .
   docker push registry.gitlab.com/your-org/warden-gitlab:latest
   ```
3. Update `image` in `.gitlab/duo/agents/warden.yaml` to your registry URL
4. Enable GitLab Duo Agent Platform in your project settings (requires Premium/Ultimate)
5. Set `WARDEN_POLICY` environment variable with your JSON policy config
6. Mention `@warden` in any issue to trigger the agent

---

## Real-World Use Cases

**DAOs & Web3 Teams**: Route all treasury transfers through Warden. Routine payroll auto-approves; large discretionary spends escalate to multisig or governance. Complete audit trail.

**AI Agent Frameworks**: Use Warden as the spending safety layer for autonomous agents. Any agent proposing a financial action goes through Warden's policy firewall first.

**DeFi Protocols**: Gate protocol-owned liquidity operations. Rate limits prevent runaway rebalancing. Blacklists block known exploit addresses.

**Open Source Projects**: Bounty payments, grant distributions, infrastructure costs — all in one transparent, auditable workflow inside GitLab.

---

## License

MIT — built by [helmutdev](https://github.com/helmutdeving) for the GitLab AI Hackathon 2026.
