/**
 * Fail-open helpers: detect proxy unreachability and retry direct.
 */

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

export function makeFailOpenFetch(
  fallbackKey: string,
  directUrl: string,
  provider: string
): typeof globalThis.fetch {
  return async function failOpenFetch(
    input: RequestInfo | URL,
    init?: RequestInit
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
        `TOLVYN proxy unreachable — routing direct to ${provider} (fail-open)`
      );
      const originalUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
          ? input.href
          : (input as Request).url;
      const url = new URL(originalUrl);
      const directBase = new URL(directUrl);
      url.hostname = directBase.hostname;
      url.protocol = directBase.protocol;
      url.port = directBase.port;

      const newInit: RequestInit = { ...(init ?? {}) };
      const headers = new Headers((init?.headers as HeadersInit) ?? {});
      headers.set('Authorization', `Bearer ${fallbackKey}`);
      newInit.headers = headers;

      return fetch(url.toString(), newInit);
    }
  };
}
