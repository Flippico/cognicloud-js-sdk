import { describe, expect, it } from "vitest"
import { CogniCloud, CogniCloudError, EndpointClient, encodeTenant } from "../src/index.js"

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

const answer = {
  id: "0c4e0e4a-0000-0000-0000-000000000000",
  model: "gpt-5-mini",
  output: "Hello",
  finishReason: "stop",
  usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
}

const endpoint = {
  id: "e1",
  name: "Support bot",
  providerId: "azure-openai",
  model: "gpt-5-mini",
  url: "https://cognicloud.flippi.co/api/v1/ai-gateway/invoke/636f676e69636c6f7564/e1",
  credentialPrefix: "cc_live_1234",
  tokenLimit: 1000,
  tokensUsed: 0,
  status: "active",
  requestMapping: [],
  createdAt: "2026-10-20T09:00:00Z",
}

describe("EndpointClient", () => {
  it("invokes the endpoint with its credential and returns the canonical answer", async () => {
    const { fetch, calls } = fakeFetch(Response.json(answer))
    const client = new EndpointClient({ endpointId: "e1", credential: "cc_live_secret", fetch })
    const result = await client.invoke({ input: "Hi" })
    expect(result).toEqual(answer)
    expect(calls[0].url).toBe("https://cognicloud.flippi.co/api/v1/ai-gateway/invoke/636f676e69636c6f7564/e1")
    expect(calls[0].init.method).toBe("POST")
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer cc_live_secret")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ input: "Hi" })
  })

  it("never retries an invoke, because the provider may already have billed it", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ error: "gateway_unavailable", message: "x" }, { status: 503 }))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch, maxRetries: 3 })
    await expect(client.invoke({ input: "Hi" })).rejects.toMatchObject({ status: 503, code: "gateway_unavailable" })
    expect(calls).toHaveLength(1)
  })

  it("turns an endpoint refusal into a CogniCloudError with its stable code", async () => {
    const { fetch } = fakeFetch(
      Response.json({ error: "endpoint_paused", message: "The endpoint is paused." }, { status: 409 })
    )
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    const error = await client.invoke({ input: "Hi" }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect(error).toMatchObject({ status: 409, code: "endpoint_paused", message: "The endpoint is paused." })
  })

  it("keeps the base URL configurable and tolerates a trailing slash", async () => {
    const { fetch, calls } = fakeFetch(Response.json(answer))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch, baseUrl: "https://staging.example/v1/" })
    await client.invoke({ input: "Hi" })
    expect(calls[0].url).toBe("https://staging.example/v1/invoke/636f676e69636c6f7564/e1")
  })

  it("names the endpoint's tenant in the address, as hex of its name", async () => {
    expect(encodeTenant("cognicloud")).toBe("636f676e69636c6f7564")
    const { fetch, calls } = fakeFetch(Response.json(answer))
    await new EndpointClient({ endpointId: "e1", tenant: "acme", credential: "k", fetch }).invoke({ input: "Hi" })
    expect(calls[0].url).toBe("https://cognicloud.flippi.co/api/v1/ai-gateway/invoke/61636d65/e1")
  })

  it("calls the invoke URL CogniCloud issued, as it is", async () => {
    const { fetch, calls } = fakeFetch(Response.json(answer))
    const client = new EndpointClient({ url: endpoint.url, credential: "k", fetch })
    await client.invoke({ input: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }], max_output_tokens: 64 })
    expect(calls[0].url).toBe(endpoint.url)
  })
})

describe("CogniCloud endpoints", () => {
  it("creates an endpoint with the session token and returns its one-time credential", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ endpoint, credential: { secret: "cc_live_new" } }, { status: 201 }))
    const cc = new CogniCloud({ token: "amadeus-session", locale: "pl", fetch })
    const created = await cc.endpoints.create({ name: "Support bot", providerId: "azure-openai", model: "gpt-5-mini", tokenLimit: 1000 })
    expect(created.credential.secret).toBe("cc_live_new")
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer amadeus-session")
    expect((calls[0].init.headers as Record<string, string>).tenant_id).toBe("cognicloud")
    expect((calls[0].init.headers as Record<string, string>)["accept-language"]).toBe("pl")
  })

  it("updates only the fields it is given", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ ...endpoint, tokenLimit: 5000 }))
    const cc = new CogniCloud({ token: "t", tenant: "acme", fetch })
    await cc.endpoints.update("e1", { tokenLimit: 5000 })
    expect((calls[0].init.headers as Record<string, string>).tenant_id).toBe("acme")
    expect(calls[0].init.method).toBe("PATCH")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ tokenLimit: 5000 })
  })

  it("reads daily usage with an optional range", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ days: [{ day: "2026-10-20", requests: 2, inputTokens: 10, outputTokens: 3, totalTokens: 13 }] }))
    const cc = new CogniCloud({ token: "t", fetch })
    const days = await cc.endpoints.dailyUsage("e1", { from: "2026-10-01", to: "2026-10-20" })
    expect(days).toHaveLength(1)
    expect(calls[0].url).toBe("https://cognicloud.flippi.co/api/v1/ai-gateway/endpoints/e1/usage/daily?from=2026-10-01&to=2026-10-20")
  })

  it("deletes an endpoint without expecting a body", async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 204 }))
    const cc = new CogniCloud({ token: "t", fetch })
    await expect(cc.endpoints.delete("e1")).resolves.toBeUndefined()
    expect(calls[0].init.method).toBe("DELETE")
  })

  it("retries a read after a 503 and gives up after maxRetries", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({ error: "unavailable", message: "try later" }, { status: 503 }),
      Response.json([endpoint])
    )
    const cc = new CogniCloud({ token: "t", fetch })
    const list = await cc.endpoints.list()
    expect(list).toHaveLength(1)
    expect(calls).toHaveLength(2)
  })

  it("reports a network failure as a CogniCloudError with status 0", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof globalThis.fetch
    const cc = new CogniCloud({ token: "t", fetch: failing, maxRetries: 0 })
    await expect(cc.endpoints.get("e1")).rejects.toMatchObject({ status: 0, code: "network_error" })
  })
})

describe("files", () => {
  it("builds a PDF part as a base64 data URL with its file name", async () => {
    const { pdfPart, textPart } = await import("../src/index.js")
    const part = pdfPart(new TextEncoder().encode("%PDF-1.4"), "cv.pdf")
    expect(part).toEqual({ type: "file", file: { filename: "cv.pdf", file_data: "data:application/pdf;base64,JVBERi0xLjQ=" } })
    expect(textPart("Match this CV.")).toEqual({ type: "text", text: "Match this CV." })
  })

  it("builds image and Responses parts", async () => {
    const { imagePart, inputFile, inputImage } = await import("../src/index.js")
    const bytes = new Uint8Array([137, 80, 78, 71])
    expect(imagePart(bytes, "image/png").image_url.url).toBe("data:image/png;base64,iVBORw==")
    expect(inputImage(bytes, "image/png").image_url).toBe("data:image/png;base64,iVBORw==")
    expect(inputFile(new Uint8Array([1]), "a.pdf")).toMatchObject({ type: "input_file", filename: "a.pdf" })
  })

  it("refuses a file over the gateway's 10 MB limit before sending anything", async () => {
    const { pdfPart, maxFileBytes } = await import("../src/index.js")
    expect(() => pdfPart(new Uint8Array(maxFileBytes + 1))).toThrow(CogniCloudError)
  })

  it("sends a message with a PDF part to the endpoint unchanged", async () => {
    const { pdfPart, textPart } = await import("../src/index.js")
    const { fetch, calls } = fakeFetch(Response.json(answer))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    const body = { messages: [{ role: "user", content: [textPart("Match this CV."), pdfPart(new Uint8Array([1, 2, 3]), "cv.pdf")] }] }
    await client.invoke(body)
    expect(JSON.parse(calls[0].init.body as string)).toEqual(body)
  })
})


describe("client creation", () => {
  it("refuses a missing, empty or blank token before any request is made", () => {
    for (const token of ["", "   ", undefined]) {
      expect(() => new CogniCloud({ token: token as unknown as string })).toThrow(CogniCloudError)
    }
    try {
      new CogniCloud({ token: "" })
    } catch (error) {
      expect((error as CogniCloudError).code).toBe("missing_token")
    }
  })
})
