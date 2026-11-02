import { describe, expect, it } from "vitest"
import { CogniCloud as Client } from "../src/index.js"

describe("page control and agent runs", () => {
  const page = { url: "https://a.test/", title: "A", text: "", elements: [], truncated: false, screenshot: null }
  const run = { id: "r1", sessionId: "s1", status: "running", maxSteps: 25, steps: [], result: null, errorCode: null, startedAt: "t", finishedAt: null }

  it("reads, acts and runs an agent at the session's paths", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const responses = [page, page, run, run, run]
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      return Response.json(responses.shift())
    }) as typeof globalThis.fetch
    const sessions = new Client({ token: "t", fetch, browserBaseUrl: "https://b.test/v1/browser" }).browser.sessions
    await sessions.readPage("s1", { screenshot: true })
    await sessions.act("s1", { type: "click", index: 3 })
    await sessions.startAgentRun("s1", { task: "Find it", endpointId: "e1", credential: "c" })
    await sessions.getAgentRun("s1", "r1")
    await sessions.stopAgentRun("s1", "r1")
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "GET https://b.test/v1/browser/sessions/s1/page?screenshot=true",
      "POST https://b.test/v1/browser/sessions/s1/page/actions",
      "POST https://b.test/v1/browser/sessions/s1/agent-runs",
      "GET https://b.test/v1/browser/sessions/s1/agent-runs/r1",
      "POST https://b.test/v1/browser/sessions/s1/agent-runs/r1/stop",
    ])
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ type: "click", index: 3 })
    expect(JSON.parse(String(calls[2]?.init.body))).toEqual({ task: "Find it", endpointId: "e1", credential: "c" })
  })
})
import { CogniCloud, CogniCloudError } from "../src/index.js"

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

const session = {
  id: "b903c5d0",
  status: "active",
  cdpUrl: "wss://cognicloud.dev/api/v1/browser/sessions/b903c5d0/cdp?token=t",
  liveUrl: "https://cognicloud.dev/api/v1/browser/sessions/b903c5d0/live?token=t",
  profileId: null,
  proxyCountryCode: null,
  solveCaptchas: false,
  recording: false,
  screen: null,
  timeoutAt: "2026-10-21T10:15:00Z",
  startedAt: "2026-10-21T10:00:00Z",
  finishedAt: null,
}

describe("BrowserApi", () => {
  it("starts a session at the browser base with the session headers", async () => {
    const { fetch, calls } = fakeFetch(new Response(JSON.stringify(session), { status: 201 }))
    const client = new CogniCloud({ token: "amadeus-token", tenant: "acme", fetch })
    const created = await client.browser.sessions.create({ timeoutMinutes: 15 })
    expect(created).toEqual(session)
    expect(calls[0].url).toBe("https://cognicloud.dev/api/v1/browser/sessions")
    expect(calls[0].init.method).toBe("POST")
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer amadeus-token")
    expect(headers.tenant_id).toBe("acme")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ timeoutMinutes: 15 })
  })

  it("lists, reads and stops sessions", async () => {
    const stopped = { ...session, status: "stopped", cdpUrl: null, liveUrl: null, finishedAt: "2026-10-21T10:05:00Z" }
    const { fetch, calls } = fakeFetch(
      Response.json({ items: [session], concurrency: { active: 1, limit: 2 } }),
      Response.json(session),
      Response.json(stopped)
    )
    const browser = new CogniCloud({ token: "t", fetch }).browser
    expect((await browser.sessions.list()).concurrency).toEqual({ active: 1, limit: 2 })
    expect((await browser.sessions.get("b903c5d0")).status).toBe("active")
    expect((await browser.sessions.stop("b903c5d0")).status).toBe("stopped")
    expect(calls.map((call) => call.url)).toEqual([
      "https://cognicloud.dev/api/v1/browser/sessions",
      "https://cognicloud.dev/api/v1/browser/sessions/b903c5d0",
      "https://cognicloud.dev/api/v1/browser/sessions/b903c5d0/stop",
    ])
    expect(calls[2].init.method).toBe("POST")
  })

  it("uses a browser base URL when one is given", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ items: [], concurrency: { active: 0, limit: 2 } }))
    const browser = new CogniCloud({ token: "t", browserBaseUrl: "http://localhost:8095/v1/browser", fetch }).browser
    await browser.sessions.list()
    expect(calls[0].url).toBe("http://localhost:8095/v1/browser/sessions")
  })

  it("returns the service's error code when a session cannot start", async () => {
    const { fetch } = fakeFetch(
      Response.json({ error: "concurrency_limit", message: "Stop a session before starting another." }, { status: 429 })
    )
    const browser = new CogniCloud({ token: "t", fetch }).browser
    const error = await browser.sessions.create().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect((error as CogniCloudError).code).toBe("concurrency_limit")
  })

  it("saves a session as a profile and starts a session from it", async () => {
    const profile = {
      id: "5f1c9a2e",
      name: "shop login",
      sizeBytes: 20480,
      createdAt: "2026-10-21T10:20:00Z",
      lastUsedAt: null,
      expiresAt: "2027-01-19T10:20:00Z",
    }
    const { fetch, calls } = fakeFetch(
      new Response(JSON.stringify(profile), { status: 201 }),
      new Response(JSON.stringify({ ...session, profileId: profile.id }), { status: 201 }),
    )
    const client = new CogniCloud({ token: "amadeus-token", tenant: "acme", fetch })
    expect(await client.browser.sessions.saveProfile("b903c5d0", "shop login")).toEqual(profile)
    expect(calls[0].url).toBe("https://cognicloud.dev/api/v1/browser/sessions/b903c5d0/profile")
    expect(calls[0].init.method).toBe("POST")
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ name: "shop login" })
    await client.browser.sessions.create({ profileId: profile.id })
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ profileId: "5f1c9a2e" })
  })

  it("lists countries and profiles", async () => {
    const { fetch, calls } = fakeFetch(Response.json([]), Response.json([]))
    const browser = new CogniCloud({ token: "t", fetch }).browser
    expect(await browser.countries()).toEqual([])
    expect(await browser.profiles()).toEqual([])
    expect(calls.map((call) => call.url)).toEqual([
      "https://cognicloud.dev/api/v1/browser/countries",
      "https://cognicloud.dev/api/v1/browser/profiles",
    ])
  })
})
