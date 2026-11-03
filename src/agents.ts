import { CogniCloudError } from "./errors.js"
import { send, type HttpConfig } from "./http.js"
import type {
  Agent,
  AgentActionList,
  AgentKey,
  CreateAgentInput,
  CreatedAgent,
  CreateSkillInput,
  PageOptions,
  PublishAgentInput,
  Run,
  RunAndWaitOptions,
  RunList,
  Skill,
  SkillVersion,
  UpdateAgentInput,
  UpdateSkillInput,
} from "./types.js"

export function pageSuffix(options: PageOptions): string {
  const query = new URLSearchParams()
  if (options.limit !== undefined) query.set("limit", String(options.limit))
  if (options.cursor !== undefined) query.set("cursor", options.cursor)
  return query.size > 0 ? `?${query.toString()}` : ""
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The workspace's `cga_` keys. Keys are created in the dashboard. */
export class AgentKeysApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  list(): Promise<AgentKey[]> {
    return send(this.config, { method: "GET", path: "/keys", headers: this.headers })
  }

  revoke(id: string): Promise<void> {
    return send(this.config, { method: "DELETE", path: `/keys/${encodeURIComponent(id)}`, headers: this.headers, retry: false })
  }
}

/** Agents of the workspace: what they are told, which endpoint decides, and how long they may run. */
export class AgentsApi {
  readonly keys: AgentKeysApi
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
    this.keys = new AgentKeysApi(config, headers)
  }

  list(): Promise<Agent[]> {
    return send(this.config, { method: "GET", path: "/agents", headers: this.headers })
  }

  get(id: string): Promise<Agent> {
    return send(this.config, { method: "GET", path: this.path(id), headers: this.headers })
  }

  /** Returns the agent with its `ccag_` credential, which is shown only here. */
  create(input: CreateAgentInput): Promise<CreatedAgent> {
    return send(this.config, { method: "POST", path: "/agents", headers: this.headers, body: input, retry: false })
  }

  update(id: string, changes: UpdateAgentInput): Promise<Agent> {
    return send(this.config, { method: "PATCH", path: this.path(id), headers: this.headers, body: changes, retry: false })
  }

  delete(id: string): Promise<void> {
    return send(this.config, { method: "DELETE", path: this.path(id), headers: this.headers, retry: false })
  }

  /** Issues a new credential. The old one stops working at once. */
  rotateCredential(id: string): Promise<{ secret: string }> {
    return send(this.config, { method: "POST", path: `${this.path(id)}/credential/rotate`, headers: this.headers, retry: false })
  }

  /** Planned: the service answers `503` until publishing to the marketplace is released. */
  publish(id: string, input: PublishAgentInput): Promise<Agent> {
    return send(this.config, { method: "POST", path: `${this.path(id)}/publish`, headers: this.headers, body: input, retry: false })
  }

  /** Planned: the service answers `503` until publishing to the marketplace is released. */
  unpublish(id: string): Promise<Agent> {
    return send(this.config, { method: "POST", path: `${this.path(id)}/unpublish`, headers: this.headers, retry: false })
  }

  /** What was done in the agents service, newest first. */
  actions(options: PageOptions = {}): Promise<AgentActionList> {
    return send(this.config, { method: "GET", path: `/actions${pageSuffix(options)}`, headers: this.headers })
  }

  private path(id: string): string {
    return `/agents/${encodeURIComponent(id)}`
  }
}

/** Instructions shared between agents. Every change keeps the previous version. */
export class SkillsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  list(): Promise<Skill[]> {
    return send(this.config, { method: "GET", path: "/skills", headers: this.headers })
  }

  get(id: string): Promise<Skill> {
    return send(this.config, { method: "GET", path: this.path(id), headers: this.headers })
  }

  create(input: CreateSkillInput): Promise<Skill> {
    return send(this.config, { method: "POST", path: "/skills", headers: this.headers, body: input, retry: false })
  }

  update(id: string, changes: UpdateSkillInput): Promise<Skill> {
    return send(this.config, { method: "PATCH", path: this.path(id), headers: this.headers, body: changes, retry: false })
  }

  delete(id: string): Promise<void> {
    return send(this.config, { method: "DELETE", path: this.path(id), headers: this.headers, retry: false })
  }

  versions(id: string): Promise<SkillVersion[]> {
    return send(this.config, { method: "GET", path: `${this.path(id)}/versions`, headers: this.headers })
  }

  private path(id: string): string {
    return `/skills/${encodeURIComponent(id)}`
  }
}

/** Runs of an agent. A client made with the agent's `ccag_` credential can use these and nothing else. */
export class RunsApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  /** Starts a run and returns at once with `status` set to `running`. Never retried. */
  start(agentId: string, input: string): Promise<Run> {
    return send(this.config, {
      method: "POST",
      path: `/agents/${encodeURIComponent(agentId)}/runs`,
      headers: this.headers,
      body: { input },
      retry: false,
    })
  }

  get(runId: string): Promise<Run> {
    return send(this.config, { method: "GET", path: `/runs/${encodeURIComponent(runId)}`, headers: this.headers })
  }

  /** Newest first. */
  list(agentId: string, options: PageOptions = {}): Promise<RunList> {
    return send(this.config, {
      method: "GET",
      path: `/agents/${encodeURIComponent(agentId)}/runs${pageSuffix(options)}`,
      headers: this.headers,
    })
  }

  stop(runId: string): Promise<Run> {
    return send(this.config, { method: "POST", path: `/runs/${encodeURIComponent(runId)}/stop`, headers: this.headers, retry: false })
  }

  /**
   * Starts a run and polls it until it is no longer `running`. A failed or stopped run is returned, not thrown. Throws a
   * `timeout` error when `timeoutMs` passes first; the run keeps going until it ends or is stopped.
   */
  async runAndWait(agentId: string, input: string, options: RunAndWaitOptions = {}): Promise<Run> {
    const pollIntervalMs = options.pollIntervalMs ?? 2_000
    const deadline = performance.now() + (options.timeoutMs ?? 900_000)
    let run = await this.start(agentId, input)
    while (run.status === "running") {
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        throw new CogniCloudError(0, "timeout", `Run ${run.id} was still running when timeoutMs passed.`)
      }
      await sleep(Math.min(pollIntervalMs, remaining))
      run = await this.get(run.id)
    }
    return run
  }
}
