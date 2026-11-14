import { AgentsApi, RunsApi, SkillsApi } from "./agents.js"
import { BrowserApi } from "./browser.js"
import { DatabaseApi, DatabaseDataApi } from "./database.js"
import { MailApi } from "./mail.js"
import { MarketplaceApi } from "./marketplace.js"
import { CogniCloudError } from "./errors.js"
import { open, send, type HttpConfig } from "./http.js"
import { parseKey } from "./keys.js"
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
  /** An account key (`cc_acc_`) or an AI Gateway key (`cc_gw_`) from Settings → API keys. */
  apiKey: string
} & (
    | {
        /** The endpoint's invoke URL as CogniCloud issued it (`endpoint.url`). Takes precedence over `baseUrl`. */
        url: string
        endpointId?: never
      }
    | {
        /** The endpoint to call; the workspace comes from the key. */
        endpointId: string
        url?: never
      }
  )

export type CogniCloudOptions = ClientOptions & {
  /**
   * An account key (`cc_acc_`) for every product, or a product key (`cc_gw_`, `cc_db_`, `cc_br_`, `cc_ml_`, `cc_ag_`)
   * for one. Create it in the dashboard under Settings → API keys. The key names its workspace.
   */
  apiKey: string
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
  private readonly credential: string
  private readonly config: HttpConfig

  constructor(options: EndpointClientOptions) {
    const { tenantHex } = parseKey(options.apiKey)
    this.credential = options.apiKey
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
      headers: { authorization: `Bearer ${this.credential}` },
      body,
      retry: false,
    })
  }

  /** A Responses call with optional MCP tools, instructions and chaining. Never retried. */
  responses(request: ResponsesRequest): Promise<ResponseResult> {
    return send<ResponseResult>(this.config, {
      method: "POST",
      url: this.url,
      headers: { authorization: `Bearer ${this.credential}` },
      body: request,
      retry: false,
    })
  }

  /** Embeds text through the endpoint's embedding deployment. Billed as prompt tokens. Never retried. */
  embeddings(request: EmbeddingsRequest): Promise<EmbeddingsResult> {
    return send<EmbeddingsResult>(this.config, {
      method: "POST",
      url: `${this.url}/embeddings`,
      headers: { authorization: `Bearer ${this.credential}` },
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
      headers: { authorization: `Bearer ${this.credential}` },
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

/** Every CogniCloud product with one API key. */
export class CogniCloud {
  readonly endpoints: EndpointsApi
  readonly browser: BrowserApi
  readonly mail: MailApi
  readonly database: DatabaseApi
  readonly webBuilder: WebBuilderApi
  readonly agents: AgentsApi
  readonly skills: SkillsApi
  readonly runs: RunsApi
  readonly marketplace: MarketplaceApi
  private readonly options: CogniCloudOptions

  constructor(options: CogniCloudOptions) {
    parseKey(options.apiKey)
    this.options = options
    const headers = { authorization: `Bearer ${options.apiKey}` }
    const config = (baseUrl: string | undefined, fallback: string) => ({ ...httpConfig(options), baseUrl: baseUrl ?? fallback })
    this.endpoints = new EndpointsApi(httpConfig(options), headers)
    this.browser = new BrowserApi(config(options.browserBaseUrl, defaults.browserBaseUrl), headers)
    this.mail = new MailApi(config(options.mailBaseUrl, defaults.mailBaseUrl), headers)
    this.database = new DatabaseApi(config(options.databaseBaseUrl, defaults.databaseBaseUrl), headers)
    this.webBuilder = new WebBuilderApi(config(options.webBuilderBaseUrl, defaults.webBuilderBaseUrl), headers)
    const agents = config(options.agentsBaseUrl, defaults.agentsBaseUrl)
    this.agents = new AgentsApi(agents, headers)
    this.skills = new SkillsApi(agents, headers)
    this.runs = new RunsApi(agents, headers)
    this.marketplace = new MarketplaceApi(config(options.marketplaceBaseUrl, defaults.marketplaceBaseUrl), headers)
  }

  /** Calls one AI Gateway endpoint with this key, as its owner. */
  endpoint(endpointId: string): EndpointClient {
    return new EndpointClient({ ...this.options, endpointId })
  }
}
