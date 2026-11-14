import { describe, expect, it } from "vitest"
import { CogniCloud, CogniCloudError } from "../src/index.js"

const KEY = `cc_acc_636f676e69636c6f7564_${"a".repeat(64)}`

type Call = { url: string; init: RequestInit }

function fakeFetch(...responses: Response[]) {
  const calls: Call[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error("unexpected request")
    return next
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

function lines(calls: Call[]) {
  return calls.map((call) => `${call.init.method} ${call.url}`)
}

function bodyOf(call: Call | undefined) {
  return call?.init.body === undefined ? undefined : JSON.parse(String(call.init.body))
}

const agent = {
  id: "a1",
  name: "Researcher",
  description: "",
  endpointId: "e1",
  instructions: "Find things.",
  tools: [],
  databaseId: null,
  maxSteps: 10,
  timeoutSeconds: 300,
  status: "active",
  invokeUrl: "https://cognicloud.dev/api/v1/agents/invoke/a1",
  credentialPrefix: "ccag_ab",
  templateSlug: null,
  skillIds: [],
  visibility: "private",
  listingSlug: null,
  publishedVersion: null,
  hasUnpublishedChanges: false,
  createdAt: "2026-11-03T10:00:00Z",
}

const skill = {
  id: "s1",
  name: "Cite",
  description: "Cite sources",
  body: "Always cite.",
  version: 1,
  createdAt: "2026-11-03T10:00:00Z",
  updatedAt: "2026-11-03T10:00:00Z",
}

function run(status: string, output: string | null = null) {
  return {
    id: "r1",
    agentId: "a1",
    status,
    input: "Hi",
    output,
    steps: [],
    errorCode: null,
    errorMessage: null,
    maxSteps: 10,
    timeoutSeconds: 300,
    createdAt: "2026-11-03T10:00:00Z",
    finishedAt: status === "running" ? null : "2026-11-03T10:01:00Z",
  }
}

const base = "https://cognicloud.dev/api/v1/agents"

describe("CogniCloud.agents", () => {
  it("creates an agent with the session and tenant", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ agent, credential: { secret: "ccag_x_y" } }, { status: 201 }))
    const client = new CogniCloud({ apiKey: KEY, fetch })
    const input = { name: "Researcher", endpointId: "e1", instructions: "Find things.", tools: [], maxSteps: 10, timeoutSeconds: 300 }
    const created = await client.agents.create(input)
    expect(created.credential.secret).toBe("ccag_x_y")
    expect(lines(calls)).toEqual([`POST ${base}/agents`])
    expect(bodyOf(calls[0])).toEqual(input)
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`)
    expect(headers.get("tenant_id")).toBeNull()
  })

  it("lists, reads, updates, deletes and rotates", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json([agent]),
      Response.json(agent),
      Response.json({ ...agent, status: "paused" }),
      new Response(null, { status: 204 }),
      Response.json({ secret: "ccag_new" }),
    )
    const api = new CogniCloud({ apiKey: KEY, fetch }).agents
    expect(await api.list()).toEqual([agent])
    await api.get("a1")
    expect((await api.update("a1", { status: "paused", databaseId: null })).status).toBe("paused")
    await api.delete("a1")
    expect(await api.rotateCredential("a1")).toEqual({ secret: "ccag_new" })
    expect(lines(calls)).toEqual([
      `GET ${base}/agents`,
      `GET ${base}/agents/a1`,
      `PATCH ${base}/agents/a1`,
      `DELETE ${base}/agents/a1`,
      `POST ${base}/agents/a1/credential/rotate`,
    ])
    expect(bodyOf(calls[2])).toEqual({ status: "paused", databaseId: null })
  })

  it("publishes and unpublishes, which the service does not offer yet", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ error: "unavailable", message: "planned" }, { status: 503 }),
      Response.json({ error: "unavailable", message: "planned" }, { status: 503 }),
    )
    const api = new CogniCloud({ apiKey: KEY, fetch }).agents
    const input = { category: "research", publisherName: "Acme", language: "en" }
    const published = await api.publish("a1", input).catch((caught: unknown) => caught)
    expect((published as CogniCloudError).status).toBe(503)
    await api.unpublish("a1").catch(() => undefined)
    expect(lines(calls)).toEqual([`POST ${base}/agents/a1/publish`, `POST ${base}/agents/a1/unpublish`])
    expect(bodyOf(calls[0])).toEqual(input)
  })

  it("lists actions", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ items: [], nextCursor: null }), Response.json({ items: [], nextCursor: null }))
    const api = new CogniCloud({ apiKey: KEY, fetch, agentsBaseUrl: "https://agents.test/v1/agents" }).agents
    await api.actions()
    await api.actions({ limit: 5, cursor: "c|1" })
    expect(lines(calls)).toEqual([
      "GET https://agents.test/v1/agents/actions",
      "GET https://agents.test/v1/agents/actions?limit=5&cursor=c%7C1",
    ])
  })
})

describe("CogniCloud.skills", () => {
  it("manages skills and reads their versions", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json([skill]),
      Response.json(skill, { status: 201 }),
      Response.json(skill),
      Response.json({ ...skill, version: 2 }),
      Response.json([{ version: 1, name: "Cite", description: "Cite sources", body: "Always cite.", createdAt: "2026-11-03T10:00:00Z" }]),
      new Response(null, { status: 204 }),
    )
    const api = new CogniCloud({ apiKey: KEY, fetch }).skills
    expect(await api.list()).toEqual([skill])
    await api.create({ name: "Cite", description: "Cite sources", body: "Always cite." })
    await api.get("s1")
    expect((await api.update("s1", { body: "Cite twice." })).version).toBe(2)
    expect((await api.versions("s1"))[0]?.version).toBe(1)
    await api.delete("s1")
    expect(lines(calls)).toEqual([
      `GET ${base}/skills`,
      `POST ${base}/skills`,
      `GET ${base}/skills/s1`,
      `PATCH ${base}/skills/s1`,
      `GET ${base}/skills/s1/versions`,
      `DELETE ${base}/skills/s1`,
    ])
    expect(bodyOf(calls[1])).toEqual({ name: "Cite", description: "Cite sources", body: "Always cite." })
    expect(bodyOf(calls[3])).toEqual({ body: "Cite twice." })
  })
})

describe("CogniCloud.runs", () => {
  it("starts, lists, reads and stops runs", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json(run("running"), { status: 202 }),
      Response.json({ items: [run("running")], nextCursor: "next" }),
      Response.json({ items: [], nextCursor: null }),
      Response.json(run("running")),
      Response.json(run("stopped")),
    )
    const api = new CogniCloud({ apiKey: KEY, fetch }).runs
    expect((await api.start("a1", "Hi")).status).toBe("running")
    expect((await api.list("a1")).nextCursor).toBe("next")
    await api.list("a1", { limit: 10, cursor: "next" })
    await api.get("r1")
    expect((await api.stop("r1")).status).toBe("stopped")
    expect(lines(calls)).toEqual([
      `POST ${base}/agents/a1/runs`,
      `GET ${base}/agents/a1/runs`,
      `GET ${base}/agents/a1/runs?limit=10&cursor=next`,
      `GET ${base}/runs/r1`,
      `POST ${base}/runs/r1/stop`,
    ])
    expect(bodyOf(calls[0])).toEqual({ input: "Hi" })
  })

  it("does not retry a start and reports the service's refusal", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ error: "limit_reached", message: "3 running" }, { status: 429 }))
    const error = await new CogniCloud({ apiKey: KEY, fetch }).runs.start("a1", "Hi").catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect((error as CogniCloudError).code).toBe("limit_reached")
    expect(calls).toHaveLength(1)
  })

  it("runs and waits until the run finishes", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json(run("running"), { status: 202 }),
      Response.json(run("running")),
      Response.json(run("completed", "Done.")),
    )
    const api = new CogniCloud({ apiKey: KEY, fetch }).runs
    const finished = await api.runAndWait("a1", "Hi", { pollIntervalMs: 1 })
    expect(finished.status).toBe("completed")
    expect(finished.output).toBe("Done.")
    expect(lines(calls)).toEqual([`POST ${base}/agents/a1/runs`, `GET ${base}/runs/r1`, `GET ${base}/runs/r1`])
  })

  it("returns a failed run without throwing", async () => {
    const { fetch } = fakeFetch(Response.json({ ...run("failed"), errorCode: "max_steps" }, { status: 202 }))
    const finished = await new CogniCloud({ apiKey: KEY, fetch }).runs.runAndWait("a1", "Hi", { pollIntervalMs: 1 })
    expect(finished.errorCode).toBe("max_steps")
  })

  it("gives up with a timeout error when the run outlasts timeoutMs", async () => {
    const responses = [Response.json(run("running"), { status: 202 })]
    for (let index = 0; index < 50; index++) responses.push(Response.json(run("running")))
    const { fetch } = fakeFetch(...responses)
    const error = await new CogniCloud({ apiKey: KEY, fetch }).runs
      .runAndWait("a1", "Hi", { pollIntervalMs: 5, timeoutMs: 20 })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect((error as CogniCloudError).code).toBe("timeout")
    expect((error as CogniCloudError).status).toBe(0)
  })

  it("polls at least once before timing out when the interval is longer than the timeout", async () => {
    const responses = [Response.json(run("running"), { status: 202 })]
    for (let index = 0; index < 5; index++) responses.push(Response.json(run("running")))
    const { fetch, calls } = fakeFetch(...responses)
    const error = await new CogniCloud({ apiKey: KEY, fetch }).runs
      .runAndWait("a1", "Hi", { timeoutMs: 1_000 })
      .catch((caught: unknown) => caught)
    expect((error as CogniCloudError).code).toBe("timeout")
    expect(lines(calls)[0]).toBe(`POST ${base}/agents/a1/runs`)
    expect(lines(calls).slice(1)).toContain(`GET ${base}/runs/r1`)
  })

  it("returns a run that completes just before the timeout", async () => {
    const started = performance.now()
    const calls: string[] = []
    const fetch = (async (input: string | URL | Request) => {
      calls.push(String(input))
      if (calls.length === 1) return Response.json(run("running"), { status: 202 })
      return Response.json(performance.now() - started >= 900 ? run("completed", "Done.") : run("running"))
    }) as typeof globalThis.fetch
    const finished = await new CogniCloud({ apiKey: KEY, fetch }).runs.runAndWait("a1", "Hi", {
      pollIntervalMs: 600,
      timeoutMs: 1_000,
    })
    expect(finished.status).toBe("completed")
  })

  it("sends an agent key to every product, with no tenant header", async () => {
    const agentKey = `cc_ag_636f676e69636c6f7564_${"c".repeat(64)}`
    const { fetch, calls } = fakeFetch(
      Response.json(run("running")),
      Response.json({ error: "forbidden", message: "This key does not reach that product." }, { status: 403 }),
    )
    const client = new CogniCloud({ apiKey: agentKey, fetch })
    await client.runs.get("r1")
    const error = await client.browser.countries().catch((caught: unknown) => caught)
    expect((error as CogniCloudError).status).toBe(403)
    for (const call of calls) {
      const headers = new Headers(call.init.headers)
      expect(headers.get("authorization")).toBe(`Bearer ${agentKey}`)
      expect(headers.get("tenant_id")).toBeNull()
    }
  })

  it("refuses a retired agent credential before any request", () => {
    expect(() => new CogniCloud({ apiKey: "ccag_6163_abc" })).toThrow(/ccag_ were retired/)
  })
})

describe("CogniCloud.marketplace", () => {
  it("lists and reads templates and lists actions", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json([]),
      Response.json([]),
      Response.json({ slug: "web-researcher" }),
      Response.json({ items: [], nextCursor: null }),
    )
    const api = new CogniCloud({ apiKey: KEY, fetch }).marketplace
    await api.listTemplates()
    await api.listTemplates({ category: "research" })
    await api.getTemplate("web-researcher")
    await api.actions({ limit: 20 })
    expect(lines(calls)).toEqual([
      "GET https://cognicloud.dev/api/v1/marketplace/templates",
      "GET https://cognicloud.dev/api/v1/marketplace/templates?category=research",
      "GET https://cognicloud.dev/api/v1/marketplace/templates/web-researcher",
      "GET https://cognicloud.dev/api/v1/marketplace/actions?limit=20",
    ])
    expect(new Headers(calls[0]?.init.headers).get("tenant_id")).toBeNull()
  })

  it("takes another base", async () => {
    const { fetch, calls } = fakeFetch(Response.json([]))
    await new CogniCloud({ apiKey: KEY, fetch, marketplaceBaseUrl: "https://mp.test/v1/marketplace" }).marketplace.listTemplates()
    expect(calls[0]?.url).toBe("https://mp.test/v1/marketplace/templates")
  })
})
