import { send, type HttpConfig } from "./http.js"

export type ApplicationStatus = "building" | "running" | "failed" | "paused" | "unknown"

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
  /** Whether pushes to the branch build and deploy the site. */
  autoDeploy: boolean
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

/** A field left out stays as it is. */
export type UpdateApplicationInput = Partial<Omit<CreateApplicationInput, "subdomain">>

export type WebBuilderAction = {
  id: string
  action: string
  applicationId: string | null
  name: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  outcome: "started" | "succeeded" | "failed"
  errorCode: string | null
}

export type WebBuilderActionList = {
  items: WebBuilderAction[]
  nextCursor: string | null
}

export type WebBuilderActionListOptions = {
  limit?: number
  cursor?: string
  applicationId?: string
}

export type GithubRepository = {
  fullName: string
  url: string
  defaultBranch: string
  private: boolean
}

export type GithubRepositories = {
  login: string
  items: GithubRepository[]
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

  /** Changes build settings and starts a build. */
  update(id: string, changes: UpdateApplicationInput): Promise<Application> {
    return send(this.config, {
      method: "PATCH",
      path: `/applications/${encodeURIComponent(id)}`,
      headers: this.headers,
      body: changes,
      retry: false,
    })
  }

  /** Takes the site offline and keeps its settings and subdomain. */
  pause(id: string): Promise<Application> {
    return this.post(id, "pause")
  }

  /** Builds the site again after `pause`. */
  resume(id: string): Promise<Application> {
    return this.post(id, "resume")
  }

  /** The web server's latest request logs. */
  async runtimeLogs(id: string): Promise<string> {
    const body = await send<{ logs: string }>(this.config, {
      method: "GET",
      path: `/applications/${encodeURIComponent(id)}/runtime-logs`,
      headers: this.headers,
    })
    return body.logs
  }

  /** Creates a public GitHub repository from the starter and builds from it. */
  createRepository(id: string, name: string): Promise<Application> {
    return send(this.config, {
      method: "POST",
      path: `/applications/${encodeURIComponent(id)}/repository`,
      headers: this.headers,
      body: { name },
      retry: false,
    })
  }

  /** Turns on building and deploying on every push to the branch. */
  enableAutoDeploy(id: string): Promise<Application> {
    return send(this.config, {
      method: "PUT",
      path: `/applications/${encodeURIComponent(id)}/auto-deploy`,
      headers: this.headers,
      retry: false,
    })
  }

  disableAutoDeploy(id: string): Promise<Application> {
    return send(this.config, {
      method: "DELETE",
      path: `/applications/${encodeURIComponent(id)}/auto-deploy`,
      headers: this.headers,
      retry: false,
    })
  }

  /** Newest first. Pass `applicationId` for one application's history. */
  actions(options: WebBuilderActionListOptions = {}): Promise<WebBuilderActionList> {
    const query = new URLSearchParams()
    if (options.limit !== undefined) query.set("limit", String(options.limit))
    if (options.cursor !== undefined) query.set("cursor", options.cursor)
    if (options.applicationId !== undefined) query.set("applicationId", options.applicationId)
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    return send(this.config, { method: "GET", path: `/actions${suffix}`, headers: this.headers })
  }

  /** The address to send the person to. GitHub returns to `redirectUri` with `code` and `state` for `connectGithub`. */
  authorizeGithub(redirectUri: string): Promise<{ authorizeUrl: string }> {
    return send(this.config, {
      method: "POST",
      path: "/github/authorize",
      headers: this.headers,
      body: { redirectUri },
      retry: false,
    })
  }

  connectGithub(code: string, state: string): Promise<{ login: string }> {
    return send(this.config, {
      method: "POST",
      path: "/github/connect",
      headers: this.headers,
      body: { code, state },
      retry: false,
    })
  }

  /** The 100 most recently pushed repositories. */
  githubRepositories(): Promise<GithubRepositories> {
    return send(this.config, { method: "GET", path: "/github/repositories", headers: this.headers })
  }

  /** Removes this service's access. Deployed applications keep running. */
  disconnectGithub(): Promise<void> {
    return send(this.config, { method: "DELETE", path: "/github", headers: this.headers, retry: false })
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

  private post(id: string, action: string): Promise<Application> {
    return send(this.config, {
      method: "POST",
      path: `/applications/${encodeURIComponent(id)}/${action}`,
      headers: this.headers,
      retry: false,
    })
  }
}
