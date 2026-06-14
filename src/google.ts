/**
 * TOLVYN Google wrapper — thin drop-in over @google/generative-ai.
 */
import {
  GoogleGenerativeAI,
  ModelParams,
  RequestOptions,
} from '@google/generative-ai';
import { isProxyError } from './failopen';

// The proxy base URL is prepended to Google API paths (/v1beta/models/...).
// The TOLVYN proxy strips /v1/proxy/google and forwards the remainder to Google.
// ND-10: NO trailing slash. @google/generative-ai builds `${baseUrl}/${apiVersion}/...`
// WITHOUT collapsing a double slash (unlike the OpenAI/Anthropic SDKs), so a
// trailing slash here produces `.../proxy/google//v1beta/...`. This intentionally
// reverses ND-07's trailing-slash "consistency" for the Google provider only.
const GOOGLE_DEFAULT_PROXY_URL = 'https://proxy.tolvyn.io/v1/proxy/google';

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

// ND-05: renamed from TolvynGoogle → Google so stack traces and constructor.name
// match the public API. Old name remains re-exportable via index.ts alias.
export class Google extends GoogleGenerativeAI {
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

    // ND-06: The TOLVYN API key is passed as the GoogleGenerativeAI api key.
    // Google's SDK sends this as `x-goog-api-key`; the TOLVYN proxy reads
    // `x-goog-api-key` as a Bearer-auth fallback for Google requests.
    // This is intentional — keep this comment if you refactor.
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
      // ND-10: strip any trailing slash so an env/option override can't
      // reintroduce the double-slash the Google SDK won't collapse.
      baseUrl: this._tolvynProxyUrl.replace(/\/+$/, ''),
      customHeaders: this._tolvynHeaders,
      ...requestOptions,
    };
    const model = super.getGenerativeModel(modelParams, mergedOptions);

    // ND-01 + BE-91: wrap every GenerativeModel network method so a
    // proxy-unreachable error retries against the real Google API using the
    // fallback key. Google's SDK exposes no fetch hook (unlike the
    // OpenAI/Anthropic wrappers), so we rebuild a direct client — with the
    // ORIGINAL requestOptions, i.e. WITHOUT the proxy baseUrl, so it hits the
    // real generativelanguage.googleapis.com — and re-invoke the same method.
    // (ND-01 covered only generateContent; BE-91 extends to stream/count/embed.
    //  startChat returns a ChatSession with separate plumbing — not yet covered.)
    if (!this._tolvynFailOpen || !this._tolvynFallbackKey) {
      return model;
    }
    const fallbackKey = this._tolvynFallbackKey;
    const failOpenMethods = [
      'generateContent',
      'generateContentStream',
      'countTokens',
      'embedContent',
      'batchEmbedContents',
    ] as const;

    for (const method of failOpenMethods) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const original = (model as any)[method];
      if (typeof original !== 'function') continue;
      const boundOriginal = original.bind(model);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any)[method] = async (...args: unknown[]) => {
        try {
          return await boundOriginal(...args);
        } catch (e) {
          if (!isProxyError(e)) throw e;
          console.error(
            'TOLVYN proxy unreachable — routing direct to Google (fail-open)',
          );
          const fallbackModel = new GoogleGenerativeAI(fallbackKey).getGenerativeModel(
            modelParams,
            requestOptions,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (fallbackModel as any)[method](...args);
        }
      };
    }
    return model;
  }
}
