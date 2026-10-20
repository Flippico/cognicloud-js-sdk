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

/** A plain-text message. Images, files and tool calls are not accepted. */
export type Message = { role: "system" | "developer" | "user" | "assistant"; content: string }

/** For an endpoint without a deployment, which uses the Responses API. The endpoint chooses the model. */
export type ResponsesBody = {
  input: string | Message[]
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  stream?: false
}

/** For an endpoint with an Azure deployment, which uses Chat Completions. The endpoint chooses the model. */
export type ChatBody = {
  messages: Message[]
  max_completion_tokens?: number
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: false
}

/** What an endpoint without a request mapping accepts. A mapped endpoint takes the fields its mapping names (`Body`). */
export type InvokeBody = ResponsesBody | ChatBody
