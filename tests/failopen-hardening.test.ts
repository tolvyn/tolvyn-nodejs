/**
 * Fail-open hardening (BE-507..BE-515): fail open ONLY when the proxy was never
 * reached, or answered 503 with X-Tolvyn-Unavailable: 1; never forward any
 * X-Tolvyn-* header to the provider; replay the request intact; discard the 503.
 *
 * Real sockets: a stand-in provider that records every request, and stand-in
 * proxies that refuse, answer 503 (marked or not), enforce (451/429), or forward
 * and then hang or reset — the cases where a direct retry would be a second,
 * unmetered provider call.
 */
import * as http from 'node:http';
import * as net from 'node:net';
import { AddressInfo } from 'node:net';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { isProxyError, makeFailOpenFetch } from '../src/failopen';
import { Google } from '../src/google';

type Rec = { via: string; method: string; path: string; headers: http.IncomingHttpHeaders; body: string };
const providerSeen: Rec[] = [];
const servers: Array<http.Server | net.Server> = [];
const port: Record<string, number> = {};

function listen(s: http.Server | net.Server): Promise<number> {
  servers.push(s);
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b));
  });
}

// Forward to the provider as the real proxy would, then return the outcome.
async function forward(req: http.IncomingMessage, body: string): Promise<void> {
  await fetch(`http://127.0.0.1:${port.provider}${req.url}`, {
    method: req.method,
    headers: { 'content-type': 'application/json', 'x-via': 'proxy' },
    body,
  });
}

beforeAll(async () => {
  port.provider = await listen(http.createServer(async (req, res) => {
    const body = await readBody(req);
    providerSeen.push({ via: String(req.headers['x-via'] ?? 'direct'), method: req.method!, path: req.url!, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  }));
  const status = (code: number, extra: Record<string, string> = {}) =>
    http.createServer(async (req, res) => {
      await readBody(req);
      res.writeHead(code, { 'content-type': 'application/json', ...extra });
      res.end('{"error":"stand-in"}');
    });
  port['503'] = await listen(status(503));
  port['503-tolvyn'] = await listen(status(503, { 'X-Tolvyn-Unavailable': '1' }));
  port['451'] = await listen(status(451));
  port['429'] = await listen(status(429));
  port.timeout = await listen(http.createServer(async (req) => {
    await forward(req, await readBody(req)); // forwarded, then never answers
  }));
  port.reset = await listen(http.createServer(async (req) => {
    await forward(req, await readBody(req));
    req.socket.resetAndDestroy();
  }));
  // A port that refuses: bind, note it, close.
  const tmp = net.createServer();
  port.refused = await new Promise((r) => tmp.listen(0, '127.0.0.1', () => r((tmp.address() as AddressInfo).port)));
  await new Promise((r) => tmp.close(r));
});

afterAll(async () => {
  for (const s of servers) {
    (s as http.Server).closeAllConnections?.();
    await new Promise((r) => s.close(r));
  }
});

beforeEach(() => {
  providerSeen.length = 0;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const PROVIDERS: Array<[string, string, string]> = [
  // [provider, proxy path, direct base]
  ['openai', '/v1/proxy/openai/chat/completions', '/v1'],
  ['anthropic', '/v1/proxy/anthropic/v1/messages', ''],
  ['deepseek', '/v1/proxy/deepseek/chat/completions', '/v1'],
];
const BODY = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
const ATTR = {
  'X-Tolvyn-Team': 't-team',
  'X-Tolvyn-User': 'pii-user@example.com',
  'x-tolvyn-end-customer': 'pii-customer-42',
  'X-TOLVYN-FEATURE': 't-feature',
};

async function call(provider: string, path: string, base: string, mode: string, asRequest: boolean) {
  const fo = makeFailOpenFetch('sk-direct', `http://127.0.0.1:${port.provider}${base}`, provider);
  const url = `http://127.0.0.1:${port[mode]}${path}`;
  const headers = { 'content-type': 'application/json', authorization: 'Bearer tlv_x', 'x-api-key': 'tlv_x', ...ATTR };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = asRequest
      ? await fo(new Request(url, { method: 'POST', headers, body: BODY, signal: ctl.signal }))
      : await fo(url, { method: 'POST', headers, body: BODY, signal: ctl.signal });
    return { status: res.status };
  } catch (e) {
    return { error: e };
  } finally {
    clearTimeout(t);
  }
}

describe.each(PROVIDERS)('%s', (provider, path, base) => {
  describe.each([false, true])('Request input = %s', (asRequest) => {
    test.each(['refused', '503-tolvyn'])('fails open on %s, with no X-Tolvyn-* and the body intact', async (mode) => {
      const out = await call(provider, path, base, mode, asRequest);
      expect(out.status).toBe(200);
      const direct = providerSeen.filter((r) => r.via === 'direct');
      expect(direct).toHaveLength(1);
      const d = direct[0];
      expect(Object.keys(d.headers).filter((h) => h.startsWith('x-tolvyn-'))).toEqual([]);
      expect(JSON.stringify(d.headers)).not.toContain('pii-');
      expect(JSON.stringify(d.headers)).not.toContain('tlv_');
      expect(d.headers.host).toBe(`127.0.0.1:${port.provider}`);
      expect(d.method).toBe('POST');
      expect(d.body).toBe(BODY);
      expect(d.headers['content-type']).toBe('application/json');
      expect(d.path).toBe(path.replace(/^\/v1\/proxy\/[a-z]+/, base));
    });

    test.each(['503', '451', '429'])('does NOT fail open on %s (provider 503 / enforcement)', async (mode) => {
      const out = await call(provider, path, base, mode, asRequest);
      expect(out.status).toBe(Number(mode));
      expect(providerSeen).toHaveLength(0);
    });

    test.each(['timeout', 'reset'])('does NOT fail open on %s after the proxy forwarded (no duplicate)', async (mode) => {
      const out = await call(provider, path, base, mode, asRequest);
      expect(out.error).toBeDefined();
      expect(providerSeen.filter((r) => r.via === 'direct')).toHaveLength(0);
      expect(providerSeen.filter((r) => r.via === 'proxy')).toHaveLength(1);
    });
  });
});

test('the discarded marked 503 is cancelled before going direct', async () => {
  const seen: Response[] = [];
  const realFetch = globalThis.fetch;
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const r = await realFetch(input as RequestInfo, init);
    seen.push(r);
    return r;
  });
  const fo = makeFailOpenFetch('sk-direct', `http://127.0.0.1:${port.provider}/v1`, 'openai');
  await fo(`http://127.0.0.1:${port['503-tolvyn']}/v1/proxy/openai/chat/completions`, { method: 'POST', body: BODY });
  expect(seen[0].status).toBe(503);
  expect(seen[0].body?.locked || seen[0].bodyUsed).toBeTruthy();
});

test('an unreplayable streamed body never fails open', async () => {
  const fo = makeFailOpenFetch('sk-direct', `http://127.0.0.1:${port.provider}/v1`, 'openai');
  const stream = new Blob([BODY]).stream();
  await expect(
    fo(`http://127.0.0.1:${port.refused}/v1/proxy/openai/chat/completions`, {
      method: 'POST', body: stream, duplex: 'half',
    } as RequestInit),
  ).rejects.toThrow();
  expect(providerSeen).toHaveLength(0);
});

// Node's fetch shape: TypeError('fetch failed') with the socket error as `cause`.
const wrapped = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

describe('isProxyError is connect-phase only', () => {
  test.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED'])(
    '%s → true (also when wrapped as a cause)', (code) => {
      expect(isProxyError({ code })).toBe(true);
      expect(isProxyError(wrapped(code))).toBe(true);
    });
  test.each(['ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ERR_INVALID_ARG_TYPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_INVALID_URL'])(
    '%s → false', (code) => {
      expect(isProxyError({ code })).toBe(false);
      expect(isProxyError(wrapped(code))).toBe(false);
    });
  test('ETIMEDOUT counts only while connecting', () => {
    expect(isProxyError({ code: 'ETIMEDOUT', syscall: 'connect' })).toBe(true);
    expect(isProxyError({ code: 'ETIMEDOUT', syscall: 'read' })).toBe(false);
  });
  test('a bare "fetch failed" message or a 503 status is not enough', () => {
    expect(isProxyError(new TypeError('fetch failed'))).toBe(false);
    expect(isProxyError({ status: 503 })).toBe(false);
  });
});

describe('Google (real @google/generative-ai over sockets)', () => {
  // The direct client targets the real Google host; send it to the stand-in.
  function redirectGoogle() {
    const realFetch = globalThis.fetch;
    jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const u = String(input instanceof Request ? input.url : input)
        .replace('https://generativelanguage.googleapis.com', `http://127.0.0.1:${port.provider}`);
      return realFetch(u, init);
    });
  }
  function model(mode: string) {
    const g = new Google({
      tolvynApiKey: 'tlv_x', googleApiKey: 'goog-direct',
      proxyUrl: `http://127.0.0.1:${port[mode]}/v1/proxy/google`,
      team: 't-team', user: 'pii-user@example.com', endCustomer: 'pii-customer-42',
    });
    return g.getGenerativeModel({ model: 'gemini-x' }, { customHeaders: ATTR, timeout: 1500 });
  }

  test('refused → fails open with no X-Tolvyn-* (client-level or per-request)', async () => {
    redirectGoogle();
    await model('refused').generateContent('hi');
    const direct = providerSeen.filter((r) => r.via === 'direct');
    expect(direct).toHaveLength(1);
    expect(Object.keys(direct[0].headers).filter((h) => h.startsWith('x-tolvyn-'))).toEqual([]);
    expect(direct[0].headers['x-goog-api-key']).toBe('goog-direct');
  });

  test.each(['503', '503-tolvyn', '451', '429'])('%s → no fail-open', async (mode) => {
    redirectGoogle();
    await expect(model(mode).generateContent('hi')).rejects.toThrow();
    expect(providerSeen).toHaveLength(0);
  });

  test('reset after forwarding → no duplicate', async () => {
    redirectGoogle();
    await expect(model('reset').generateContent('hi')).rejects.toThrow();
    expect(providerSeen.filter((r) => r.via === 'direct')).toHaveLength(0);
  });

  test('the real SDK is what we wrap (sanity)', () => {
    expect(GoogleGenerativeAI).toBeDefined();
  });
});
