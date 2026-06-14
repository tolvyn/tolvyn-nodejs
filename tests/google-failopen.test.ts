/**
 * BE-91: Google fail-open must cover all network methods, not just generateContent.
 *
 * On current code:
 *   - generateContent test                       → GREEN (ND-01 already wraps it)
 *   - generateContentStream/countTokens/          → RED (unwrapped → ECONNREFUSED
 *     embedContent/batchEmbedContents tests          propagates, no fail-over)
 *   - "fallback omits proxy baseUrl" test         → GREEN (via generateContent)
 *   - "non-proxy error rethrown" test             → GREEN (via generateContent)
 *
 * We mock @google/generative-ai: the proxy client (TOLVYN key) throws a
 * connection error; the direct fallback client (GOOGLE key) succeeds. This
 * proves each method fails over to the real Google endpoint with GOOGLE_API_KEY.
 */

// jest.mock factory may only reference variables prefixed with `mock`.
const mockCtorKeys: string[] = [];
const mockGetModelCalls: Array<{ key: string; options: unknown }> = [];

jest.mock('@google/generative-ai', () => {
  class FakeGoogleGenerativeAI {
    apiKey: string;
    constructor(apiKey: string) {
      this.apiKey = apiKey;
      mockCtorKeys.push(apiKey);
    }
    getGenerativeModel(_modelParams: unknown, requestOptions: unknown) {
      const key = this.apiKey;
      mockGetModelCalls.push({ key, options: requestOptions });
      // The proxy client is constructed with the TOLVYN key; the fail-open
      // fallback client is constructed with the GOOGLE key.
      const isProxyClient = key.startsWith('tlv_');
      const make = (method: string) => async (...args: unknown[]) => {
        if (isProxyClient) {
          const arg0 = args[0] as { __nonProxyError?: boolean } | undefined;
          if (arg0?.__nonProxyError) {
            // A genuine API error (e.g. 400) must NOT trigger fail-over.
            throw Object.assign(new Error('bad request'), { status: 400 });
          }
          // Simulate the TOLVYN proxy being unreachable.
          throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        }
        // Direct-to-Google fallback path succeeds.
        return { servedBy: 'google-direct', key, method };
      };
      return {
        generateContent: make('generateContent'),
        generateContentStream: make('generateContentStream'),
        countTokens: make('countTokens'),
        embedContent: make('embedContent'),
        batchEmbedContents: make('batchEmbedContents'),
      };
    }
  }
  return { GoogleGenerativeAI: FakeGoogleGenerativeAI };
});

import { Google } from '../src/google';

const GOOGLE_KEY = 'goog-fallback-key';

function makeModel(): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const client = new Google({
    tolvynApiKey: 'tlv_live_test',
    googleApiKey: GOOGLE_KEY,
    proxyUrl: 'https://proxy.tolvyn.io/v1/proxy/google',
  });
  return client.getGenerativeModel({ model: 'gemini-1.5-flash' }) as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
}

beforeEach(() => {
  mockCtorKeys.length = 0;
  mockGetModelCalls.length = 0;
});

const METHODS = [
  'generateContent',
  'generateContentStream',
  'countTokens',
  'embedContent',
  'batchEmbedContents',
] as const;

describe('Google fail-open coverage (BE-91)', () => {
  for (const method of METHODS) {
    test(`${method} fails over to direct Google with GOOGLE_API_KEY`, async () => {
      const model = makeModel();
      const result = await model[method]({});
      expect(result).toMatchObject({ servedBy: 'google-direct', method, key: GOOGLE_KEY });
      // Fallback client constructed with the GOOGLE key (not the TOLVYN key):
      expect(mockCtorKeys).toContain(GOOGLE_KEY);
    });
  }

  test('fallback model is built WITHOUT the proxy baseUrl (hits real Google)', async () => {
    const model = makeModel();
    await model.generateContent({});
    const fallbackCall = mockGetModelCalls.find((c) => c.key === GOOGLE_KEY);
    expect(fallbackCall).toBeDefined();
    const opts = (fallbackCall!.options ?? {}) as { baseUrl?: string };
    expect(opts.baseUrl).toBeUndefined();
  });

  test('non-proxy errors are NOT failed over (rethrown, no direct call)', async () => {
    const model = makeModel();
    await expect(model.generateContent({ __nonProxyError: true })).rejects.toMatchObject({
      status: 400,
    });
    expect(mockCtorKeys).not.toContain(GOOGLE_KEY); // never built a fallback client
  });
});
