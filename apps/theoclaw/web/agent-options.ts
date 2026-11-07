import type { UseAgentOptions } from '@theokit/agents/client/react'

/**
 * The page's transport configuration (plan glossary): where the page posts a chat message and the
 * headers it sends. The page passes both to `useAgent`, and the live check passes the same two to an
 * `HttpTransport`, so the live run exercises what the browser sends.
 */
export const WEBCHAT_API = '/webchat/chat'

/** The token travels in the `Authorization` header only, never in a URL (FR-009). */
export function webchatAgentOptions(token: string): { readonly headers: Record<string, string> } {
  const options = { headers: { Authorization: `Bearer ${token}` } } satisfies UseAgentOptions
  return options
}
