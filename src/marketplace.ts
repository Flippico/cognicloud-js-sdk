import { pageSuffix } from "./agents.js"
import { send, type HttpConfig } from "./http.js"
import type { AgentActionList, AgentTemplate, PageOptions, TemplateListOptions } from "./types.js"

/** Agent templates to start from. Create an agent from one with `agents.create({ templateSlug, ... })`. */
export class MarketplaceApi {
  private readonly config: HttpConfig
  private readonly headers: Record<string, string>

  constructor(config: HttpConfig, headers: Record<string, string>) {
    this.config = config
    this.headers = headers
  }

  listTemplates(options: TemplateListOptions = {}): Promise<AgentTemplate[]> {
    const suffix = options.category === undefined ? "" : `?${new URLSearchParams({ category: options.category }).toString()}`
    return send(this.config, { method: "GET", path: `/templates${suffix}`, headers: this.headers })
  }

  getTemplate(slug: string): Promise<AgentTemplate> {
    return send(this.config, { method: "GET", path: `/templates/${encodeURIComponent(slug)}`, headers: this.headers })
  }

  /** What was done in the marketplace, newest first. */
  actions(options: PageOptions = {}): Promise<AgentActionList> {
    return send(this.config, { method: "GET", path: `/actions${pageSuffix(options)}`, headers: this.headers })
  }
}
