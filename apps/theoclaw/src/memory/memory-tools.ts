import { createWebSearchTool } from '@theokit/agents/tools'
import type { CustomTool } from '@theokit/sdk'

import { MAX_RECALLED_FACTS, type MemoryStore, OWNER_SCOPE } from './memory-store.js'

export const SESSION_SEARCH_TOOL_NAME = 'session_search'
export const SAVE_MEMORY_TOOL_NAME = 'save_memory'

/** `session_search`: finds past turns of any session, whatever surface stored them. */
export function sessionSearchTool(store: MemoryStore): CustomTool {
  return createWebSearchTool({
    name: SESSION_SEARCH_TOOL_NAME,
    description:
      'Search what was said in earlier sessions, from any surface (chat platforms, WebChat, TUI, desktop). Returns the best matching turns with their surface and time, and the facts earlier sessions kept.',
    search: (query, maxResults) =>
      Promise.resolve([
        ...store.facts(OWNER_SCOPE).slice(-MAX_RECALLED_FACTS).map((fact) => ({ title: 'kept fact', url: 'memory:fact', snippet: fact })),
        ...store.search(query, Math.min(maxResults, 20)).map(({ surface, sessionKey, user, assistant, at }) => ({
          title: `${surface} ${at}`,
          url: `memory:${surface}/${sessionKey}`,
          snippet: `Owner: ${user}\nAssistant: ${assistant}`,
        })),
      ]),
  })
}

/** `save_memory`: given only to the reviewer fork; keeps one durable fact the next session recalls. */
export function saveMemoryTool(store: MemoryStore, scope: string = OWNER_SCOPE): CustomTool {
  // The one published string-in factory; its `query` is the fact. The result list answers whether it was new.
  return createWebSearchTool({
    name: SAVE_MEMORY_TOOL_NAME,
    description: 'Keep one short, durable fact about the owner or their work so later sessions recall it. Put the fact in `query`.',
    search: (query) => {
      const saved = store.saveFact(query.slice(0, 500), scope)
      return Promise.resolve([{ title: saved ? 'saved' : 'not saved', url: 'memory:fact', snippet: query }])
    },
  })
}
