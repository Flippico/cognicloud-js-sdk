import { send, type HttpConfig } from "./http.js"
import type {
  Body,
  CreatedEndpoint,
  CreateEndpointInput,
  DailyUsage,
  DailyUsageRange,
  Endpoint,
  EndpointUsage,
  InvokeBody,
  InvokeResponse,
  UpdateEndpointInput,
} from "./types.js"

/** Options shared by every client. */
export type ClientOptions = {
  /** Point at another environment. Default `https://cognicloud.flippi.co/api/v1/ai-gateway`. */
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
  credential: string
} & (
    | {
        /** The endpoint's invoke URL as CogniCloud issued it (`endpoint.url`). Takes precedence over `baseUrl`. */
        url: string
        endpointId?: never
        tenant?: never
      }
    | {
        endpointId: string
        /** The tenant the endpoint belongs to. Default `"cognicloud"`, the platform tenant. */
        tenant?: string
        url?: never
      }
  )

export type CogniCloudOptions = ClientOptions & {
  /** The signed-in person's Amadeus session token, sent as `Authorization: Bearer`. */
  token: string
  /** The tenant (workspace) to manage, sent as the `tenant_id` header. Default `"cognicloud"`. */
  tenant?: string
}

const defaultTenant = "cognicloud"

/** How an invoke URL names its tenant: the tenant's name as UTF-8, in lowercase hex. */
export function encodeTenant(tenant: string): string {
  return Array.from(new TextEncoder().encode(tenant), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const defaults = {
  baseUrl: "https://cognicloud.flippi.co/api/v1/ai-gateway",
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

/** Calls one AI Gateway endpoint with its own credential. */
export class EndpointClient {
  /** The address every invoke is sent to. */
  readonly url: string
  private readonly credential: string
  private readonly config: HttpConfig

  constructor(options: EndpointClientOptions) {
    this.credential = options.credential
    this.config = httpConfig(options)
    this.url =
      options.url ??
      `${this.config.baseUrl.replace(/\/+$/, "")}/invoke/${encodeTenant(options.tenant ?? defaultTenant)}/${encodeURIComponent(options.endpointId)}`
  }

  /**
   * Sends the body through the endpoint's request mapping and returns the answer in one shape. Without a mapping the body goes to the
   * provider as it is: plain-text messages only, no images, tools or streaming.
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
}

/** Manages AI Gateway endpoints with the signed-in person's session. */
export class EndpointsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, token: string, tenant: string = defaultTenant) {
    this.config = config
    this.headers = { authorization: `Bearer ${token}`, tenant_id: tenant }
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

  /** Issues a new credential. The old one stops working at once. */
  rotateCredential(id: string): Promise<{ secret: string }> {
    return send(this.config, {
      method: "POST",
      path: `/endpoints/${encodeURIComponent(id)}/credential/rotate`,
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

/** Manage CogniCloud resources. This first version covers AI Gateway endpoints. */
export class CogniCloud {
  readonly endpoints: EndpointsApi

  constructor(options: CogniCloudOptions) {
    this.endpoints = new EndpointsApi(httpConfig(options), options.token, options.tenant)
  }
}
