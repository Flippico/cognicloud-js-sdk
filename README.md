# @cognicloud/sdk

Call CogniCloud AI Gateway endpoints and manage them from Node.js, Bun, Deno and edge runtimes.

> Preview. The first version covers AI Gateway endpoints. Browser sessions are included; agents, scraping, vault and activity are not included yet.

## Install

```bash
npm install @cognicloud/sdk
```

ESM, typed, uses the platform `fetch`, no runtime dependencies.

## Call an endpoint

```ts
import { EndpointClient } from "@cognicloud/sdk"

const endpoint = new EndpointClient({
  endpointId: process.env.COGNICLOUD_ENDPOINT_ID!,
  credential: process.env.COGNICLOUD_KEY!,
})

const { output, finishReason, usage } = await endpoint.invoke({
  input: [
    { role: "system", content: "Answer in one sentence." },
    { role: "user", content: "Summarise this ticket." },
  ],
  max_output_tokens: 256,
})
```

The invoke address is `<baseUrl>/invoke/<tenant>/<endpointId>`. The endpoint belongs to the platform tenant, `cognicloud`, unless you pass `tenant`. You can also pass the address CogniCloud issued for the endpoint (`endpoint.url`) as `url` instead of `endpointId`.

Without a request mapping the body goes to the provider as it is, and only plain-text messages are accepted:

- An endpoint without a deployment uses the Responses API: `input` (a string or `system`/`developer`/`user`/`assistant` messages), `max_output_tokens`, `temperature`, `top_p`.
- An endpoint with an Azure deployment uses Chat Completions: `messages`, `max_completion_tokens` (or `max_tokens`), `temperature`, `top_p`.

`store` and `text.format` (structured outputs) are refused with `400 invalid_request`. For `instructions`, MCP tools and chaining use `responses`; for streaming use `stream`. Some models refuse `temperature`; the gateway then answers `502 provider_refused`. The endpoint always chooses the model.

Every model answers in the same shape: `output` (text), `finishReason` (`stop`, `length`, `content_filter`, `other`, or `null`) and `usage` (token counts).

`invoke` is never retried, because a retried call can be billed twice.

## Responses with tools

`responses` takes a Responses body with optional `instructions`, MCP tools and `previous_response_id`. An MCP tool names its server with `server_url` and its bearer token with `headers`, as `{ Authorization: "Bearer <token>" }`. The gateway checks the address (https, with no credentials or fragment), sets approval to `never`, and passes both to the provider. A tool with only `server_label` names a server the gateway is configured with.

```ts
const answer = await endpoint.responses({
  input: "Is this invoice valid?",
  instructions: "Check invoices.",
  tools: [{ type: "mcp", server_label: "ksef", allowed_tools: ["validate_invoice_xml"] }],
  tool_choice: "required",
})

const next = await endpoint.responses({ input: "And this one?", previous_response_id: answer.responseId })
```

The answer adds `responseId` (for chaining on the same endpoint) and `outputItems` (the tool calls and messages the provider returned).

## Embeddings

```ts
const { data } = await endpoint.embeddings({ input: ["first text", "second text"], dimensions: 256 })
const first = data[0].embedding
```

The endpoint must point at an embedding deployment. `data` has one item per input, in input order, and each call is billed as prompt tokens.

## Stream a response

`stream` sets `stream: true` and yields events as the answer is written:

```ts
for await (const event of await endpoint.stream({ messages: [{ role: "user", content: "Write a haiku." }] })) {
  if (event.type === "delta") process.stdout.write(event.text)
  if (event.type === "done") console.log(`\n${event.answer.usage.totalTokens} tokens`)
  if (event.type === "error") console.error(`${event.code}: ${event.message}`)
}
```

Each event is `delta` (`text`), then one `done` (`answer`, the same shape as `invoke`), or one `error` (`code`, `message`). A refused call rejects with a `CogniCloudError` before any event. Streams are not retried and have no total timeout; the gateway ends them at five minutes. Stopping early with `break` closes the connection, and the gateway still settles the call.

## Send a PDF or an image

```ts
import { EndpointClient, pdfPart, textPart } from "@cognicloud/sdk"
import { readFile } from "node:fs/promises"

const endpoint = new EndpointClient({ url: process.env.COGNICLOUD_ENDPOINT_URL!, credential: process.env.COGNICLOUD_KEY! })
const cv = await readFile("cv.pdf")

const { output } = await endpoint.invoke({
  messages: [{ role: "user", content: [textPart("Match this CV to the job."), pdfPart(cv, "cv.pdf")] }],
})
```

Files go up to 10 MB. The gateway reserves a quarter of a file's size in tokens before the call, so an endpoint's monthly limit must cover it.

## Manage endpoints

Calls act as the account of `token`, the signed-in person's Amadeus session token or a browser key for browser calls, sent as `Authorization: Bearer`. A missing, empty or blank token throws `CogniCloudError` with code `missing_token` when the client is created. The workspace (`tenant`, default `cognicloud`) is sent as the `tenant_id` header.

```ts
import { CogniCloud } from "@cognicloud/sdk"

const cc = new CogniCloud({ token: amadeusToken, locale: "en" })

const { endpoint, credential } = await cc.endpoints.create({
  name: "Support bot",
  providerId: "azure-openai",
  model: "gpt-5-mini",
  tokenLimit: 1_000_000,
})

await cc.endpoints.update(endpoint.id, { tokenLimit: 2_000_000 })
await cc.endpoints.update(endpoint.id, { status: "paused" })
const usage = await cc.endpoints.usage(endpoint.id)
const days = await cc.endpoints.dailyUsage(endpoint.id, { from: "2026-10-01", to: "2026-10-20" })
const { secret } = await cc.endpoints.rotateCredential(endpoint.id)
await cc.endpoints.delete(endpoint.id)
```

Also available: `cc.endpoints.list()` and `cc.endpoints.get(id)`.

## Browser sessions

Browser calls accept the signed-in person's token, or a browser key. Create a key in the dashboard under **Browser → API keys** and pass it as the token. A key keeps working after its owner signs out. Keys cannot be created through the SDK or the API.

A browser session is a Chrome that your agent drives over the Chrome DevTools Protocol. Start one, connect your automation library to its `cdpUrl`, and stop it when you are done:

```ts
import { CogniCloud } from "@cognicloud/sdk"
import { chromium } from "playwright"

const cc = new CogniCloud({ token: amadeusToken })

const session = await cc.browser.sessions.create({ timeoutMinutes: 15 })
const browser = await chromium.connectOverCDP(session.cdpUrl!)
const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage())
await page.goto("https://example.com")

await browser.close()
await cc.browser.sessions.stop(session.id)
```

- `timeoutMinutes` is 1 to 240 and defaults to 15. The session stops by itself when the timeout passes.
- Closing the CDP connection does not stop the session. Call `stop` as above.
- `status` is `active` or `stopped`. `cdpUrl` and `liveUrl` are `null` once the session has stopped. `liveUrl` is a page where a person can watch and take over the browser.
- `sessions.list()` returns the workspace's sessions, newest first, with `concurrency: { active, limit }`. A start beyond the limit fails with `429` and code `concurrency_limit`.
- Proxy countries, profiles, screen sizes, captcha solving and recording are not available yet. `countries()` and `profiles()` return empty lists, and a start that asks for one of those options fails with `422`.

## Errors

```ts
import { CogniCloudError } from "@cognicloud/sdk"

try {
  await endpoint.invoke({ input: "Hi" })
} catch (error) {
  if (error instanceof CogniCloudError && error.code === "credits_exhausted") {
    // top up credits
  }
  throw error
}
```

`status` is the HTTP status (`0` when the request never got an answer); `code` is CogniCloud's stable error code.

## Configuration

| Option | Default | |
| --- | --- | --- |
| `baseUrl` | `https://cognicloud.flippi.co/api/v1/ai-gateway` | Point at another environment. |
| `locale` | `"en"` | `Accept-Language` for localised responses. |
| `timeoutMs` | `30000` | Per request. |
| `maxRetries` | `2` | For `429` and `5xx`, on calls that are safe to repeat. |
| `fetch` | `globalThis.fetch` | Supply your own, e.g. for proxies or tests. |

The `CogniCloud` client also takes `token` (the signed-in person's Amadeus session token), `tenant` (the workspace, sent as the `tenant_id` header; default `"cognicloud"`, the platform workspace) and `browserBaseUrl` (default `https://cognicloud.flippi.co/api/v1/browser`).

## Changes

See [CHANGELOG.md](./CHANGELOG.md). Agents, scraping, vault and activity are planned for later versions.

Source: https://github.com/Flippico/cognicloud-js-sdk

## Development

```bash
npm install
npm test
npm run build
```
