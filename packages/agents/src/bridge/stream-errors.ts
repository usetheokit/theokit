/** Error descriptions shared by the bridge's turn runner and delegation port. */

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `code: message` for a streamed error event; a numeric code is shown as its digits. */
export function describeStreamedError(event: object): string {
  const { code, message } = event as { code?: unknown; message?: unknown }
  const text = typeof code === 'string' || typeof code === 'number' ? String(code) : 'error'
  return typeof message === 'string' && message !== '' ? `${text}: ${message}` : text
}
