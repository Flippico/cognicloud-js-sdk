# Changelog

## [0.12.0] - 2026-10-26

- `screen` on session creation sets the window size: 320 to 6144 wide, 320 to 3456 high. Chrome starts with it, and the session returns it.

## [0.11.0] - 2026-10-26

- `CogniCloudBrowser({ key })` uses the browser product with a browser key alone: no Amadeus token and no tenant. A browser key names its workspace.
- Browser calls send no `tenant_id` header unless a tenant is given.

## [0.10.1] - 2026-10-26

- A missing, empty or blank `token` throws `CogniCloudError` with code `missing_token` when the client is created, before any request is made.
- Docs: a browser key can be used as the token; the token and workspace are described in each README.

## [0.10.0] - 2026-10-26

- `browser.sessions.saveProfile(id, name)` saves a running session as a profile and ends the session. `create({ profileId })` starts a session from a saved profile.
- Breaking: `BrowserProfile` has `sizeBytes` and `expiresAt` in place of `cookieDomains`.

## [0.9.0] - 2026-10-25

- `ResponsesRequest` takes any extra field, sent to the provider unchanged. The gateway refuses the fields it sets itself (`n`, `best_of`, `background`, `store`, `stream_options`, `prompt`, `conversation`).

## [0.8.0] - 2026-10-25

- `McpTool` takes `server_url` and `headers` (one `Authorization` bearer token), so a Responses call can use an MCP server the caller names. The gateway checks the address and passes both to the provider. A tool with only `server_label` still names a server the gateway is configured with.

## [0.7.0] - 2026-10-25

- Streaming: `endpoint.stream(body)` (and `streamResponses`) yields `delta`, then one `done` or `error` event. The call is opened before the promise resolves, so refusals reject first. Streams are never retried and have no total timeout. A stream that closes early yields `error` with the code `stream_ended`.

## [0.6.0] - 2026-10-24

- Embeddings: `endpoint.embeddings({ input, dimensions? })` returns one vector per input in input order, billed as prompt tokens.

## [0.5.0] - 2026-10-24

- Responses with MCP tools and chaining: `endpoint.responses(body)` takes `instructions`, `tools` (MCP servers by label), `tool_choice` and `previous_response_id`. The answer adds `responseId` and `outputItems`.
- `invoke` is unchanged. The types `ResponsesRequest`, `ResponseResult`, `McpTool`, `ToolChoice`, `EmbeddingsRequest`, `EmbeddingsResult` and `StreamEvent` are exported.

## 0.4.0

- Browser sessions: `cognicloud.browser.sessions` starts, lists, reads and stops sessions that agents drive over the Chrome DevTools Protocol. `browser.countries()` and `browser.profiles()` return empty lists until those features exist. Set `browserBaseUrl` to point at another environment; the default is `https://cognicloud.flippi.co/api/v1/browser`.

## 0.3.0 — 2026-10-20

### Added

- PDFs and images in messages. `pdfPart(data, filename?)` and `imagePart(data, type)` build chat parts; `inputFile(data, filename?)` and `inputImage(data, type)` build Responses API parts; `textPart(text)` and `inputText(text)` build text. Each file becomes a base64 data URL.
- `maxFileBytes` (10 MB, as the gateway enforces) and a check before sending: a larger file throws `CogniCloudError` with code `file_too_large` and nothing is sent.
- `toBase64(bytes)`, and the `ContentPart`, `InputPart`, `TextPart`, `FilePart` and `ImagePart` types.

### Changed

- `Message.content` is text or an array of parts (up to 20), and Responses `input` messages take `InputPart`s.

## 0.2.0 — 2026-10-20

Version 0.1.0 could not reach a live gateway. This release matches the AI Gateway as it is deployed.

### Breaking

- The default `baseUrl` is now `https://cognicloud.flippi.co/api/v1/ai-gateway`. The old default, `https://api.cognicloud.dev/v1`, does not resolve.
- `EndpointClient.invoke` posts to `/invoke/{tenant}/{endpointId}`, the address the gateway issues. 0.1.0 posted to `/invoke/{endpointId}`, which the gateway answers with `404 not_found`.
- Management calls (`CogniCloud`) send the session token as `Authorization: Bearer <token>` and the workspace as the `tenant_id` header, as the gateway requires. 0.1.0 sent `x-amadeus-token`, which the gateway ignores.
- `EndpointClient.endpointId` is gone; `EndpointClient.url` holds the address every invoke goes to.

### Added

- `EndpointClient` takes either the issued invoke URL (`url`, the endpoint's `url` field) or `endpointId` with an optional `tenant` (default `"cognicloud"`, the platform tenant).
- `CogniCloud` takes an optional `tenant` (default `"cognicloud"`).
- `encodeTenant(name)`: how an invoke URL names its tenant (the name's UTF-8 bytes in lowercase hex).
- Types for what an endpoint without a request mapping accepts: `ResponsesBody` (`input`, `max_output_tokens`), `ChatBody` (`messages`, `max_completion_tokens`), `Message` and `InvokeBody`. Only plain-text messages are accepted; `instructions`, `store`, `text.format`, images, files, tools and streaming are refused with `400 invalid_request`.

### Fixed

- The package can be loaded with `require` and by tools that resolve the `default` export condition (tsx, Jest, older bundlers), not only with `import`.
- `CHANGELOG.md` ships with the package.

## 0.1.0 — 2026-10-20

- `EndpointClient.invoke`: call an endpoint with its credential.
- `CogniCloud.endpoints`: create, list, get, update, delete, rotate, usage and daily usage.
- `CogniCloudError` with the HTTP status and CogniCloud's error code.
