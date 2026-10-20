# @cognicloud/sdk

Call CogniCloud AI Gateway endpoints and manage them from Node.js, Bun, Deno and edge runtimes.

> Preview. The first version covers AI Gateway endpoints. Agents, browser, scraping, vault and activity are not included yet.

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

const { output, finishReason, usage } = await endpoint.invoke({ input: "Summarise this ticket in one sentence." })
```

Every model answers in the same shape: `output` (text), `finishReason` (`stop`, `length`, `content_filter`, `other`, or `null`) and `usage` (token counts).

`invoke` is never retried, because a retried call can be billed twice.

## Manage endpoints

Management calls use the signed-in person's Amadeus session token.

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
| `baseUrl` | `https://api.cognicloud.dev/v1` | Point at another environment. |
| `locale` | `"en"` | `Accept-Language` for localised responses. |
| `timeoutMs` | `30000` | Per request. |
| `maxRetries` | `2` | For `429` and `5xx`, on calls that are safe to repeat. |
| `fetch` | `globalThis.fetch` | Supply your own, e.g. for proxies or tests. |

## Version 0.1.0

- `EndpointClient.invoke`: call an endpoint with its credential.
- `CogniCloud.endpoints`: create, list, get, update, delete, rotate, usage and daily usage.
- `CogniCloudError` with the HTTP status and CogniCloud's error code.

Agents, browser, scraping, vault and activity are planned for later versions.

Source: https://github.com/Flippico/cognicloud-js-sdk

## Development

```bash
npm install
npm test
npm run build
```
