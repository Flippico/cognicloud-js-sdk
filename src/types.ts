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
