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

`instructions`, `store`, `text.format` (structured outputs), images, files, tools and streaming are refused with `400 invalid_request`. Put instructions in a `system` message. Some models refuse `temperature`; the gateway then answers `502 provider_refused`. The endpoint always chooses the model.

Every model answers in the same shape: `output` (text), `finishReason` (`stop`, `length`, `content_filter`, `other`, or `null`) and `usage` (token counts).

`invoke` is never retried, because a retried call can be billed twice.

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

Management calls use the signed-in person's Amadeus session token, sent as `Authorization: Bearer`, and the workspace (`tenant`, default `cognicloud`), sent as the `tenant_id` header.

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

## Changes

See [CHANGELOG.md](./CHANGELOG.md). Agents, scraping, vault and activity are planned for later versions.

Source: https://github.com/Flippico/cognicloud-js-sdk

## Development

```bash
npm install
npm test
npm run build
```
