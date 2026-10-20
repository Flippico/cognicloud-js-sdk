import { send, type HttpConfig } from "./http.js"
import type {
  Body,
  CreatedEndpoint,
  CreateEndpointInput,
  DailyUsage,
  DailyUsageRange,
  Endpoint,
  EndpointUsage,
  InvokeResponse,
  UpdateEndpointInput,
} from "./types.js"

/** Options shared by every client. */
export type ClientOptions = {
  /** Point at another environment. Default `https://api.cognicloud.dev/v1`. */
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
  endpointId: string
  credential: string
}

export type CogniCloudOptions = ClientOptions & {
  /** The signed-in person's Amadeus session token, sent as `x-amadeus-token`. */
  token: string
}

const defaults = {
  baseUrl: "https://api.cognicloud.dev/v1",
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
  readonly endpointId: string
  private readonly credential: string
  private readonly config: HttpConfig

  constructor(options: EndpointClientOptions) {
    this.endpointId = options.endpointId
    this.credential = options.credential
    this.config = httpConfig(options)
  }

  /** Sends the body through the endpoint's request mapping and returns the answer in one shape. */
  invoke(body: Body): Promise<InvokeResponse> {
    return send<InvokeResponse>(this.config, {
      method: "POST",
      path: `/invoke/${encodeURIComponent(this.endpointId)}`,
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

  constructor(config: HttpConfig, token: string) {
    this.config = config
    this.headers = { "x-amadeus-token": token }
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
    this.endpoints = new EndpointsApi(httpConfig(options), options.token)
  }
}
