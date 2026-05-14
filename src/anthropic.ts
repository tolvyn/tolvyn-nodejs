/**
 * TOLVYN Anthropic wrapper — thin drop-in over @anthropic-ai/sdk.
 */
import AnthropicBase, { ClientOptions } from '@anthropic-ai/sdk';
import { makeFailOpenFetch } from './failopen';

const ANTHROPIC_DEFAULT_PROXY_URL = 'https://proxy.tolvyn.io/v1/proxy/anthropic/';
const ANTHROPIC_DIRECT_URL = 'https://api.anthropic.com';

export interface TolvynAnthropicOptions
  extends Omit<ClientOptions, 'apiKey' | 'baseURL'> {
  tolvynApiKey?: string;
  proxyUrl?: string;
  team?: string;
  service?: string;
  feature?: string;
  agent?: string;
  failOpen?: boolean;
  anthropicApiKey?: string;
}

export class Anthropic extends AnthropicBase {
  public readonly _tolvynFailOpen: boolean;
  public readonly _tolvynFallbackKey: string | undefined;

  constructor(options: TolvynAnthropicOptions = {}) {
    const tolvynApiKey = options.tolvynApiKey ?? process.env['TOLVYN_API_KEY'];
    if (!tolvynApiKey) {
      throw new Error(
        'tolvynApiKey required. Set TOLVYN_API_KEY env var or pass tolvynApiKey.'
      );
    }

    const proxyUrl =
      options.proxyUrl ??
      process.env['TOLVYN_PROXY_URL'] ??
      ANTHROPIC_DEFAULT_PROXY_URL;

    const defaultHeaders: Record<string, string> = {};
    if (options.team)    defaultHeaders['X-Tolvyn-Team']    = options.team;
    if (options.service) defaultHeaders['X-Tolvyn-Service'] = options.service;
    if (options.feature) defaultHeaders['X-Tolvyn-Feature'] = options.feature;
    if (options.agent)   defaultHeaders['X-Tolvyn-Agent']   = options.agent;

    const fallbackKey = options.anthropicApiKey ?? process.env['ANTHROPIC_API_KEY'];
    const failOpen = options.failOpen ?? true;

    const {
      tolvynApiKey: _tk, proxyUrl: _pu, team: _t, service: _sv,
      feature: _f, agent: _a, failOpen: _fo, anthropicApiKey: _aak,
      ...rest
    } = options;

    const superOptions: ClientOptions = {
      ...rest,
      apiKey: tolvynApiKey,
      baseURL: proxyUrl,
      defaultHeaders,
    };

    if (failOpen && fallbackKey && !superOptions.fetch) {
      superOptions.fetch = makeFailOpenFetch(fallbackKey, ANTHROPIC_DIRECT_URL, 'Anthropic');
    }

    super(superOptions);

    this._tolvynFailOpen = failOpen;
    this._tolvynFallbackKey = fallbackKey;
  }
}
