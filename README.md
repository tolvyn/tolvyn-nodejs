# tolvyn · npm

[![npm version](https://img.shields.io/npm/v/tolvyn.svg)](https://www.npmjs.com/package/tolvyn)

Drop-in replacement for `openai` and `@anthropic-ai/sdk`.
One line change. Every AI call metered, attributed, and governed.

## Install

```bash
npm install tolvyn
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

Works the same way for Anthropic:

```typescript
import { Anthropic } from "tolvyn";
const client = new Anthropic({ tolvynApiKey: "tlv_live_...", team: "ml", service: "classifier" });
```

CommonJS:

```javascript
const { OpenAI } = require("tolvyn");
const client = new OpenAI({ tolvynApiKey: process.env.TOLVYN_API_KEY, team: "backend" });
```

## What you get

- **Cost metering** — every request logged with exact token counts and cost in microdollars
- **Team attribution** — see spend by team and service, not just a total invoice number
- **Budget enforcement** — set hard limits that block requests before they hit your provider
- **Immutable ledger** — hash-chained audit trail, verifiable at any time
- **Drop-in** — no changes to your existing API calls, models, or response handling

Full docs: [docs.tolvyn.io/nodejs-sdk](https://docs.tolvyn.io/nodejs-sdk)
Free trial: [tolvyn.io](https://tolvyn.io)

---

© 2026 TOLVYN. All rights reserved.
