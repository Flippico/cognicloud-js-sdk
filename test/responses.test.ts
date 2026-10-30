import { describe, expect, it } from "vitest"
import { CogniCloudError, EndpointClient } from "../src/index.js"

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

function sse(text: string) {
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } })
}

const answer = {
  id: "0c4e0e4a-0000-0000-0000-000000000000",
  model: "gpt-5-mini",
  output: "Valid.",
  finishReason: "stop",
  usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
  responseId: "resp_1",
  outputItems: [{ type: "mcp_call", name: "validate_invoice_xml" }],
}

async function collect(events: AsyncGenerator<unknown>) {
  const all: unknown[] = []
  for await (const event of events) all.push(event)
  return all
}

describe("EndpointClient.responses", () => {
  it("sends MCP tools by label and returns the response id and output items", async () => {
    const { fetch, calls } = fakeFetch(Response.json(answer))
    const client = new EndpointClient({ endpointId: "e1", credential: "cc_live_secret", fetch })
    const result = await client.responses({
      input: "Check this invoice.",
      instructions: "Be brief.",
      tools: [{ type: "mcp", server_label: "ksef", allowed_tools: ["validate_invoice_xml"] }],
      tool_choice: "required",
    })
    expect(result).toEqual(answer)
    expect(calls[0].url).toBe("https://cognicloud.dev/api/v1/ai-gateway/invoke/636f676e69636c6f7564/e1")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      input: "Check this invoice.",
      instructions: "Be brief.",
      tools: [{ type: "mcp", server_label: "ksef", allowed_tools: ["validate_invoice_xml"] }],
      tool_choice: "required",
    })
  })

  it("continues a conversation with previous_response_id", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ ...answer, responseId: "resp_2" }))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    const next = await client.responses({ input: "And this one?", previous_response_id: "resp_1" })
    expect(next.responseId).toBe("resp_2")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ input: "And this one?", previous_response_id: "resp_1" })
  })

  it("never retries a Responses call", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ error: "gateway_unavailable", message: "x" }, { status: 503 }))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch, maxRetries: 3 })
    await expect(client.responses({ input: "x" })).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
  })
})

describe("extra fields", () => {
  it("sends any extra field at the top level of the body", async () => {
    const { fetch, calls } = fakeFetch(Response.json(answer))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    await client.responses({ input: "Hi", seed: 7, reasoning: { effort: "low" } })
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ input: "Hi", seed: 7, reasoning: { effort: "low" } })
  })
})

describe("MCP tools", () => {
  it("sends a caller's server address and bearer header to the gateway unchanged", async () => {
    const { fetch, calls } = fakeFetch(Response.json(answer))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    await client.responses({
      input: "Check this invoice.",
      tools: [
        {
          type: "mcp",
          server_label: "ksef",
          server_url: "https://ksef-api.flippi.co/mcp/v1",
          headers: { Authorization: "Bearer abc123" },
          allowed_tools: ["validate_invoice_xml"],
        },
      ],
    })
    expect(JSON.parse(calls[0].init.body as string).tools).toEqual([
      {
        type: "mcp",
        server_label: "ksef",
        server_url: "https://ksef-api.flippi.co/mcp/v1",
        headers: { Authorization: "Bearer abc123" },
        allowed_tools: ["validate_invoice_xml"],
      },
    ])
  })
})

describe("EndpointClient.embeddings", () => {
  it("posts to the embeddings path and returns one vector per input", async () => {
    const { fetch, calls } = fakeFetch(
      Response.json({
        id: "x",
        model: "embed-small",
        data: [
          { index: 0, embedding: [0.1, 0.2] },
          { index: 1, embedding: [0.3, 0.4] },
        ],
        usage: { inputTokens: 12, outputTokens: 0, totalTokens: 12 },
      })
    )
    const client = new EndpointClient({ endpointId: "e1", credential: "cc_live_secret", fetch })
    const result = await client.embeddings({ input: ["first", "second"], dimensions: 256 })
    expect(result.data[1].embedding).toEqual([0.3, 0.4])
    expect(calls[0].url).toBe("https://cognicloud.dev/api/v1/ai-gateway/invoke/636f676e69636c6f7564/e1/embeddings")
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ input: ["first", "second"], dimensions: 256 })
  })
})

describe("EndpointClient.stream", () => {
  it("yields deltas in order, then the done answer, and sends stream true", async () => {
    const { fetch, calls } = fakeFetch(
      sse(
        'event: delta\ndata: {"text":"Hel"}\n\nevent: delta\r\ndata: {"text":"lo"}\r\n\r\nevent: done\ndata: ' +
          JSON.stringify({ ...answer, output: "Hello" }) +
          "\n\n"
      )
    )
    const client = new EndpointClient({ endpointId: "e1", credential: "cc_live_secret", fetch })
    const events = await collect(await client.stream({ messages: [{ role: "user", content: "hi" }] }))
    expect(events).toEqual([
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "done", answer: { ...answer, output: "Hello" } },
    ])
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ messages: [{ role: "user", content: "hi" }], stream: true })
    expect((calls[0].init.headers as Record<string, string>).accept).toBe("text/event-stream")
  })

  it("yields a provider error event and ends", async () => {
    const { fetch } = fakeFetch(
      sse(
        'event: delta\ndata: {"text":"Hi"}\n\nevent: error\ndata: {"code":"upstream_failure","message":"The provider did not finish the answer."}\n\n'
      )
    )
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    const events = await collect(await client.streamResponses({ input: "x" }))
    expect(events[1]).toEqual({ type: "error", code: "upstream_failure", message: "The provider did not finish the answer." })
    expect(events).toHaveLength(2)
  })

  it("reports stream_ended when the stream closes before its final event", async () => {
    const { fetch } = fakeFetch(sse('event: delta\ndata: {"text":"Hi"}\n\n'))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    const events = await collect(await client.stream({ input: "x" }))
    expect(events[1]).toMatchObject({ type: "error", code: "stream_ended" })
  })

  it("rejects a refused call before any event", async () => {
    const { fetch } = fakeFetch(
      Response.json({ error: "invalid_request", message: "Streaming needs an API version of 2024-10-21 or later." }, { status: 422 })
    )
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch })
    const error = await client.stream({ input: "x" }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CogniCloudError)
    expect(error).toMatchObject({ status: 422, code: "invalid_request" })
  })

  it("never retries a stream, because the provider may already have billed it", async () => {
    const { fetch, calls } = fakeFetch(Response.json({ error: "gateway_unavailable", message: "x" }, { status: 503 }))
    const client = new EndpointClient({ endpointId: "e1", credential: "k", fetch, maxRetries: 3 })
    await expect(client.stream({ input: "x" })).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
  })
})
