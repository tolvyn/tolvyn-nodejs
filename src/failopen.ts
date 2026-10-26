/**
 * Fail-open helpers: detect proxy unreachability and retry direct.
 */

const PROXY_PREFIX_RE = /^\/v1\/proxy\/(?:openai|anthropic|google|deepseek)\//;

// FAIL OPEN ONLY WHEN THE PROXY WAS NEVER REACHED. Each code below is raised
// before a request can have been forwarded: refused, DNS failure, a timeout while
// CONNECTING, or a TLS handshake that did not complete. Nothing on the far side can
// be serving (or charging for) the request, so a direct retry cannot double-bill.
//
// DELIBERATELY ABSENT: ECONNRESET, UND_ERR_SOCKET, header/body timeouts, aborts,
// and the bare message "fetch failed" — each can happen AFTER the proxy forwarded
// the request, and retrying direct then produced a second, unmetered provider call
// (measured). Also absent: any other `ERR_*` code. That prefix matched programming
// and stream errors (ERR_INVALID_ARG_TYPE, ERR_INVALID_URL,
// ERR_STREAM_PREMATURE_CLOSE) and routed them around TOLVYN as if it were down.
const CONNECT_FAILURE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  // TLS handshake failures — the connection never carried the request.
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
]);

function isConnectFailureCode(code: unknown, syscall: unknown): boolean {
  if (typeof code !== 'string') return false;
  if (CONNECT_FAILURE_CODES.has(code)) return true;
  if (code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) return true;
  // ETIMEDOUT is only a pre-forward failure while the socket is still connecting.
  return code === 'ETIMEDOUT' && syscall === 'connect';
}

/**
 * True only if the error shows the proxy was never reached. Walks `cause`
 * because Node's fetch wraps the socket error in `TypeError: fetch failed`.
 */
export function isProxyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  if (isConnectFailureCode(err['code'], err['syscall'])) return true;
  const cause = err['cause'];
  return cause ? isProxyError(cause) : false;
}

/** The header TOLVYN sets on a 503 that means "TOLVYN itself is unavailable". */
export const TOLVYN_UNAVAILABLE_HEADER = 'X-Tolvyn-Unavailable';

/**
 * A 503 fails open ONLY when TOLVYN marks it as its own. A plain 503 on the proxy
 * path is the provider's 503 passed through — the server never writes 503 on
 * /v1/proxy/ — and enforcement (451 kill switch, 429 budget/quota) never fails open.
 */
export function isTolvynUnavailable(res: Response): boolean {
  return res.status === 503 && (res.headers.get(TOLVYN_UNAVAILABLE_HEADER) ?? '').trim() === '1';
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

// The header each provider's DIRECT API reads the API key from. The TOLVYN
// proxy accepts Authorization/x-api-key/x-goog-api-key interchangeably, but the
// providers themselves do NOT: Anthropic authenticates only via x-api-key and
// Google only via x-goog-api-key — sending Bearer to them 401s.
const PROVIDER_AUTH_HEADER: Record<string, string> = {
  openai: 'Authorization',
  anthropic: 'x-api-key',
  google: 'x-goog-api-key',
  deepseek: 'Authorization', // OpenAI-compatible; Bearer auth (same as the default)
};

/**
 * Rewrite `headers` in place to authenticate a direct provider call.
 *
 * Strips every inbound auth header (Authorization/x-api-key/x-goog-api-key —
 * each may carry the TOLVYN key) and sets the single header the provider's
 * direct API expects, with the provider's own key. Fixes ND-09 (Bearer sent to
 * Anthropic → 401) and ND-11 (the TOLVYN key in x-api-key leaking on fallback).
 */
export function applyFallbackAuth(
  headers: Headers,
  provider: string,
  fallbackKey: string,
): void {
  headers.delete('Authorization');
  headers.delete('x-api-key');
  headers.delete('x-goog-api-key');
  const header = PROVIDER_AUTH_HEADER[provider.toLowerCase()] ?? 'Authorization';
  if (header === 'Authorization') {
    headers.set('Authorization', `Bearer ${fallbackKey}`);
  } else {
    headers.set(header, fallbackKey);
  }
}

// Never copied onto the direct request: `host` names the PROXY, and these are
// recomputed or hop-by-hop. Every X-Tolvyn-* header is also dropped (below).
const NOT_FORWARDED = new Set([
  'host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  'te', 'trailer', 'upgrade', 'proxy-connection',
]);

/**
 * Headers for the direct provider request: every X-Tolvyn-* header in any casing
 * is dropped, whether set on the client or per request — they carry attribution,
 * and X-Tolvyn-User / X-Tolvyn-End-Customer can be personal data — then auth is
 * replaced with the provider's own key.
 */
export function fallbackHeaders(source: Headers, provider: string, fallbackKey: string): Headers {
  const out = new Headers();
  source.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!NOT_FORWARDED.has(k) && !k.startsWith('x-tolvyn-')) out.set(key, value);
  });
  applyFallbackAuth(out, provider, fallbackKey);
  return out;
}

function isReplayableBody(body: unknown): boolean {
  if (body === undefined || body === null) return true;
  if (typeof body === 'string') return true;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  return false; // a stream is consumed by the first attempt and cannot be replayed
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
    // Normalise once, BEFORE the first attempt: a Request's body is a stream the
    // first fetch consumes, and its headers are not in `init`. Both used to be
    // lost on fallback, which sent an empty POST.
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = isRequest ? (input as Request).url : input instanceof URL ? input.href : String(input);
    const method = init?.method ?? (isRequest ? (input as Request).method : 'GET');
    const headers = new Headers(isRequest ? (input as Request).headers : undefined);
    new Headers((init?.headers as HeadersInit) ?? {}).forEach((v, k) => headers.set(k, v));
    const signal = init?.signal ?? (isRequest ? (input as Request).signal : undefined);
    let body: BodyInit | null | undefined = init?.body;
    if (body === undefined && isRequest && (input as Request).body) {
      body = await (input as Request).clone().arrayBuffer();
    }
    const canReplay = isReplayableBody(body);

    let res: Response | undefined;
    try {
      res = await fetch(url, { ...(init ?? {}), method, headers, body, signal });
    } catch (err: unknown) {
      if (!canReplay || shouldNotFailOpen(err) || !isProxyError(err)) throw err;
    }
    if (res) {
      if (!canReplay || !isTolvynUnavailable(res)) return res;
      await res.body?.cancel(); // discard TOLVYN's 503 before going direct
    }
    console.error(
      `TOLVYN proxy unreachable — routing direct to ${provider} (fail-open)`,
    );
    const target = buildFallbackUrl(new URL(url), directUrl);
    return fetch(target.toString(), {
      ...(init ?? {}),
      method,
      headers: fallbackHeaders(headers, provider, fallbackKey),
      body,
      signal,
    });
  };
}
