/** An error answered by CogniCloud, or a request that never got an answer (`status` 0). */
export class CogniCloudError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "CogniCloudError"
    this.status = status
    this.code = code
  }
}
