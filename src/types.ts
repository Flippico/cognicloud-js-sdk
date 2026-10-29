export type MappingRow = { source: string; target: string }

export type EndpointStatus = "active" | "paused"

export type Endpoint = {
  id: string
  name: string
  providerId: string
  model: string
  url: string
  credentialPrefix: string
  tokenLimit: number
  tokensUsed: number
  status: EndpointStatus
  requestMapping: MappingRow[]
  createdAt: string
}

export type CreateEndpointInput = {
  name: string
  providerId: string
  model: string
  tokenLimit: number
}

export type UpdateEndpointInput = Partial<
  Pick<Endpoint, "name" | "providerId" | "model" | "tokenLimit" | "status" | "requestMapping">
>

export type CreatedEndpoint = {
  endpoint: Endpoint
  credential: { secret: string }
}

export type EndpointUsage = {
  endpointId: string
  periodStart: string
  periodEnd: string
  tokensUsed: number
  tokenLimit: number
  tokensRemaining: number
  requests: number
}

export type DailyUsage = {
  day: string
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type DailyUsageRange = { from?: string; to?: string }

/** The same shape for every model: the text, why generation stopped, and the token counts. */
export type InvokeResponse = {
  id: string
  model: string
  output: string
  finishReason: "stop" | "length" | "content_filter" | "other" | null
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
}

export type Body = Record<string, unknown>

/**
 * An MCP server a Responses call may use. Name the server with `server_url` and its bearer token with `headers`; the gateway
 * checks the address (https, no credentials or fragment), sets approval to `never`, and passes both to the provider. A tool
 * with only `server_label` names a server the gateway is configured with.
 */
export type McpTool = {
  type: "mcp"
  server_label: string
  server_url?: string
  headers?: { Authorization: string }
  allowed_tools?: string[]
}

export type ToolChoice = "auto" | "required" | "none"

/** A Responses call with optional MCP tools, instructions and chaining. Continue a conversation with `previous_response_id`. */
export type ResponsesRequest = {
  input: string | Array<{ role: Role; content: string | InputPart[] }>
  instructions?: string
  previous_response_id?: string
  tools?: McpTool[]
  tool_choice?: ToolChoice
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  /** Any other field, sent to the provider unchanged. The gateway refuses the fields it sets itself, such as `n` and `store`. */
} & Record<string, unknown>

/** A Responses answer. `responseId` and `outputItems` are present only for Responses calls. */
export type ResponseResult = InvokeResponse & {
  responseId?: string
  outputItems?: unknown[]
}

/** Text to embed: one string or up to 256. The endpoint's embedding deployment is the model. */
export type EmbeddingsRequest = { input: string | string[]; dimensions?: number }

export type EmbeddingsResult = {
  id: string
  model: string
  /** One item per input, in input order. */
  data: Array<{ index: number; embedding: number[] }>
  usage: InvokeResponse["usage"]
}

/** One event of a streamed call: text as it is generated, then one `done` with the answer, or one `error`. */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; answer: ResponseResult }
  | { type: "error"; code: string; message: string }

export type Role = "system" | "developer" | "user" | "assistant"

/** A text part of a chat message. */
export type TextPart = { type: "text"; text: string }
/** A PDF, as a base64 data URL in `file_data`. The gateway accepts files up to 10 MB decoded. */
export type FilePart = { type: "file"; file: { filename?: string; file_data: string } }
/** An image, as a base64 data URL. PNG, JPEG, WebP and GIF are accepted. */
export type ImagePart = { type: "image_url"; image_url: { url: string } }
export type ContentPart = TextPart | FilePart | ImagePart

/** A chat message: plain text, or text, PDFs and images as parts (up to 20). Tool calls are not accepted. */
export type Message = { role: Role; content: string | ContentPart[] }

/** Responses API input parts, for an endpoint without a deployment. */
export type InputText = { type: "input_text"; text: string }
export type InputFile = { type: "input_file"; filename?: string; file_data: string }
export type InputImage = { type: "input_image"; image_url: string }
export type InputPart = InputText | InputFile | InputImage

/** For an endpoint without a deployment, which uses the Responses API. The endpoint chooses the model. */
export type ResponsesBody = {
  input: string | Array<{ role: Role; content: string | InputPart[] }>
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
}

/** For an endpoint with an Azure deployment, which uses Chat Completions. The endpoint chooses the model. */
export type ChatBody = {
  messages: Message[]
  max_completion_tokens?: number
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
}

/** What an endpoint without a request mapping accepts. A mapped endpoint takes the fields its mapping names (`Body`). */
export type InvokeBody = ResponsesBody | ChatBody

export type BrowserScreen = { width: number; height: number }

/** A session is `active` until it stops; then its `cdpUrl` and `liveUrl` are `null`. */
export type BrowserSession = {
  id: string
  status: "active" | "stopped"
  /** WebSocket for Playwright, Puppeteer or any CDP client. `null` once stopped. */
  cdpUrl: string | null
  /** A page where people can watch the session. `null` once stopped. */
  liveUrl: string | null
  profileId: string | null
  proxyCountryCode: string | null
  solveCaptchas: boolean
  recording: boolean
  screen: BrowserScreen | null
  timeoutAt: string
  startedAt: string
  finishedAt: string | null
}

export type BrowserSessionList = {
  items: BrowserSession[]
  concurrency: { active: number; limit: number }
}

export type CreateBrowserSessionInput = {
  /** Start from a saved profile, with the logins it holds. */
  profileId?: string | null
  /** Proxy countries are not available yet; leave unset or `null`. */
  proxyCountryCode?: string | null
  /** Minutes until the session stops. Default 15; at most 240. */
  timeoutMinutes?: number
  /** The window size: 320 to 6144 wide and 320 to 3456 high. Chrome starts with it. Leave unset for Chrome's default. */
  screen?: BrowserScreen | null
  /** Captcha solving is not available yet; leave unset or `false`. */
  solveCaptchas?: boolean
  /** Recording is not available yet; leave unset or `false`. */
  recording?: boolean
}

export type ProxyCountry = { code: string; name: string }

export type BrowserProfile = {
  id: string
  name: string
  sizeBytes: number
  createdAt: string
  lastUsedAt: string | null
  /** Deleted after this time unless a session starts from it. */
  expiresAt: string
}

export type Mailbox = {
  id: string
  address: string
  localPart: string
  domain: string
  createdAt: string
  updatedAt: string
}

export type MailboxList = {
  items: Mailbox[]
  total: number
  limit: number
  offset: number
}

export type MailboxListOptions = {
  limit?: number
  offset?: number
}

export type CreatedMailbox = {
  mailbox: Mailbox
  /** Returned once; the server keeps no copy. */
  password: string
}

export type RotatedMailboxPassword = {
  /** Returned once; the server keeps no copy. */
  password: string
}

export type MailServerEndpoint = {
  host: string
  port: number
  security: string
}

export type MailConnectionSettings = {
  usernameFormat: string
  imap: MailServerEndpoint
  smtp: MailServerEndpoint
}
