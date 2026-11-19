/** Base class for every error @theokit/host throws. `code` is stable and machine-readable. */
export class HostError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HostError'
    this.code = code
  }
}
