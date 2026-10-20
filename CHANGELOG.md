# Changelog

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
