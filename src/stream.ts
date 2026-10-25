import type { ResponseResult, StreamEvent } from "./types.js"

/**
 * Reads a streamed call's Server-Sent Events. Yields `delta` events as text arrives, then one `done` or `error`, and
 * stops. A stream that closes before its final event yields an `error` with the code `stream_ended`. Lines may end in
 * LF or CRLF; a record ends at a blank line, and its `data:` lines are joined with newlines.
 */
export async function* streamEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let event = ""
  let data: string[] = []
  let terminal = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const lines = (pending + decoder.decode(value, { stream: true })).split(/\r?\n/)
      pending = lines.pop() ?? ""
      for (const line of lines) {
        if (line !== "") {
          if (line.startsWith("event:")) event = line.slice(6).replace(/^ /, "")
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""))
          continue
        }
        if (event === "" && data.length === 0) continue
        const decoded = decode(event || "message", data.join("\n"))
        event = ""
        data = []
        if (!decoded) continue
        yield decoded
        if (decoded.type !== "delta") {
          terminal = true
          return
        }
      }
    }
    if (!terminal) {
      yield { type: "error", code: "stream_ended", message: "The stream ended before its final event." }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function decode(name: string, data: string): StreamEvent | undefined {
  if (name === "delta") return { type: "delta", text: (JSON.parse(data) as { text: string }).text }
  if (name === "done") return { type: "done", answer: JSON.parse(data) as ResponseResult }
  if (name === "error") {
    const error = JSON.parse(data) as { code: string; message: string }
    return { type: "error", code: error.code, message: error.message }
  }
  return undefined
}
