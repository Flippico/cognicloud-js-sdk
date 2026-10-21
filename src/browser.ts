import { send, type HttpConfig } from "./http.js"
import type {
  BrowserProfile,
  BrowserSession,
  BrowserSessionList,
  CreateBrowserSessionInput,
  ProxyCountry,
} from "./types.js"

/** Starts, lists, reads and stops browser sessions that agents drive over the Chrome DevTools Protocol. */
export class BrowserSessionsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  /** Starts a session. Its `cdpUrl` and `liveUrl` carry the session token; treat them as secrets. */
  create(input: CreateBrowserSessionInput = {}): Promise<BrowserSession> {
    return send(this.config, { method: "POST", path: "/sessions", headers: this.headers, body: input, retry: false })
  }

  /** Newest first, with the workspace's concurrency. */
  list(): Promise<BrowserSessionList> {
    return send(this.config, { method: "GET", path: "/sessions", headers: this.headers })
  }

  get(id: string): Promise<BrowserSession> {
    return send(this.config, { method: "GET", path: `/sessions/${encodeURIComponent(id)}`, headers: this.headers })
  }

  /** Closing the CDP connection does not stop a session; this does. */
  stop(id: string): Promise<BrowserSession> {
    return send(this.config, {
      method: "POST",
      path: `/sessions/${encodeURIComponent(id)}/stop`,
      headers: this.headers,
      retry: false,
    })
  }
}

/** Manages the browser product with the signed-in person's session. */
export class BrowserApi {
  readonly sessions: BrowserSessionsApi
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, token: string, tenant: string) {
    this.config = config
    this.headers = { authorization: `Bearer ${token}`, tenant_id: tenant }
    this.sessions = new BrowserSessionsApi(config, this.headers)
  }

  /** Proxy countries a session can route through. Empty until proxies are available. */
  countries(): Promise<ProxyCountry[]> {
    return send(this.config, { method: "GET", path: "/countries", headers: this.headers })
  }

  /** Profiles keep cookies between sessions. Empty until profiles are available. */
  profiles(): Promise<BrowserProfile[]> {
    return send(this.config, { method: "GET", path: "/profiles", headers: this.headers })
  }
}
