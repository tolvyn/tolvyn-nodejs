/**
 * TOLVYN DeepSeek wrapper — thin drop-in over the official openai package.
 *
 * DeepSeek exposes an OpenAI-compatible API, so this wraps the same `openai`
 * base client as the OpenAI wrapper but points the proxy/fallback at DeepSeek
 * and falls back with the DeepSeek key. Fail-open routes direct to
 * https://api.deepseek.com/v1 (Bearer auth) when the TOLVYN proxy is unreachable.
 */
import OpenAIBase, { ClientOptions } from 'openai';
import { makeFailOpenFetch } from './failopen';

const DEEPSEEK_DEFAULT_PROXY_URL = 'https://proxy.tolvyn.io/v1/proxy/deepseek/';
const DEEPSEEK_DIRECT_URL = 'https://api.deepseek.com/v1';

export interface TolvynDeepSeekOptions
  extends Omit<ClientOptions, 'apiKey' | 'baseURL'> {
  tolvynApiKey?: string;
  proxyUrl?: string;
  team?: string;
  service?: string;
  feature?: string;
  agent?: string;
  user?: string;
  endCustomer?: string;
  failOpen?: boolean;
  deepSeekApiKey?: string;
}

export class DeepSeek extends OpenAIBase {
  public readonly _tolvynFailOpen: boolean;
  public readonly _tolvynFallbackKey: string | undefined;
  public readonly _tolvynProxyUrl: string;

  constructor(options: TolvynDeepSeekOptions = {}) {
    const tolvynApiKey = options.tolvynApiKey ?? process.env['TOLVYN_API_KEY'];
    if (!tolvynApiKey) {
      throw new Error(
        'tolvynApiKey required. Set TOLVYN_API_KEY env var or pass tolvynApiKey.'
      );
    }

    const proxyUrl =
      options.proxyUrl ??
      process.env['TOLVYN_PROXY_URL'] ??
      DEEPSEEK_DEFAULT_PROXY_URL;

    const defaultHeaders: Record<string, string> = {};
    if (options.team)        defaultHeaders['X-Tolvyn-Team']         = options.team;
    if (options.service)     defaultHeaders['X-Tolvyn-Service']      = options.service;
    if (options.feature)     defaultHeaders['X-Tolvyn-Feature']      = options.feature;
    if (options.agent)       defaultHeaders['X-Tolvyn-Agent']        = options.agent;
    if (options.user)        defaultHeaders['X-Tolvyn-User']         = options.user;
    if (options.endCustomer) defaultHeaders['X-Tolvyn-End-Customer'] = options.endCustomer;

    const fallbackKey = options.deepSeekApiKey ?? process.env['DEEPSEEK_API_KEY'];
    const failOpen = options.failOpen ?? true;

    const {
      tolvynApiKey: _tk, proxyUrl: _pu, team: _t, service: _sv,
      feature: _f, agent: _a, user: _u, endCustomer: _ec,
      failOpen: _fo, deepSeekApiKey: _dsk,
      ...rest
    } = options;

    const superOptions: ClientOptions = {
      ...rest,
      apiKey: tolvynApiKey,
      baseURL: proxyUrl,
      defaultHeaders,
    };

    if (failOpen && fallbackKey && !superOptions.fetch) {
      superOptions.fetch = makeFailOpenFetch(fallbackKey, DEEPSEEK_DIRECT_URL, 'DeepSeek');
    }

    super(superOptions);

    this._tolvynFailOpen = failOpen;
    this._tolvynFallbackKey = fallbackKey;
    this._tolvynProxyUrl = proxyUrl;
  }
}
