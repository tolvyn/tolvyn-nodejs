/**
 * TOLVYN OpenAI wrapper — thin drop-in over the official openai package.
 */
import OpenAIBase, { ClientOptions } from 'openai';
import { isProxyError, shouldNotFailOpen } from './failopen';

const OPENAI_DEFAULT_PROXY_URL = 'http://localhost:8081/v1/proxy/openai';
const OPENAI_DIRECT_URL = 'https://api.openai.com/v1';

export interface TolvynOpenAIOptions
  extends Omit<ClientOptions, 'apiKey' | 'baseURL'> {
  tolvynApiKey?: string;
  proxyUrl?: string;
  team?: string;
  service?: string;
  feature?: string;
  agent?: string;
  failOpen?: boolean;
  openAIApiKey?: string;
}

function makeFailOpenFetch(
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
      url.pathname = url.pathname; // keep path intact

      const newInit: RequestInit = { ...(init ?? {}) };
      const headers = new Headers((init?.headers as HeadersInit) ?? {});
      headers.set('Authorization', `Bearer ${fallbackKey}`);
      newInit.headers = headers;

      return fetch(url.toString(), newInit);
    }
  };
}

export class OpenAI extends OpenAIBase {
  public readonly _tolvynFailOpen: boolean;
  public readonly _tolvynFallbackKey: string | undefined;
  public readonly _tolvynProxyUrl: string;

  constructor(options: TolvynOpenAIOptions = {}) {
    const tolvynApiKey = options.tolvynApiKey ?? process.env['TOLVYN_API_KEY'];
    if (!tolvynApiKey) {
      throw new Error(
        'tolvynApiKey required. Set TOLVYN_API_KEY env var or pass tolvynApiKey.'
      );
    }

    const proxyUrl =
      options.proxyUrl ??
      process.env['TOLVYN_PROXY_URL'] ??
      OPENAI_DEFAULT_PROXY_URL;

    const defaultHeaders: Record<string, string> = {};
    if (options.team)    defaultHeaders['X-Tolvyn-Team']    = options.team;
    if (options.service) defaultHeaders['X-Tolvyn-Service'] = options.service;
    if (options.feature) defaultHeaders['X-Tolvyn-Feature'] = options.feature;
    if (options.agent)   defaultHeaders['X-Tolvyn-Agent']   = options.agent;

    const fallbackKey = options.openAIApiKey ?? process.env['OPENAI_API_KEY'];
    const failOpen = options.failOpen ?? true;

    const {
      tolvynApiKey: _tk, proxyUrl: _pu, team: _t, service: _sv,
      feature: _f, agent: _a, failOpen: _fo, openAIApiKey: _oak,
      ...rest
    } = options;

    const superOptions: ClientOptions = {
      ...rest,
      apiKey: tolvynApiKey,
      baseURL: proxyUrl,
      defaultHeaders,
    };

    if (failOpen && fallbackKey && !superOptions.fetch) {
      superOptions.fetch = makeFailOpenFetch(fallbackKey, OPENAI_DIRECT_URL, 'OpenAI');
    }

    super(superOptions);

    this._tolvynFailOpen = failOpen;
    this._tolvynFallbackKey = fallbackKey;
    this._tolvynProxyUrl = proxyUrl;
  }
}
