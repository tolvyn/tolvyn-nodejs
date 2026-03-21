# tolvyn (Node.js / TypeScript SDK)

Drop-in replacement for the `openai` and `@anthropic-ai/sdk` packages. Add cost metering, team attribution, and budget enforcement to your AI calls in one line.

```bash
npm install tolvyn
```

---

## Quick Start

### OpenAI (ESM / TypeScript)

```typescript
// Before
import OpenAI from "openai";
const client = new OpenAI();

// After — one line change
import { OpenAI } from "tolvyn";
const client = new OpenAI({
  tolvynApiKey: "tlv_live_...",    // or set TOLVYN_API_KEY env var
  team: "backend",
  service: "summariser",
});

// Everything else stays the same
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

### OpenAI (CommonJS)

```javascript
const { OpenAI } = require("tolvyn");

const client = new OpenAI({
  tolvynApiKey: process.env.TOLVYN_API_KEY,
  team: "backend",
  service: "summariser",
});
```

### Anthropic (ESM / TypeScript)

```typescript
// Before
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

// After
import { Anthropic } from "tolvyn";
const client = new Anthropic({
  tolvynApiKey: "tlv_live_...",
  team: "ml-team",
  service: "classifier",
});

const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
```

---

## Classes

| Class              | Extends                       | Provider  |
|--------------------|-------------------------------|-----------|
| `tolvyn.OpenAI`    | `openai` OpenAI               | OpenAI    |
| `tolvyn.Anthropic` | `@anthropic-ai/sdk` Anthropic | Anthropic |

Both classes are strict drop-ins. Every method, event, and behaviour of the underlying SDK is preserved.

---

## Parameters

### `OpenAI` (`TolvynOpenAIOptions`)

Extends `openai.ClientOptions` (omitting `apiKey` and `baseURL`).

| Parameter      | Type                  | Default     | Description                                                                                               |
|----------------|-----------------------|-------------|-----------------------------------------------------------------------------------------------------------|
| `tolvynApiKey` | `string or undefined` | `undefined` | Your TOLVYN API key. Falls back to `TOLVYN_API_KEY` env var. Required.                                    |
| `proxyUrl`     | `string or undefined` | `undefined` | TOLVYN proxy URL. Falls back to `TOLVYN_PROXY_URL` env var, then `http://localhost:8081/v1/proxy/openai`. |
| `team`         | `string or undefined` | `undefined` | Team name for cost attribution. Sent as `X-Tolvyn-Team` header.                                           |
| `service`      | `string or undefined` | `undefined` | Service name. Sent as `X-Tolvyn-Service` header.                                                          |
| `feature`      | `string or undefined` | `undefined` | Feature name. Sent as `X-Tolvyn-Feature` header.                                                          |
| `agent`        | `string or undefined` | `undefined` | Agent name. Sent as `X-Tolvyn-Agent` header.                                                              |
| `failOpen`     | `boolean`             | `true`      | If `true` and the proxy is unreachable, retry directly against OpenAI using `openAIApiKey`.               |
| `openAIApiKey` | `string or undefined` | `undefined` | OpenAI key used only for fail-open fallback. Falls back to `OPENAI_API_KEY` env var.                      |
| `...rest`      |  any                  |     —       | All other `openai.ClientOptions` fields are forwarded to the underlying client.                           |

### `Anthropic` (`TolvynAnthropicOptions`)

Extends `@anthropic-ai/sdk` ClientOptions (omitting `apiKey` and `baseURL`).

| Parameter        | Type                  | Default     | Description                                                                                                  |
|------------------|-----------------------|-------------|--------------------------------------------------------------------------------------------------------------|
| `tolvynApiKey`   | `string or undefined` | `undefined` | Your TOLVYN API key. Falls back to `TOLVYN_API_KEY` env var. Required.                                       |
| `proxyUrl`       | `string or undefined` | `undefined` | TOLVYN proxy URL. Falls back to `TOLVYN_PROXY_URL` env var, then `http://localhost:8081/v1/proxy/anthropic`. |
| `team`           | `string or undefined` | `undefined` | Team name for cost attribution.                                                                              |
| `service`        | `string or undefined` | `undefined` | Service name.                                                                                                |
| `feature`        | `string or undefined` | `undefined` | Feature name.                                                                                                |
| `agent`          | `string or undefined` | `undefined` | Agent name.                                                                                                  |
| `failOpen`       | `boolean`             | `true`      | If `true` and the proxy is unreachable, retry directly against Anthropic.                                    |
| `anthropicApiKey`| `string or undefined` | `undefined` | Anthropic key used only for fail-open fallback. Falls back to `ANTHROPIC_API_KEY` env var.                   |
| `...rest`        |  any                  |      —      | All other Anthropic ClientOptions fields are forwarded.                                                      |

---

## Tagging

```typescript
const client = new OpenAI({
  tolvynApiKey: "tlv_live_...",
  team: "search-team",         // Maps to a team in TOLVYN → budget applies
  service: "semantic-search",  // Sub-component (e.g. microservice name)
  feature: "query-expansion",  // Feature within the service
  agent: "reranker-v2",        // Agent name for multi-agent pipelines
});
```

All four tags are optional and independent. They appear in `tolvyn tail` output, the dashboard, and usage breakdown endpoints.

---

## Fail-open behaviour

By default, `failOpen: true`. When the TOLVYN proxy is unreachable (connection refused, HTTP 503), the SDK retries the request directly against the AI provider using the fallback API key.

A proxy outage **never breaks your application**. Requests that bypass the proxy are not metered; they appear in the provider's billing but not in TOLVYN.

To hard-fail on proxy errors:

```typescript
const client = new OpenAI({ tolvynApiKey: "tlv_live_...", failOpen: false });
```

---

## Imports

### ESM

```typescript
import { OpenAI, Anthropic } from "tolvyn";
import type { TolvynOpenAIOptions, TolvynAnthropicOptions } from "tolvyn";
```

### CommonJS

```javascript
const { OpenAI, Anthropic } = require("tolvyn");
```

Both ESM (`dist/esm/`) and CJS (`dist/cjs/`) builds are included.

---

## Environment variables

| Variable            | Used by           | Description                          |
|---------------------|-------------------|--------------------------------------|
| `TOLVYN_API_KEY`    | All classes       | TOLVYN API key                       |
| `TOLVYN_PROXY_URL`  | All classes       | Proxy URL override                   |
| `OPENAI_API_KEY`    | OpenAI classes    | OpenAI key for fail-open fallback    |
| `ANTHROPIC_API_KEY` | Anthropic classes | Anthropic key for fail-open fallback |

---

## Requirements

- Node.js 18+
- `openai >= 4.0.0` (peer dependency)
- `@anthropic-ai/sdk >= 0.20.0` (peer dependency)
- TypeScript 5.0+ (if using TypeScript)
