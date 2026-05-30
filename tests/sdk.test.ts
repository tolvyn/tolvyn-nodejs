import { OpenAI, Anthropic } from '../src/index';
import { applyFallbackAuth } from '../src/failopen';

// ── Test 1: Imports ────────────────────────────────────────────────────────

test('OpenAI and Anthropic are defined', () => {
  expect(OpenAI).toBeDefined();
  expect(Anthropic).toBeDefined();
});

// ── Test 2: Constructor sets correct baseURL ───────────────────────────────

test('OpenAI constructor sets correct baseURL', () => {
  const client = new OpenAI({
    tolvynApiKey: 'tlv_live_test',
    proxyUrl: 'http://localhost:8081/v1/proxy/openai',
  });
  expect(client.baseURL).toBe('http://localhost:8081/v1/proxy/openai');
});

// ── Test 3: Tag headers injected; empty tags NOT sent ─────────────────────

test('Tag headers injected; unset tags absent', () => {
  const client = new OpenAI({
    tolvynApiKey: 'tlv_live_test',
    team: 'eng',
    service: 'chatbot',
  });
  const headers = (client as any)._options?.defaultHeaders as Record<string, string> | undefined;
  expect(headers?.['X-Tolvyn-Team']).toBe('eng');
  expect(headers?.['X-Tolvyn-Service']).toBe('chatbot');
  expect(headers?.['X-Tolvyn-Feature']).toBeUndefined();
  expect(headers?.['X-Tolvyn-Agent']).toBeUndefined();
});

// ── Test 4: Missing key throws ─────────────────────────────────────────────

test('Missing tolvynApiKey throws error', () => {
  const saved = process.env['TOLVYN_API_KEY'];
  delete process.env['TOLVYN_API_KEY'];
  expect(() => new OpenAI()).toThrow('tolvynApiKey required');
  if (saved !== undefined) process.env['TOLVYN_API_KEY'] = saved;
});

// ── Test 5: Env var fallback ───────────────────────────────────────────────

test('TOLVYN_API_KEY env var used when no explicit key', () => {
  const saved = process.env['TOLVYN_API_KEY'];
  process.env['TOLVYN_API_KEY'] = 'tlv_live_from_env';
  const client = new OpenAI();
  expect(client.apiKey).toBe('tlv_live_from_env');
  if (saved !== undefined) {
    process.env['TOLVYN_API_KEY'] = saved;
  } else {
    delete process.env['TOLVYN_API_KEY'];
  }
});

// ── Test 6: Fail-open attributes ───────────────────────────────────────────

test('Fail-open attributes stored on client', () => {
  const client = new OpenAI({
    tolvynApiKey: 'tlv_live_test',
    failOpen: true,
    openAIApiKey: 'sk-fallback',
    proxyUrl: 'http://localhost:8081/v1/proxy/openai',
  });
  expect(client._tolvynFailOpen).toBe(true);
  expect(client._tolvynFallbackKey).toBe('sk-fallback');
});

// ── Anthropic: constructor and tag headers ─────────────────────────────────

test('Anthropic constructor and tag headers', () => {
  const client = new Anthropic({
    tolvynApiKey: 'tlv_live_test',
    team: 'ml',
    proxyUrl: 'http://localhost:8081/v1/proxy/anthropic',
  });
  expect(client.baseURL).toContain('localhost:8081');
  const headers = (client as any)._options?.defaultHeaders as Record<string, string> | undefined;
  expect(headers?.['X-Tolvyn-Team']).toBe('ml');
  expect(headers?.['X-Tolvyn-Service']).toBeUndefined();
});

// ── Fail-open direct auth (ND-09 / ND-11) ──────────────────────────────────

test('applyFallbackAuth OpenAI → Bearer, no key headers', () => {
  const h = new Headers({ Authorization: 'Bearer tlv_live_secret', 'content-type': 'application/json' });
  applyFallbackAuth(h, 'OpenAI', 'sk-openai-fallback');
  expect(h.get('Authorization')).toBe('Bearer sk-openai-fallback');
  expect(h.has('x-api-key')).toBe(false);
  expect(h.has('x-goog-api-key')).toBe(false);
  expect(h.get('content-type')).toBe('application/json'); // non-auth preserved
});

test('applyFallbackAuth Anthropic → x-api-key with provider key, no TOLVYN leak', () => {
  // Anthropic SDK ships the TOLVYN key in x-api-key — must be replaced, not leaked.
  const h = new Headers({ 'x-api-key': 'tlv_live_secret', 'anthropic-version': '2023-06-01' });
  applyFallbackAuth(h, 'Anthropic', 'sk-ant-fallback');
  expect(h.get('x-api-key')).toBe('sk-ant-fallback'); // ND-11: provider key, not TOLVYN key
  expect(h.has('Authorization')).toBe(false);          // ND-09: no Bearer
  expect(h.get('anthropic-version')).toBe('2023-06-01');
});

test('applyFallbackAuth Google → x-goog-api-key with provider key', () => {
  const h = new Headers({ 'x-goog-api-key': 'tlv_live_secret' });
  applyFallbackAuth(h, 'Google', 'goog-fallback');
  expect(h.get('x-goog-api-key')).toBe('goog-fallback');
  expect(h.has('Authorization')).toBe(false);
  expect(h.has('x-api-key')).toBe(false);
});

test('applyFallbackAuth strips all inbound auth headers', () => {
  const h = new Headers({ Authorization: 'Bearer tlv', 'x-api-key': 'tlv', 'x-goog-api-key': 'tlv' });
  applyFallbackAuth(h, 'anthropic', 'sk-ant-fallback');
  expect(h.get('x-api-key')).toBe('sk-ant-fallback');
  expect(h.has('Authorization')).toBe(false);
  expect(h.has('x-goog-api-key')).toBe(false);
});
