/**
 * Fail-open helpers: detect proxy unreachability and retry direct.
 */

const PROXY_PREFIX_RE = /^\/v1\/proxy\/(?:openai|anthropic|google)\//;

export function isProxyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;

  // Node.js connection errors (ECONNREFUSED, ETIMEDOUT, etc.)
  const code = err['code'];
  if (typeof code === 'string' && (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code.startsWith('ERR_')
  )) {
    return true;
  }

  // HTTP 503 from proxy
  const status = err['status'] ?? err['statusCode'];
  if (status === 503) return true;

  // fetch-level errors
  const message = typeof err['message'] === 'string' ? err['message'] : '';
  if (
    message.includes('ECONNREFUSED') ||
    message.includes('ETIMEDOUT') ||
    message.includes('fetch failed') ||
    message.includes('connect ECONNREFUSED')
  ) {
    return true;
  }

  // Check cause (Node 18+ wraps errors)
  const cause = err['cause'];
  if (cause && isProxyError(cause)) return true;

  return false;
}

export function shouldNotFailOpen(error: unknown): boolean {
  // Never fail-open on real API errors (401, 429, other 4xx except 503).
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  const status = err['status'] ?? err['statusCode'];
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 503) {
    return true;
  }
  return false;
}

/**
 * Build the direct-provider URL from a proxy request URL.
 *
 * Strips the /v1/proxy/{provider}/ prefix from the request path, then prepends
 * the fallback base URL's path (e.g. "/v1" for OpenAI, "" for Anthropic) so
 * the final URL hits the real provider endpoint.
 *
 * Example (OpenAI):
 *   originalUrl:    https://proxy.tolvyn.io/v1/proxy/openai/chat/completions
 *   fallbackBase:   https://api.openai.com/v1
 *   → https://api.openai.com/v1/chat/completions
 *
 * Example (Anthropic):
 *   originalUrl:    https://proxy.tolvyn.io/v1/proxy/anthropic/v1/messages
 *   fallbackBase:   https://api.anthropic.com
 *   → https://api.anthropic.com/v1/messages
 */
export function buildFallbackUrl(originalUrl: URL, fallbackBaseUrl: string): URL {
  const fb = new URL(fallbackBaseUrl);
  const fbBasePath = fb.pathname.replace(/\/$/, ''); // "/v1" or ""

  const stripped = originalUrl.pathname.replace(PROXY_PREFIX_RE, '/');
  const finalPath = fbBasePath + stripped;

  const newUrl = new URL(originalUrl.toString());
  newUrl.protocol = fb.protocol;
  newUrl.hostname = fb.hostname;
  newUrl.port = fb.port;
  newUrl.pathname = finalPath;
  return newUrl;
}

export function makeFailOpenFetch(
  fallbackKey: string,
  directUrl: string,
  provider: string,
): typeof globalThis.fetch {
  return async function failOpenFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    try {
      const res = await fetch(input, init);
      if (res.status === 503) {
        throw Object.assign(new Error('503 from proxy'), { status: 503 });
      }
      return res;
    } catch (err: unknown) {
      if (shouldNotFailOpen(err) || !isProxyError(err)) throw err;
      console.error(
        `TOLVYN proxy unreachable — routing direct to ${provider} (fail-open)`,
      );
      const originalUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.href
          : (input as Request).url;
      const url = buildFallbackUrl(new URL(originalUrl), directUrl);

      const newInit: RequestInit = { ...(init ?? {}) };
      const headers = new Headers((init?.headers as HeadersInit) ?? {});
      headers.set('Authorization', `Bearer ${fallbackKey}`);
      newInit.headers = headers;

      return fetch(url.toString(), newInit);
    }
  };
}
