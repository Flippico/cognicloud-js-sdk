import { send, type HttpConfig } from "./http.js"

export type ApplicationStatus = "building" | "running" | "failed" | "unknown"

export type Application = {
  id: string
  subdomain: string
  url: string
  status: ApplicationStatus
  repoUrl: string | null
  branch: string | null
  buildCommand: string
  outputDir: string
  createdAt: string
}

export type CreateApplicationInput = {
  /** The application is served at `https://<subdomain>.cognicloud.dev`. */
  subdomain: string
  /** A public GitHub, GitLab or Bitbucket repository. Leave out to build the React starter. */
  repoUrl?: string
  /** Default `main`. Needs `repoUrl`. */
  branch?: string
  /** Default `npm run build`. */
  buildCommand?: string
  /** The folder the build writes to. Default `dist`. */
  outputDir?: string
}

/** Builds React applications and hosts them on their own subdomain. */
export class WebBuilderApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  /** Newest first. */
  async list(): Promise<Application[]> {
    const body = await send<{ items: Application[] }>(this.config, { method: "GET", path: "/applications", headers: this.headers })
    return body.items
  }

  /** Starts the build and returns at once. Read `status` and `logs` to follow it. */
  create(input: CreateApplicationInput): Promise<Application> {
    return send(this.config, { method: "POST", path: "/applications", headers: this.headers, body: input, retry: false })
  }

  get(id: string): Promise<Application> {
    return send(this.config, { method: "GET", path: `/applications/${encodeURIComponent(id)}`, headers: this.headers })
  }

  /** Builds the latest code. The running version keeps serving until the new one is ready. */
  redeploy(id: string): Promise<Application> {
    return send(this.config, {
      method: "POST",
      path: `/applications/${encodeURIComponent(id)}/redeploy`,
      headers: this.headers,
      retry: false,
    })
  }

  /** The last 500 lines of the latest build. */
  async logs(id: string): Promise<string> {
    const body = await send<{ logs: string }>(this.config, {
      method: "GET",
      path: `/applications/${encodeURIComponent(id)}/logs`,
      headers: this.headers,
    })
    return body.logs
  }

  /** Takes the site offline and frees its subdomain. This cannot be undone. */
  delete(id: string): Promise<void> {
    return send(this.config, {
      method: "DELETE",
      path: `/applications/${encodeURIComponent(id)}`,
      headers: this.headers,
      retry: false,
    })
  }
}
