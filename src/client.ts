import { AgentsApi, RunsApi, SkillsApi } from "./agents.js"
import { BrowserApi } from "./browser.js"
import { DatabaseApi, DatabaseDataApi } from "./database.js"
import { MailApi } from "./mail.js"
import { MarketplaceApi } from "./marketplace.js"
import { CogniCloudError } from "./errors.js"
import { open, send, type HttpConfig } from "./http.js"
import { checkKeys, pairHeaders, type ProductKeys, type ProductName } from "./keys.js"
import { StorageApi } from "./storage.js"
import { streamEvents } from "./stream.js"
import { WebBuilderApi } from "./web-builder.js"
import type {
  Body,
  CreatedEndpoint,
  CreateEndpointInput,
  DailyUsage,
  DailyUsageRange,
  Endpoint,
  EmbeddingsRequest,
  EmbeddingsResult,
  EndpointUsage,
  InvokeBody,
  InvokeResponse,
  ResponseResult,
  ResponsesRequest,
  StreamEvent,
  UpdateEndpointInput,
} from "./types.js"

/** Options shared by every client. */
export type ClientOptions = {
  /** Point at another environment. Default `https://cognicloud.dev/api/v1/ai-gateway`. */
  baseUrl?: string
  /** `Accept-Language` for localised responses. Default `"en"`. */
  locale?: string
  /** Per request. Default `30000`. */
  timeoutMs?: number
  /** For `429` and `5xx`. Default `2`. Invoke calls are never retried. */
  maxRetries?: number
  /** Supply your own, e.g. for proxies or tests. Default `globalThis.fetch`. */
  fetch?: typeof fetch
}

export type EndpointClientOptions = ClientOptions & {
  /** Your account key (`cc_acc_…`). */
  accountKey: string
  /** An AI Gateway product key (`cc_gw_…`), optionally limited to this endpoint. */
  gatewayKey: string
} & (
    | {
        /** The endpoint's invoke URL as CogniCloud issued it (`endpoint.url`). Takes precedence over `baseUrl`. */
        url: string
        endpointId?: never
      }
    | {
        /** The endpoint to call; the workspace comes from the account key. */
        endpointId: string
        url?: never
      }
  )

export type CogniCloudOptions = ClientOptions & {
  /** Your account key (`cc_acc_…`), from Settings → API keys. Required; it is sent with every call. */
  accountKey: string
  /**
   * A product key for each product you call: `gateway` (`cc_gw_`), `database` (`cc_db_`), `browser` (`cc_br_`),
   * `mail` (`cc_ml_`), `agents` (`cc_ag_`), `storage` (`cc_st_`). Each call sends its product key with the account key.
   */
  productKeys?: ProductKeys
  /** The browser service's base. Default `https://cognicloud.dev/api/v1/browser`. */
  browserBaseUrl?: string
  /** The mail service's base. Default `https://cognicloud.dev/api/v1/mail`. */
  mailBaseUrl?: string
  /** The database service's base. Default `https://cognicloud.dev/api/v1/database`. */
  databaseBaseUrl?: string
  /** The web builder's base. Default `https://cognicloud.dev/api/v1/web-builder`. */
  webBuilderBaseUrl?: string
  /** The agents service's base, for agents, skills and runs. Default `https://cognicloud.dev/api/v1/agents`. */
  agentsBaseUrl?: string
  /** The marketplace's base. Default `https://cognicloud.dev/api/v1/marketplace`. */
  marketplaceBaseUrl?: string
  /** The storage service's base, for buckets and objects. Default `https://cognicloud.dev/api/v1/storage`. */
  storageBaseUrl?: string
}

/** How an invoke URL names its tenant: the tenant's name as UTF-8, in lowercase hex. */
export function encodeTenant(tenant: string): string {
  return Array.from(new TextEncoder().encode(tenant), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const defaults = {
  baseUrl: "https://cognicloud.dev/api/v1/ai-gateway",
  browserBaseUrl: "https://cognicloud.dev/api/v1/browser",
  mailBaseUrl: "https://cognicloud.dev/api/v1/mail",
  databaseBaseUrl: "https://cognicloud.dev/api/v1/database",
  webBuilderBaseUrl: "https://cognicloud.dev/api/v1/web-builder",
  agentsBaseUrl: "https://cognicloud.dev/api/v1/agents",
  marketplaceBaseUrl: "https://cognicloud.dev/api/v1/marketplace",
  storageBaseUrl: "https://cognicloud.dev/api/v1/storage",
  locale: "en",
  timeoutMs: 30_000,
  maxRetries: 2,
}

function httpConfig(options: ClientOptions): HttpConfig {
  return {
    baseUrl: options.baseUrl ?? defaults.baseUrl,
    locale: options.locale ?? defaults.locale,
    timeoutMs: options.timeoutMs ?? defaults.timeoutMs,
    maxRetries: options.maxRetries ?? defaults.maxRetries,
    fetch: options.fetch ?? globalThis.fetch,
  }
}

/** Calls one AI Gateway endpoint with an account or AI Gateway key, as the endpoint's owner. */
export class EndpointClient {
  /** The address every invoke is sent to. */
  readonly url: string
  private readonly headers: Record<string, string>
  private readonly config: HttpConfig

  constructor(options: EndpointClientOptions) {
    const { tenantHex } = checkKeys(options.accountKey, { gateway: options.gatewayKey })
    this.headers = pairHeaders(options.accountKey, { gateway: options.gatewayKey }, "gateway")
    this.config = httpConfig(options)
    this.url =
      options.url ?? `${this.config.baseUrl.replace(/\/+$/, "")}/invoke/${tenantHex}/${encodeURIComponent(options.endpointId)}`
  }

  /**
   * Sends the body through the endpoint's request mapping and returns the answer in one shape. Without a mapping the body goes to the
   * provider as it is: a chat body (`messages`) or a Responses body (`input`), with no streaming. Use `stream` to stream.
   */
  invoke(body: InvokeBody | Body): Promise<InvokeResponse> {
    return send<InvokeResponse>(this.config, {
      method: "POST",
      url: this.url,
      headers: this.headers,
      body,
      retry: false,
    })
  }

  /** A Responses call with optional MCP tools, instructions and chaining. Never retried. */
  responses(request: ResponsesRequest): Promise<ResponseResult> {
    return send<ResponseResult>(this.config, {
      method: "POST",
      url: this.url,
      headers: this.headers,
      body: request,
      retry: false,
    })
  }

  /** Embeds text through the endpoint's embedding deployment. Billed as prompt tokens. Never retried. */
  embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResult> {
    return send<EmbeddingsResult>(this.config, {
      method: "POST",
      url: `${this.url}/embeddings`,
      headers: this.headers,
      body: request,
      retry: false,
    })
  }

  /**
   * Streams a chat or Responses call: sets `stream: true` and yields events as they arrive. The call is opened before the
   * promise resolves, so a refusal rejects here, before any event. Stop early with `break`; the gateway still settles the call.
   */
  async stream(body: InvokeBody | Body | ResponsesRequest): Promise<AsyncGenerator<StreamEvent>> {
    const response = await open(this.config, {
      method: "POST",
      url: this.url,
      headers: this.headers,
      body: { ...body, stream: true },
      retry: false,
    })
    if (!response.body) {
      throw new CogniCloudError(0, "network_error", "The stream could not be read.")
    }
    return streamEvents(response.body)
  }

  /** Streams a Responses call, for tools or chaining. See `stream`. */
  streamResponses(request: ResponsesRequest): Promise<AsyncGenerator<StreamEvent>> {
    return this.stream(request)
  }
}

/** Manages AI Gateway endpoints. */
export class EndpointsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  create(input: CreateEndpointInput): Promise<CreatedEndpoint> {
    return send(this.config, { method: "POST", path: "/endpoints", headers: this.headers, body: input, retry: false })
  }

  list(): Promise<Endpoint[]> {
    return send(this.config, { method: "GET", path: "/endpoints", headers: this.headers })
  }

  get(id: string): Promise<Endpoint> {
    return send(this.config, { method: "GET", path: `/endpoints/${encodeURIComponent(id)}`, headers: this.headers })
  }

  update(id: string, patch: UpdateEndpointInput): Promise<Endpoint> {
    return send(this.config, {
      method: "PATCH",
      path: `/endpoints/${encodeURIComponent(id)}`,
      headers: this.headers,
      body: patch,
      retry: false,
    })
  }

  delete(id: string): Promise<void> {
    return send(this.config, {
      method: "DELETE",
      path: `/endpoints/${encodeURIComponent(id)}`,
      headers: this.headers,
      retry: false,
    })
  }

  usage(id: string): Promise<EndpointUsage> {
    return send(this.config, { method: "GET", path: `/endpoints/${encodeURIComponent(id)}/usage`, headers: this.headers })
  }

  /** Tokens per UTC day. Defaults to the 30 days ending today; days without calls are omitted. */
  async dailyUsage(id: string, range: DailyUsageRange = {}): Promise<DailyUsage[]> {
    const query = new URLSearchParams()
    if (range.from) query.set("from", range.from)
    if (range.to) query.set("to", range.to)
    const suffix = query.size ? `?${query}` : ""
    const body = await send<{ days: DailyUsage[] }>(this.config, {
      method: "GET",
      path: `/endpoints/${encodeURIComponent(id)}/usage/daily${suffix}`,
      headers: this.headers,
    })
    return body.days
  }
}

/** Every CogniCloud product: your account key together with one product key per product. */
export class CogniCloud {
  readonly webBuilder: WebBuilderApi
  readonly marketplace: MarketplaceApi
  private readonly options: CogniCloudOptions
  private readonly keys: ProductKeys

  constructor(options: CogniCloudOptions) {
    this.keys = options.productKeys ?? {}
    checkKeys(options.accountKey, this.keys)
    this.options = options
    const accountOnly = { authorization: `Bearer ${options.accountKey}` }
    this.webBuilder = new WebBuilderApi(this.config(options.webBuilderBaseUrl, defaults.webBuilderBaseUrl), accountOnly)
    this.marketplace = new MarketplaceApi(
      this.config(options.marketplaceBaseUrl, defaults.marketplaceBaseUrl),
      accountOnly,
    )
  }

  private config(baseUrl: string | undefined, fallback: string): HttpConfig {
    return { ...httpConfig(this.options), baseUrl: baseUrl ?? fallback }
  }

  private headers(product: ProductName): Record<string, string> {
    return pairHeaders(this.options.accountKey, this.keys, product)
  }

  /** AI Gateway endpoints. Needs `productKeys.gateway`. */
  get endpoints(): EndpointsApi {
    return new EndpointsApi(httpConfig(this.options), this.headers("gateway"))
  }

  /** Needs `productKeys.browser`. */
  get browser(): BrowserApi {
    return new BrowserApi(this.config(this.options.browserBaseUrl, defaults.browserBaseUrl), this.headers("browser"))
  }

  /** Needs `productKeys.mail`. */
  get mail(): MailApi {
    return new MailApi(this.config(this.options.mailBaseUrl, defaults.mailBaseUrl), this.headers("mail"))
  }

  /** Needs `productKeys.database`. */
  get database(): DatabaseApi {
    const config = this.config(this.options.databaseBaseUrl, defaults.databaseBaseUrl)
    return new DatabaseApi(config, this.headers("database"))
  }

  /** Buckets and objects. Needs `productKeys.storage`. */
  get storage(): StorageApi {
    return new StorageApi(this.config(this.options.storageBaseUrl, defaults.storageBaseUrl), this.headers("storage"))
  }

  /** Needs `productKeys.agents`. */
  get agents(): AgentsApi {
    return new AgentsApi(this.config(this.options.agentsBaseUrl, defaults.agentsBaseUrl), this.headers("agents"))
  }

  /** Needs `productKeys.agents`. */
  get skills(): SkillsApi {
    return new SkillsApi(this.config(this.options.agentsBaseUrl, defaults.agentsBaseUrl), this.headers("agents"))
  }

  /** Needs `productKeys.agents`. */
  get runs(): RunsApi {
    return new RunsApi(this.config(this.options.agentsBaseUrl, defaults.agentsBaseUrl), this.headers("agents"))
  }

  /** Calls one AI Gateway endpoint as its owner. Needs `productKeys.gateway`. */
  endpoint(endpointId: string): EndpointClient {
    const gatewayKey = this.keys.gateway ?? ""
    this.headers("gateway")
    return new EndpointClient({ ...this.options, gatewayKey, endpointId })
  }
}
