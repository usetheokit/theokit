/**
 * The headers a POST to an agent route carries: it asks for the UIMessage event stream and declares
 * itself an action, which the route's strict CSRF gate requires.
 *
 * `HttpTransport` and `createA2ATool` both call agent routes, so both build their headers here. A
 * second copy is how the two drifted once: one merged a caller's `x-theo-action` case-insensitively,
 * the other kept both spellings, and `fetch` joined them into `1, 0`.
 */
export const AGENT_ACTION_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json',
  accept: 'text/event-stream',
  'X-Theo-Action': '1',
}

/**
 * Merge header records left to right. A later name replaces an earlier one that differs only in
 * letter case, because HTTP header names are case-insensitive, and the later spelling is kept.
 * Returns a plain record, the shape callers and their tests already read.
 */
export function agentRequestHeaders(
  ...sources: (Readonly<Record<string, string>> | undefined)[]
): Record<string, string> {
  let merged: Record<string, string> = {}
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      const lower = name.toLowerCase()
      merged = Object.fromEntries(
        Object.entries(merged).filter(([key]) => key.toLowerCase() !== lower),
      )
      merged[name] = value
    }
  }
  return merged
}
