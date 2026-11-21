import { createWebSearchTool } from '@theokit/agents/tools'
import type { CustomTool } from '@theokit/sdk'

import type { MemoryStore } from './memory-store.js'

export const SESSION_SEARCH_TOOL_NAME = 'session_search'

/** `session_search`: finds past turns of any session, whatever surface stored them. The SDK has no cross-session transcript search. */
export function sessionSearchTool(store: MemoryStore): CustomTool {
  return createWebSearchTool({
    name: SESSION_SEARCH_TOOL_NAME,
    description: 'Search what was said in earlier sessions, from any surface (chat platforms, WebChat, TUI, desktop). Returns the best matching turns with their surface and time.',
    search: (query, maxResults) =>
      Promise.resolve(
        store.search(query, Math.min(maxResults, 20)).map(({ surface, sessionKey, user, assistant, at }) => ({
          title: `${surface} ${at}`,
          url: `memory:${surface}/${sessionKey}`,
          snippet: `Owner: ${user}\nAssistant: ${assistant}`,
        })),
      ),
  })
}
