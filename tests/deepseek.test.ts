/**
 * BE-89: DeepSeek wrapper fail-open tests (v1.0.9).
 *
 * Written BEFORE the implementation. On current code:
 *   - buildFallbackUrl test  → RED (PROXY_PREFIX_RE excludes `deepseek`, so the
 *     proxy prefix is not stripped and the path doubles to /v1/v1/proxy/deepseek/…)
 *   - end-to-end fail-open    → RED (same regex gap → retry URL has the wrong path)
 *   - applyFallbackAuth test  → GREEN already (unknown providers default to
 *     `Authorization: Bearer`, which is exactly what DeepSeek needs) — included to
 *     pin that behaviour so it can't regress when `deepseek` is added to the map.
 */
import { DeepSeek } from '../src/index';
import { buildFallbackUrl, applyFallbackAuth, makeFailOpenFetch } from '../src/failopen';

// ── Wrapper wiring: export, proxy baseURL, fail-open attributes ────────────────

test('DeepSeek is exported from index', () => {
  expect(DeepSeek).toBeDefined();
});

test('DeepSeek constructor sets the deepseek proxy baseURL', () => {
  const client = new DeepSeek({
    tolvynApiKey: 'tlv_live_test',
    proxyUrl: 'http://localhost:8081/v1/proxy/deepseek',
  });
  expect(client.baseURL).toBe('http://localhost:8081/v1/proxy/deepseek');
});

test('DeepSeek stores fail-open attributes from deepSeekApiKey', () => {
  const client = new DeepSeek({
    tolvynApiKey: 'tlv_live_test',
    failOpen: true,
    deepSeekApiKey: 'sk-deepseek-fallback',
    proxyUrl: 'http://localhost:8081/v1/proxy/deepseek',
  });
  expect(client._tolvynFailOpen).toBe(true);
  expect(client._tolvynFallbackKey).toBe('sk-deepseek-fallback');
});

// ── Regression: fallback URL must land on api.deepseek.com, NOT api.openai.com ──

test('buildFallbackUrl deepseek → api.deepseek.com/v1/chat/completions (not openai)', () => {
  const url = buildFallbackUrl(
    new URL('https://proxy.tolvyn.io/v1/proxy/deepseek/chat/completions'),
    'https://api.deepseek.com/v1',
  );
  expect(url.hostname).toBe('api.deepseek.com');
  expect(url.hostname).not.toBe('api.openai.com'); // must not bleed into OpenAI
  // The regex fix is what makes the PATH correct (no doubled /v1/proxy/deepseek):
  expect(url.pathname).toBe('/v1/chat/completions');
  expect(url.href).toBe('https://api.deepseek.com/v1/chat/completions');
});

// ── Direct-call auth for DeepSeek → Bearer, no key-header leak ──────────────────

test('applyFallbackAuth DeepSeek → Authorization: Bearer, no x-api-key/x-goog leak', () => {
  const h = new Headers({
    Authorization: 'Bearer tlv_live_secret',
    'x-api-key': 'tlv_live_secret',
    'content-type': 'application/json',
  });
  applyFallbackAuth(h, 'DeepSeek', 'sk-deepseek-fallback');
  expect(h.get('Authorization')).toBe('Bearer sk-deepseek-fallback');
  expect(h.has('x-api-key')).toBe(false);
  expect(h.has('x-goog-api-key')).toBe(false);
  expect(h.get('content-type')).toBe('application/json'); // non-auth preserved
});

// ── End-to-end: proxy ECONNREFUSED → retry hits api.deepseek.com with the key ──
// Fills the pre-existing gap: no test drives makeFailOpenFetch through a real
// proxy-outage → direct-retry cycle.

test('makeFailOpenFetch DeepSeek: proxy ECONNREFUSED → retries api.deepseek.com with DEEPSEEK key', async () => {
  const realFetch = globalThis.fetch;
  let callCount = 0;
  let capturedUrl: string | undefined;
  let capturedHeaders: Headers | undefined;

  // 1st call (proxy) throws a connection error; 2nd call (direct) succeeds.
  (globalThis as any).fetch = async (input: any, init: any) => {
    callCount += 1;
    if (callCount === 1) {
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
        code: 'ECONNREFUSED',
      });
    }
    capturedUrl = typeof input === 'string' ? input : input.toString();
    capturedHeaders = new Headers(init?.headers ?? {});
    return new Response('{"ok":true}', { status: 200 });
  };

  try {
    const failOpenFetch = makeFailOpenFetch(
      'sk-deepseek-key',
      'https://api.deepseek.com/v1',
      'DeepSeek',
    );
    const res = await failOpenFetch(
      'https://proxy.tolvyn.io/v1/proxy/deepseek/chat/completions',
      { method: 'POST', headers: { Authorization: 'Bearer tlv_live_secret' } },
    );

    expect(res.status).toBe(200);
    expect(callCount).toBe(2); // proxy failed, direct retried
    expect(capturedUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(capturedUrl).not.toContain('api.openai.com');
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer sk-deepseek-key');
  } finally {
    (globalThis as any).fetch = realFetch;
  }
});
