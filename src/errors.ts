/** An error answered by CogniCloud, or a request that never got an answer (`status` 0). */
export class CogniCloudError extends Error {
  readonly status: number
  readonly code: string
  /** For `query_failed`: a Postgres SQLSTATE such as `23505`, or `query_timeout` or `unsupported_type`. */
  readonly queryCode?: string

  constructor(status: number, code: string, message: string, queryCode?: string) {
    super(message)
    this.name = "CogniCloudError"
    this.status = status
    this.code = code
    this.queryCode = queryCode
  }
}
