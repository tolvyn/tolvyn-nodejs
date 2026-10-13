#!/usr/bin/env bash
# Pack the package, install THE TARBALL in a clean directory, and load it both
# ways with one real call through a local server.
#
# WHY THIS EXISTS (BE-487). tolvyn@1.0.10 shipped a package that loaded by
# NEITHER module system: every relative specifier in dist/esm lacked the `.js`
# Node's ESM resolver requires, and dist/cjs/index.js required the OPTIONAL peer
# @google/generative-ai unconditionally. `import { OpenAI } from 'tolvyn'` -- the
# first line of the published Node quickstart -- did not run.
#
# NOTHING CAUGHT IT, AND THE REASON IS THE POINT: `npm test` runs jest against
# the TypeScript sources, where resolution is the compiler's and the peer is
# present in devDependencies. The artefact that ships is the one thing the
# repository never loaded. So this script loads the artefact, from a directory
# that has nothing else in it.
#
# Run before every publish:  bash scripts/verify-pack.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm run build
TGZ="$(npm pack --silent | tail -1)"
echo "packed: $TGZ"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp "$TGZ" "$WORK/"
cd "$WORK"
printf '{"name":"verify-pack","private":true,"version":"1.0.0"}\n' > package.json
npm install --silent "./$TGZ"

cat > server.cjs <<'SRV'
const http = require('http');
const seen = [];
const srv = http.createServer((req, res) => {
  seen.push(Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-tolvyn'))));
  let b = ''; req.on('data', c => (b += c));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'cmpl-1', object: 'chat.completion', model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }));
  });
});
module.exports = { seen, srv };
SRV

# The six attribution headers are asserted too: a package that loads but sends
# no X-Tolvyn-* header is useless in a different way, and the guide's snippets
# depend on exactly these names.
WANT='x-tolvyn-team,x-tolvyn-service,x-tolvyn-feature,x-tolvyn-agent,x-tolvyn-user,x-tolvyn-end-customer'

cat > check.mjs <<'ESM'
import http from 'node:http';
import { OpenAI, Anthropic, Google, DeepSeek } from 'tolvyn';
if (![OpenAI, Anthropic, Google, DeepSeek].every(Boolean)) {
  console.error('FAIL: import did not provide all four clients'); process.exit(1);
}
const seen = [];
const srv = http.createServer((req, res) => {
  seen.push(Object.fromEntries(Object.entries(req.headers).filter(([k]) => k.startsWith('x-tolvyn'))));
  let b = ''; req.on('data', c => (b += c));
  req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'c', object: 'chat.completion', model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } })); });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const client = new OpenAI({
  tolvynApiKey: 'tlv_live_test',
  proxyUrl: `http://127.0.0.1:${srv.address().port}/v1/proxy/openai`,
  team: 't', service: 's', feature: 'f', user: 'u', endCustomer: 'e', agent: 'a',
});
const r = await client.chat.completions.create({
  model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5,
});
srv.close();
if (r.choices[0].message.content !== 'ok') { console.error('FAIL: no completion'); process.exit(1); }
const got = Object.keys(seen[0] || {}).sort().join(',');
const want = process.env.WANT.split(',').sort().join(',');
if (got !== want) { console.error(`FAIL: headers ${got} != ${want}`); process.exit(1); }
console.log('ok: import + call + all six attribution headers');
ESM

cat > check.cjs <<'CJS'
const { seen, srv } = require('./server.cjs');
const { OpenAI, Anthropic, Google, DeepSeek } = require('tolvyn');
if (![OpenAI, Anthropic, Google, DeepSeek].every(Boolean)) {
  console.error('FAIL: require did not provide all four clients'); process.exit(1);
}
srv.listen(0, '127.0.0.1', async () => {
  const client = new OpenAI({
    tolvynApiKey: 'tlv_live_test',
    proxyUrl: `http://127.0.0.1:${srv.address().port}/v1/proxy/openai`,
    team: 't', service: 's', feature: 'f', user: 'u', endCustomer: 'e', agent: 'a',
  });
  const r = await client.chat.completions.create({
    model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], max_tokens: 5,
  });
  srv.close();
  if (r.choices[0].message.content !== 'ok') { console.error('FAIL: no completion'); process.exit(1); }
  const got = Object.keys(seen[0] || {}).sort().join(',');
  const want = process.env.WANT.split(',').sort().join(',');
  if (got !== want) { console.error(`FAIL: headers ${got} != ${want}`); process.exit(1); }
  console.log('ok: require + call + all six attribution headers');
});
CJS

WANT="$WANT" node check.mjs
WANT="$WANT" node check.cjs
echo "verify-pack: BOTH module systems load the packed tarball and make a call"
