import { OpenAI, Anthropic } from '../src/index';

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
