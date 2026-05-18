/**
 * TOLVYN Google wrapper — thin drop-in over @google/generative-ai.
 */
import {
  GoogleGenerativeAI,
  ModelParams,
  RequestOptions,
} from '@google/generative-ai';

// The proxy base URL is prepended to Google API paths (/v1beta/models/...).
// The TOLVYN proxy strips /v1/proxy/google and forwards the remainder to Google.
const GOOGLE_DEFAULT_PROXY_URL = 'https://proxy.tolvyn.io/v1/proxy/google/';

export interface TolvynGoogleOptions {
  tolvynApiKey?: string;
  proxyUrl?: string;
  team?: string;
  service?: string;
  feature?: string;
  agent?: string;
  user?: string;
  endCustomer?: string;
  failOpen?: boolean;
  googleApiKey?: string;
}

export class TolvynGoogle extends GoogleGenerativeAI {
  public readonly _tolvynFailOpen: boolean;
  public readonly _tolvynFallbackKey: string | undefined;
  private readonly _tolvynProxyUrl: string;
  private readonly _tolvynHeaders: Record<string, string>;

  constructor(options: TolvynGoogleOptions = {}) {
    const tolvynApiKey = options.tolvynApiKey ?? process.env['TOLVYN_API_KEY'];
    if (!tolvynApiKey) {
      throw new Error(
        'tolvynApiKey required. Set TOLVYN_API_KEY env var or pass tolvynApiKey.'
      );
    }

    // GoogleGenerativeAI sends this value as x-goog-api-key.
    // The TOLVYN proxy's extractBearer reads x-goog-api-key as a fallback.
    super(tolvynApiKey);

    this._tolvynProxyUrl =
      options.proxyUrl ??
      process.env['TOLVYN_PROXY_URL'] ??
      GOOGLE_DEFAULT_PROXY_URL;

    this._tolvynHeaders = {};
    if (options.team)        this._tolvynHeaders['X-Tolvyn-Team']         = options.team;
    if (options.service)     this._tolvynHeaders['X-Tolvyn-Service']      = options.service;
    if (options.feature)     this._tolvynHeaders['X-Tolvyn-Feature']      = options.feature;
    if (options.agent)       this._tolvynHeaders['X-Tolvyn-Agent']        = options.agent;
    if (options.user)        this._tolvynHeaders['X-Tolvyn-User']         = options.user;
    if (options.endCustomer) this._tolvynHeaders['X-Tolvyn-End-Customer'] = options.endCustomer;

    this._tolvynFailOpen = options.failOpen ?? true;
    this._tolvynFallbackKey =
      options.googleApiKey ?? process.env['GOOGLE_API_KEY'];
  }

  override getGenerativeModel(
    modelParams: ModelParams,
    requestOptions?: RequestOptions
  ) {
    const mergedOptions: RequestOptions = {
      baseUrl: this._tolvynProxyUrl,
      customHeaders: this._tolvynHeaders,
      ...requestOptions,
    };
    return super.getGenerativeModel(modelParams, mergedOptions);
  }
}
