import { CogniCloudError } from "./errors.js"

export type HttpConfig = {
  baseUrl: string
  locale: string
  timeoutMs: number
  maxRetries: number
  fetch: typeof fetch
}

export type RequestOptions = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  /** Relative to the base URL. */
  path?: string
  /** A whole address, used instead of the base URL and `path`. */
  url?: string
  headers?: Record<string, string>
  body?: unknown
  /** A body sent as it is, with its own content type, instead of JSON. */
  raw?: { body: BodyInit; contentType: string }
  /** Calls that bill or change state are sent once; a retry could repeat them. */
  retry?: boolean
}

const retryableStatuses = new Set([429, 500, 502, 503, 504])

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function baseOf(url: string) {
  return url.replace(/\/+$/, "")
}

/** Turns a refused response into the error the gateway sent with it. */
async function failure(response: Response): Promise<CogniCloudError> {
  const body = (await response.json().catch(() => ({}))) as { error?: unknown; message?: unknown; code?: unknown }
  return new CogniCloudError(
    response.status,
    typeof body.error === "string" ? body.error : "http_error",
    typeof body.message === "string" ? body.message : response.statusText || "The request failed.",
    typeof body.code === "string" ? body.code : undefined,
  )
}

/**
 * One attempt, never retried, and no total timeout: a stream may run for minutes. Resolves with the response once it
 * is accepted, so the caller can read the body as it arrives.
 */
export async function open(config: HttpConfig, options: RequestOptions): Promise<Response> {
  const url = options.url ?? `${baseOf(config.baseUrl)}${options.path ?? ""}`
  let response: Response
  try {
    response = await config.fetch(url, {
      method: options.method,
      headers: {
        accept: "text/event-stream",
        "accept-language": config.locale,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new CogniCloudError(0, "network_error", "The request could not reach CogniCloud.")
  }
  if (response.ok) {
    return response
  }
  throw await failure(response)
}

export async function send<T>(config: HttpConfig, options: RequestOptions): Promise<T> {
  const url = options.url ?? `${baseOf(config.baseUrl)}${options.path ?? ""}`
  const retries = options.retry === false ? 0 : config.maxRetries
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await config.fetch(url, {
        method: options.method,
        headers: {
          accept: "application/json",
          "accept-language": config.locale,
          ...(options.raw ? { "content-type": options.raw.contentType } : options.body === undefined ? {} : { "content-type": "application/json" }),
          ...options.headers,
        },
        body: options.raw ? options.raw.body : options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(config.timeoutMs),
      })
    } catch (error) {
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt)
        continue
      }
      const timedOut = error instanceof Error && error.name === "TimeoutError"
      throw new CogniCloudError(
        0,
        timedOut ? "timeout" : "network_error",
        timedOut ? "The request timed out." : "The request could not reach CogniCloud."
      )
    }

    if (response.ok) {
      return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
    }
    if (retryableStatuses.has(response.status) && attempt < retries) {
      await sleep(250 * 2 ** attempt)
      continue
    }
    throw await failure(response)
  }
}
