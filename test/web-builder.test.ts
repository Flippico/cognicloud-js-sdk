import { describe, expect, it } from "vitest"
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

const application = {
  id: "7c1f0c2e-6a5b-4d3e-9f10-1a2b3c4d5e6f",
  subdomain: "shop",
  url: "https://shop.cognicloud.dev",
  status: "building",
  repoUrl: null,
  branch: null,
  buildCommand: "npm run build",
  outputDir: "dist",
  createdAt: "2026-11-01T10:00:00Z",
}

describe("CogniCloud.webBuilder", () => {
  it("creates an application with the session and tenant", async () => {
    const { fetch, calls } = fakeFetch(Response.json(application, { status: 201 }))
    const client = new CogniCloud({ token: "session-token", tenant: "acme", fetch })
    const created = await client.webBuilder.create({ subdomain: "shop" })
    expect(created.url).toBe("https://shop.cognicloud.dev")
    expect(calls[0]?.url).toBe("https://cognicloud.dev/api/v1/web-builder/applications")
    expect(calls[0]?.init.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ subdomain: "shop" })
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer session-token")
    expect(new Headers(calls[0]?.init.headers).get("tenant_id")).toBe("acme")
  })

  it("lists, reads, redeploys, reads logs and deletes", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ items: [application] }),
      Response.json(application),
      Response.json(application),
      Response.json({ logs: "built" }),
      new Response(null, { status: 204 }),
    )
    const api = new CogniCloud({ token: "t", fetch, webBuilderBaseUrl: "https://wb.test/v1" }).webBuilder
    expect(await api.list()).toEqual([application])
    await api.get(application.id)
    await api.redeploy(application.id)
    expect(await api.logs(application.id)).toBe("built")
    await api.delete(application.id)
    expect(calls.map((call) => `${call.init.method} ${call.url}`)).toEqual([
      "GET https://wb.test/v1/applications",
      `GET https://wb.test/v1/applications/${application.id}`,
      `POST https://wb.test/v1/applications/${application.id}/redeploy`,
      `GET https://wb.test/v1/applications/${application.id}/logs`,
      `DELETE https://wb.test/v1/applications/${application.id}`,
    ])
  })

  it("does not retry a create and reports a taken subdomain", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ error: "conflict", message: "taken" }, { status: 409 }))
    const client = new CogniCloud({ token: "t", fetch })
    const error = await client.webBuilder.create({ subdomain: "shop" }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect((error as CogniCloudError).code).toBe("conflict")
    expect(calls).toHaveLength(1)
  })
})
