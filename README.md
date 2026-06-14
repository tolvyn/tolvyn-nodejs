# tolvyn

Drop-in replacement for `openai` and `@anthropic-ai/sdk`. One line change. Every AI call metered, attributed, and governed.

[![npm](https://img.shields.io/npm/v/tolvyn.svg)](https://www.npmjs.com/package/tolvyn)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**10,000 free requests forever. No credit card.**

## Install

```bash
npm install tolvyn
```

Node 18 or later required. Ships dual ESM/CJS builds. TypeScript types included.

Google support requires the optional peer dependency:

```bash
npm install tolvyn @google/generative-ai
```

## Quick start

```typescript
// Before
import OpenAI from "openai";
const client = new OpenAI();

// After — one line change
import { OpenAI } from "tolvyn";
const client = new OpenAI({
  tolvynApiKey: "tlv_live_...",
  team: "backend",
  service: "summariser",
});

// Everything else stays the same
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

CommonJS:

```javascript
const { OpenAI } = require("tolvyn");
const client = new OpenAI({ tolvynApiKey: process.env.TOLVYN_API_KEY, team: "backend" });
```

## All four providers

```typescript
import { OpenAI, Anthropic, Google, DeepSeek } from "tolvyn";

// OpenAI
const oai = new OpenAI({
  tolvynApiKey: "tlv_live_...",
  openAIApiKey: "sk-...",          // optional — enables fail-open fallback
});

// Anthropic
const anth = new Anthropic({
  tolvynApiKey: "tlv_live_...",
  anthropicApiKey: "sk-ant-...",   // optional — enables fail-open fallback
});

// Google (requires @google/generative-ai peer dep)
const goog = new Google({ tolvynApiKey: "tlv_live_..." });
const model = goog.getGenerativeModel({ model: "gemini-1.5-flash" });

// DeepSeek (OpenAI-compatible API)
const ds = new DeepSeek({
  tolvynApiKey: "tlv_live_...",
  deepSeekApiKey: "sk-...",        // optional — enables fail-open fallback
});
const dsResponse = await ds.chat.completions.create({
  model: "deepseek-chat",
  messages: [{ role: "user", content: "Hello" }],
});
```

## Attribution headers

Set any combination of these on construction; the SDK sends them as `X-Tolvyn-*` headers automatically:

```typescript
const client = new OpenAI({
  tolvynApiKey: "tlv_live_...",
  team:         "backend",
  service:      "invoice-summarizer",
  feature:      "summarize",
  agent:        "claude-code",
  user:         "alice@company.com",
  endCustomer:  "acme-corp",
});
```

The TOLVYN proxy strips all six headers before forwarding the request upstream — they never reach OpenAI/Anthropic/Google/DeepSeek.

## Fail-open behavior

If TOLVYN's proxy is unreachable, the SDK automatically retries the request directly against the provider (requires `openAIApiKey` / `anthropicApiKey` / `googleApiKey` / `deepSeekApiKey` to be set). Disable with `failOpen: false`.

Triggers on: connection refused, timeout, DNS failure, HTTP 503.
Does NOT trigger on: 4xx errors (auth failures, rate limits, bad requests).

Requests that fail open bypass the proxy and are not metered for that call.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `TOLVYN_API_KEY` | Yes (unless `tolvynApiKey` option is passed) | Your TOLVYN API key (`tlv_live_...`) |
| `OPENAI_API_KEY` | For fail-open | Fallback OpenAI key if proxy unreachable |
| `ANTHROPIC_API_KEY` | For fail-open | Fallback Anthropic key if proxy unreachable |
| `GOOGLE_API_KEY` | For fail-open | Reserved; Google fail-open is implemented in v1.0.6+ |
| `DEEPSEEK_API_KEY` | For fail-open | Fallback DeepSeek key if proxy unreachable (v1.0.9+) |
| `TOLVYN_PROXY_URL` | No | Override proxy URL |

## API keys

- Production keys start with `tlv_live_`
- Test keys start with `tlv_test_` (use these in CI / staging)
- Get your key at [app.tolvyn.io](https://app.tolvyn.io) → API Keys
- **Provider keys** (OpenAI / Anthropic / Google / DeepSeek) go in the dashboard under **Account → Provider Keys** — never in code. They are stored encrypted server-side.

## TypeScript

Fully typed. Import the option interfaces directly when you need them:

```typescript
import type {
  TolvynOpenAIOptions,
  TolvynAnthropicOptions,
  TolvynGoogleOptions,
  TolvynDeepSeekOptions,
} from "tolvyn";
```

## Changelog

[github.com/tolvyn/tolvyn-cli/releases](https://github.com/tolvyn/tolvyn-cli/releases)

## Links

- Docs: [docs.tolvyn.io/sdks/nodejs](https://docs.tolvyn.io/sdks/nodejs)
- Quickstart: [docs.tolvyn.io/getting-started/quickstart](https://docs.tolvyn.io/getting-started/quickstart)
- Dashboard: [app.tolvyn.io](https://app.tolvyn.io)
- Issues: [github.com/tolvyn/tolvyn-nodejs/issues](https://github.com/tolvyn/tolvyn-nodejs/issues)

## Feedback

[founder@tolvyn.io](mailto:founder@tolvyn.io) — we read every message.

---

© 2026 TOLVYN. MIT licensed.
