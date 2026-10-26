import { describe, expect, it } from "vitest"
import { CogniCloudBrowser, CogniCloudError } from "../src/index.js"

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

describe("CogniCloudBrowser", () => {
  it("refuses a missing or blank key before any request is made", () => {
    for (const key of ["", "  ", undefined]) {
      expect(() => new CogniCloudBrowser({ key: key as unknown as string })).toThrow(CogniCloudError)
    }
    try {
      new CogniCloudBrowser({ key: "" })
    } catch (error) {
      expect((error as CogniCloudError).code).toBe("missing_key")
    }
  })

  it("sends only the key, with no tenant header, to the browser product", async () => {
    const { fetch, calls } = fakeFetch(Response.json([]), Response.json([]))
    const browser = new CogniCloudBrowser({ key: "cgb_abc", fetch }).browser
    expect(await browser.countries()).toEqual([])
    expect(await browser.profiles()).toEqual([])
    expect(calls.map((call) => call.url)).toEqual([
      "https://cognicloud.flippi.co/api/v1/browser/countries",
      "https://cognicloud.flippi.co/api/v1/browser/profiles",
    ])
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>
      expect(headers.authorization).toBe("Bearer cgb_abc")
      expect(headers.tenant_id).toBeUndefined()
    }
  })
})
