# @cognicloud/sdk

Call CogniCloud AI Gateway endpoints and manage them from Node.js, Bun, Deno and edge runtimes.

> 2.0: every call sends your account key together with a product key. See [Migrating from 1.x](#migrating-from-1x).

## Install

```bash
npm install @cognicloud/sdk
```

ESM, typed, uses the platform `fetch`, no runtime dependencies.

## API keys

Create keys in the dashboard under **Settings → API keys**. Each is shown once. You need two kinds, and every call uses both:

- Your **account key** (`cc_acc_...`): who you are and which workspace. Required on every call; on its own it does nothing.
- A **product key** for each product you call: `cc_gw_` AI Gateway, `cc_db_` Database, `cc_br_` Browser, `cc_ml_` Mail, `cc_ag_` Agents, `cc_st_` Storage. It can be narrowed to one resource, such as one model, database or agent.

Each call sends the product key as the Bearer token and the account key in `X-CogniCloud-Account-Key`. Both must be from the same person and workspace; the services refuse a product key alone (`401`) and an account key alone (`403`). The keys name their workspace, so there is no `tenant` option. Keys cannot be created through the SDK or the API.

```ts
import { CogniCloud } from "@cognicloud/sdk"

const cc = new CogniCloud({
  accountKey: process.env.COGNICLOUD_ACCOUNT_KEY!,
  productKeys: {
    database: process.env.COGNICLOUD_DATABASE_KEY,
    browser: process.env.COGNICLOUD_BROWSER_KEY,
  },
})
```

The client checks the keys when it is created: a missing account key throws `missing_account_key`, a key of the wrong kind `invalid_key`, keys from different workspaces `key_mismatch`, an old format (`cgb_`, `cgd_`, `cga_`, `ccag_`, `cgm_`, `cgv_`, `cc_live_`) `retired_key`. Using a product without its key, for example `cc.mail` with no `productKeys.mail`, throws `missing_product_key`. Web Builder and the marketplace have no product key yet: they take the account key alone. `parseKey(key)` and `checkKeys(accountKey, productKeys)` read keys without a request.

## Call an endpoint

```ts
const endpoint = cc.endpoint(process.env.COGNICLOUD_ENDPOINT_ID!)

const { output, finishReason, usage } = await endpoint.invoke({
  input: [
    { role: "system", content: "Answer in one sentence." },
    { role: "user", content: "Summarise this ticket." },
  ],
  max_output_tokens: 256,
})
```

The call needs `productKeys.gateway` and acts as the endpoint's owner. The invoke address is `<baseUrl>/invoke/<workspace>/<endpointId>`, with the workspace taken from the account key. `new EndpointClient({ accountKey, gatewayKey, endpointId })` or `new EndpointClient({ accountKey, gatewayKey, url: endpoint.url })` makes the same client without a `CogniCloud`.

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

const endpoint = new EndpointClient({
  url: process.env.COGNICLOUD_ENDPOINT_URL!,
  accountKey: process.env.COGNICLOUD_ACCOUNT_KEY!,
  gatewayKey: process.env.COGNICLOUD_GATEWAY_KEY!,
})
const cv = await readFile("cv.pdf")

const { output } = await endpoint.invoke({
  messages: [{ role: "user", content: [textPart("Match this CV to the job."), pdfPart(cv, "cv.pdf")] }],
})
```

Files go up to 10 MB. The gateway reserves a quarter of a file's size in tokens before the call, so an endpoint's monthly limit must cover it.

## Manage endpoints

With `productKeys.gateway`:

```ts
const { endpoint } = await cc.endpoints.create({
  name: "Support bot",
  providerId: "azure-openai",
  model: "gpt-5-mini",
  tokenLimit: 1_000_000,
})

await cc.endpoints.update(endpoint.id, { tokenLimit: 2_000_000 })
await cc.endpoints.update(endpoint.id, { status: "paused" })
const usage = await cc.endpoints.usage(endpoint.id)
const days = await cc.endpoints.dailyUsage(endpoint.id, { from: "2026-10-01", to: "2026-10-20" })
await cc.endpoints.delete(endpoint.id)
```

Also available: `cc.endpoints.list()` and `cc.endpoints.get(id)`.

## Browser sessions

Browser calls need `productKeys.browser` (`cc_br_`):

```ts
const browser = new CogniCloud({
  accountKey: process.env.COGNICLOUD_ACCOUNT_KEY!,
  productKeys: { browser: process.env.COGNICLOUD_BROWSER_KEY },
}).browser
const session = await browser.sessions.create({ timeoutMinutes: 15 })
```

Upload a profile folder packed as a `.tar.gz` (see the app docs for how to pack it), then start a session from it:

```ts
import { readFile } from "node:fs/promises"

const profile = await browser.importProfile("Shop account", await readFile("shop-profile.tar.gz"))
const session = await browser.sessions.create({ profileId: profile.id })
```


A browser session is a Chrome that your agent drives over the Chrome DevTools Protocol. Start one, connect your automation library to its `cdpUrl`, and stop it when you are done:

```ts
import { CogniCloud } from "@cognicloud/sdk"
import { chromium } from "playwright"

const cc = new CogniCloud({ accountKey: process.env.COGNICLOUD_ACCOUNT_KEY!, productKeys })

const session = await cc.browser.sessions.create({ timeoutMinutes: 15 })
const browser = await chromium.connectOverCDP(session.cdpUrl!)
const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage())
await page.goto("https://example.com")

await browser.close()
const page = await cc.browser.sessions.readPage(session.id)
await cc.browser.sessions.act(session.id, { type: "navigate", url: "https://example.com" })
await cc.browser.sessions.act(session.id, { type: "click", index: 3 })

const run = await cc.browser.sessions.startAgentRun(session.id, {
  task: "Find the price of the Pro plan",
  endpointId,
  credential,
})
const { status, result } = await cc.browser.sessions.getAgentRun(session.id, run.id)

// For serverless callers: a stored run that does one step per request.
const stored = await cc.browser.sessions.createStepRun(session.id, { task: "Find the price", endpointId })
const after = await cc.browser.sessions.runStep(session.id, stored.id, { credential, timeoutSeconds: 120 })

await cc.browser.sessions.stop(session.id)
```

- `timeoutMinutes` is 1 to 240 and defaults to 15. The session stops by itself when the timeout passes.
- Closing the CDP connection does not stop the session. Call `stop` as above.
- `status` is `active` or `stopped`. `cdpUrl` and `liveUrl` are `null` once the session has stopped. `liveUrl` is a page where a person can watch and take over the browser.
- `sessions.list()` returns the workspace's sessions, newest first, with `concurrency: { active, limit }`. A start beyond the limit fails with `429` and code `concurrency_limit`.
- Proxy countries, profiles, screen sizes, captcha solving and recording are not available yet. `countries()` and `profiles()` return empty lists, and a start that asks for one of those options fails with `422`.

## Mail

Mailboxes on the Flippico mail server; needs `productKeys.mail` (`cc_ml_`). The password is returned once; store it.

```ts
const { mailbox, password } = await cc.mail.create("support")
const settings = await cc.mail.connectionSettings() // IMAP and SMTP hosts, and defaultDomain

// Your own domain: add it, publish domain.records at your DNS provider, then verify.
const domain = await cc.mail.domains.add("yourcompany.com")
await cc.mail.domains.verify(domain.id)
await cc.mail.create("ceo", { domain: "yourcompany.com" })
```

`mail.list`, `get`, `rotatePassword` and `delete` manage mailboxes; `mail.domains.list`, `get` and `delete` manage domains.

## Database

Hosted Postgres; needs `productKeys.database` (`cc_db_`). A database key for every database creates and lists databases; `cc.database.data(database.id)` queries one (sent as `x-database-id`). With a database key narrowed to one database, `cc.database.data()` needs no id.

```ts
const database = await cc.database.create("Orders")
const db = cc.database.data(database.id)

await db.query("CREATE TABLE orders (id serial PRIMARY KEY, email text, total numeric)")
const { rows } = await db.query("SELECT * FROM orders WHERE total > $1", [100])

await db.table("orders").insert({ email: "a@example.com", total: "19.90" })
const paid = await db.table("orders").select("id", "email").gt("total", 10).order("id", { desc: true }).limit(20)
await db.table("orders").update({ total: "0" }).eq("id", 1)
await db.table("orders").delete().eq("id", 1)

await db.transaction([
  { sql: "UPDATE accounts SET balance = balance - $1 WHERE id = $2", params: [10, 1] },
  { sql: "UPDATE accounts SET balance = balance + $1 WHERE id = $2", params: [10, 2] },
])
const tables = await db.tables()
```

- Filters are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is` and `in`. `update` and `delete` need at least one; to change every row, use `query`.
- `select`, `update` and `delete` run when awaited. `insert` runs at once.
- A result has `rows`, `columns`, `rowCount` and `truncated`. One request stops after 15 seconds and returns at most 1,000 rows and 5 MB.
- `numeric` values, and `bigint` values beyond 2^53, come back as strings, so nothing is rounded. `bytea` comes back as base64.
- A failed statement throws `CogniCloudError` with `code` `query_failed` and `queryCode`: a Postgres SQLSTATE such as `23505`, or `query_timeout`.
- `query` and `transaction`, inserts, updates and deletes are never retried, because they may change data.

Pass values as `params`, never inside the SQL. They need no quotes and cannot break the statement:

```ts
await db.query("INSERT INTO members (id, user_id) VALUES ($1, $2)", [id, userId])
```

`cc.database.query(database.id, sql, params)` and `cc.database.tables(database.id)` also work without `data`. `cc.database.list`, `get` and `delete` manage databases, and `cc.database.actions` lists what was done.

## Storage

Buckets and objects; needs `productKeys.storage` (`cc_st_`).

```ts
await cc.storage.buckets.create({ name: "assets", description: "Product photos" })

await cc.storage.objects.upload("assets", "shoes/red.jpg", imageBytes, { contentType: "image/jpeg" })
const bytes = await cc.storage.objects.download("assets", "shoes/red.jpg")
const firstKilobyte = await cc.storage.objects.download("assets", "shoes/red.jpg", { range: "bytes=0-1023" })
const info = await cc.storage.objects.metadata("assets", "shoes/red.jpg") // size, contentType, etag, lastModified

const { folders, objects, nextCursor } = await cc.storage.objects.list("assets", { prefix: "shoes/", limit: 50 })
for await (const page of cc.storage.objects.pages("assets")) {
  for (const object of page.objects) console.log(object.key, object.size)
}

await cc.storage.folders.create("assets", "invoices/2026/")
await cc.storage.objects.delete("assets", "shoes/red.jpg")
await cc.storage.buckets.update("assets", { visibility: "public_read", description: null })
await cc.storage.buckets.delete("assets", { force: true }) // without force, a bucket with objects is refused
```

- `buckets.list`, `get` and `update` manage buckets. Visibility is `private` or `public_read`; `description: null` clears the description.
- Deleting a bucket that still holds objects throws `CogniCloudError` with `status` 409 and `code` `conflict`. `{ force: true }` deletes the bucket with its objects.
- Object keys may contain slashes; each segment is URL-encoded for you.
- `objects.list` returns one page: `folders` (grouped by `delimiter`, `/` by default) and `objects`. Pass `nextCursor` back as `cursor` for the next page. `objects.pages` does that for you, one request per page; stop early with `break`.
- `download` returns a `Uint8Array` held in memory. Uploads are at most 100 MB. `timeoutMs` covers the whole transfer, so raise it for large files.
- Writes (`create`, `update`, `delete`, `upload`, `folders.create`) are never retried; reads and downloads are.

## Web builder

Build a React application and host it at `https://<subdomain>.cognicloud.dev`. Leave out `repoUrl` to start from a Vite + React starter. Each person can have 3 applications.

```ts
const app = await cc.webBuilder.create({ subdomain: "shop", repoUrl: "https://github.com/acme/shop" })

const { status } = await cc.webBuilder.get(app.id)
const logs = await cc.webBuilder.logs(app.id)
```

`create` starts the build and returns at once, with `status` set to `building`. It then becomes `running` or `failed`. `branch`, `buildCommand` and `outputDir` default to `main`, `npm run build` and `dist`. `cc.webBuilder.list`, `redeploy` and `delete` do the rest.

```ts
await cc.webBuilder.update(app.id, { branch: "next" })
await cc.webBuilder.pause(app.id)
await cc.webBuilder.resume(app.id)
const requests = await cc.webBuilder.runtimeLogs(app.id)
const history = await cc.webBuilder.actions({ applicationId: app.id })

await cc.webBuilder.createRepository(app.id, "shop")
await cc.webBuilder.enableAutoDeploy(app.id)
await cc.webBuilder.disableAutoDeploy(app.id)
```

`update` starts a build, and a paused site has `status` set to `paused`. `createRepository` and the auto-deploy methods need a connected GitHub account: `authorizeGithub`, `connectGithub`, `githubRepositories` and `disconnectGithub`.

## Agents

An agent follows its instructions and skills, and an AI Gateway endpoint of your workspace decides each step. Tools arrive in later releases.

```ts
const skill = await cc.skills.create({ name: "Cite", description: "Cite sources", body: "Always name your sources." })

const { agent, credential } = await cc.agents.create({
  name: "Researcher",
  endpointId: endpoint.id,
  instructions: "Answer research questions briefly.",
  tools: [],
  maxSteps: 10,
  timeoutSeconds: 300,
  skillIds: [skill.id],
})
```

`credential.secret` is the agent's `ccag_` credential, shown only here; `cc.agents.rotateCredential(agent.id)` issues a new one. `cc.agents.list`, `get`, `update` (`status: "paused"` pauses the agent, `databaseId: null` clears its database) and `delete` do the rest. `cc.skills.list`, `get`, `update`, `delete` and `versions` manage skills; every change keeps the previous version. `cc.agents.actions({ limit, cursor })` lists what was done. `cc.agents.publish` and `unpublish` are planned and answer `503` today.

### Runs

```ts
const run = await cc.runs.runAndWait(agent.id, "What changed in KSeF this month?")
if (run.status === "completed") console.log(run.output)
else console.log(run.errorCode, run.errorMessage)
```

`runAndWait` starts a run and polls it every `pollIntervalMs` (default `2000`) until it is `completed`, `failed` or `stopped`, and returns it. It throws a `CogniCloudError` with code `timeout` when `timeoutMs` (default `900000`) passes first; the run keeps going until it ends or you stop it. To drive a run yourself:

```ts
const started = await cc.runs.start(agent.id, "Summarise today's news")
const current = await cc.runs.get(started.id)
const page = await cc.runs.list(agent.id, { limit: 20 })
await cc.runs.stop(started.id)
```

Each step in `run.steps` has `thought`, `tool`, `summary` and `error`. A failed run has `errorCode` `max_steps`, `timeout`, `model_error`, `invalid_answer` or `interrupted`. Starting a run is refused with `409 agent_paused`, `422 endpoint_missing`, `429 limit_reached` (3 runs at a time) or `503`.

An Agents key (`cc_ag_`) narrowed to one agent replaces the old agent credential: it can use only that agent and its runs; other calls are refused with `403`.

```ts
const runner = new CogniCloud({ accountKey: process.env.COGNICLOUD_ACCOUNT_KEY!, productKeys: { agents: process.env.AGENT_KEY } })
const run = await runner.runs.runAndWait(agentId, "Check the status page")
```

### Marketplace

```ts
const templates = await cc.marketplace.listTemplates({ category: "research" })
const template = await cc.marketplace.getTemplate(templates[0].slug)
const history = await cc.marketplace.actions({ limit: 20 })
```

Create an agent from a template by passing its `templateSlug` to `cc.agents.create`.

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
| `baseUrl` | `https://cognicloud.dev/api/v1/ai-gateway` | Point at another environment. |
| `locale` | `"en"` | `Accept-Language` for localised responses. |
| `timeoutMs` | `30000` | Per request. |
| `maxRetries` | `2` | For `429` and `5xx`, on calls that are safe to repeat. |
| `fetch` | `globalThis.fetch` | Supply your own, e.g. for proxies or tests. |

The `CogniCloud` client also takes `accountKey` (required), `productKeys`, `browserBaseUrl` (default `https://cognicloud.dev/api/v1/browser`) `mailBaseUrl` (default `https://cognicloud.dev/api/v1/mail`), `databaseBaseUrl` (default `https://cognicloud.dev/api/v1/database`), `webBuilderBaseUrl` (default `https://cognicloud.dev/api/v1/web-builder`), `agentsBaseUrl` (default `https://cognicloud.dev/api/v1/agents`), `marketplaceBaseUrl` (default `https://cognicloud.dev/api/v1/marketplace`) and `storageBaseUrl` (default `https://cognicloud.dev/api/v1/storage`).

## Migrating from 1.x

| 1.x | 2.0 |
| --- | --- |
| `new CogniCloud({ apiKey: "cc_acc_..." })` | `new CogniCloud({ accountKey: "cc_acc_...", productKeys: { database: "cc_db_...", ... } })` |
| `new CogniCloud({ apiKey: "cc_db_..." })` | `new CogniCloud({ accountKey, productKeys: { database: "cc_db_..." } })` |
| `new EndpointClient({ endpointId, apiKey })` | `new EndpointClient({ endpointId, accountKey, gatewayKey })` |

Create a product key for each product you use on **Settings → API keys**, and keep the account key next to them.

## Migrating from 0.x

| 0.x | 1.0 |
| --- | --- |
| `new CogniCloud({ token, tenant })` | `new CogniCloud({ apiKey })` with an account key |
| `new EndpointClient({ endpointId, credential: "cc_live_..." })` | `cc.endpoint(endpointId)`, or `new EndpointClient({ endpointId, apiKey })` |
| `new CogniCloudBrowser({ key: "cgb_..." })` | `new CogniCloud({ apiKey: "cc_br_..." }).browser` |
| `new CogniCloudDatabase({ key: "cgd_..." })` | `new CogniCloud({ apiKey: "cc_db_..." }).database.data()` |
| `new CogniCloud({ token: "ccag_..." })` | `new CogniCloud({ apiKey: "cc_ag_..." })` narrowed to the agent |
| `cc.endpoints.rotateCredential`, `cc.database.keys`, `cc.agents.keys` | Settings → API keys in the dashboard |

The old keys keep working on the services for two weeks after the new keys launch, then stop. SDK 1.0 refuses them at once with `retired_key`, so create the new keys before you upgrade.

## Changes

See [CHANGELOG.md](./CHANGELOG.md). Agent tools, publishing to the marketplace, scraping, vault and activity are planned for later versions.

Source: https://github.com/Flippico/cognicloud-js-sdk

## Development

```bash
npm install
npm test
npm run build
```
