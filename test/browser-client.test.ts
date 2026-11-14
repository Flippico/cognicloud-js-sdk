import { describe, expect, it } from "vitest"
import { CogniCloud, CogniCloudError } from "../src/index.js"
import { KEY, KEYS, PRODUCT_KEYS } from "./keys.js"

const BROWSER_KEY = PRODUCT_KEYS.browser
const browserClient = (fetch: typeof globalThis.fetch) =>
  new CogniCloud({ accountKey: KEY, productKeys: { browser: BROWSER_KEY }, fetch })

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

describe("a browser key", () => {
  it("refuses a missing or blank account key before any request is made", () => {
    for (const key of ["", "  ", undefined]) {
      expect(() => new CogniCloud({ accountKey: key as unknown as string })).toThrow(CogniCloudError)
    }
    expect(() => new CogniCloud({ accountKey: "" })).toThrow(expect.objectContaining({ code: "missing_account_key" }))
    expect(() => new CogniCloud({ accountKey: BROWSER_KEY })).toThrow(expect.objectContaining({ code: "invalid_key" }))
  })

  it("sends only the key, with no tenant header, to the browser product", async () => {
    const { fetch, calls } = fakeFetch(Response.json([]), Response.json([]))
    const browser = browserClient(fetch).browser
    expect(await browser.countries()).toEqual([])
    expect(await browser.profiles()).toEqual([])
    expect(calls.map((call) => call.url)).toEqual([
      "https://cognicloud.dev/api/v1/browser/countries",
      "https://cognicloud.dev/api/v1/browser/profiles",
    ])
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>
      expect(headers.authorization).toBe(`Bearer ${BROWSER_KEY}`)
      expect(headers["x-cognicloud-account-key"]).toBe(KEY)
      expect(headers.tenant_id).toBeUndefined()
    }
  })

  it("sends a window size and returns the one the session has", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json(
        {
          id: "b903c5d0",
          status: "active",
          cdpUrl: "wss://example.test/cdp",
          liveUrl: "https://example.test/live",
          profileId: null,
          proxyCountryCode: null,
          solveCaptchas: false,
          recording: false,
          screen: { width: 1280, height: 720 },
          timeoutAt: "2026-10-21T10:15:00Z",
          startedAt: "2026-10-21T10:00:00Z",
          finishedAt: null,
        },
        { status: 201 },
      ),
    )
    const session = await browserClient(fetch).browser.sessions.create({
      timeoutMinutes: 15,
      screen: { width: 1280, height: 720 },
    })
    expect(session.screen).toEqual({ width: 1280, height: 720 })
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ timeoutMinutes: 15, screen: { width: 1280, height: 720 } })
  })
})

describe("profile upload", () => {
  it("sends the archive as the raw body, named in the query", async () => {
    const profile = { id: "5f1c9a2e", name: "Shop", sizeBytes: 3, createdAt: "2026-10-21T10:20:00Z", lastUsedAt: null, expiresAt: "2027-01-19T10:20:00Z" }
    const { fetch, calls } = fakeFetch(new Response(JSON.stringify(profile), { status: 201 }))
    const archive = new Uint8Array([31, 139, 8])
    const created = await browserClient(fetch).browser.importProfile("Shop account", archive)
    expect(created).toEqual(profile)
    expect(calls[0].url).toBe("https://cognicloud.dev/api/v1/browser/profiles/import?name=Shop%20account")
    expect(calls[0].init.method).toBe("POST")
    expect((calls[0].init.headers as Record<string, string>)["content-type"]).toBe("application/gzip")
    expect(calls[0].init.body).toBe(archive)
  })
})
