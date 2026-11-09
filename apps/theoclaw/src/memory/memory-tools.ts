import { Tool } from '@theokit/sdk'
import type { CustomTool } from '@theokit/sdk'
import { z } from 'zod'

import { MAX_RECALLED_FACTS, type MemoryStore } from './memory-store.js'

export const SESSION_SEARCH_TOOL_NAME = 'session_search'
export const SAVE_MEMORY_TOOL_NAME = 'save_memory'

/** `session_search`: finds past turns of any session, whatever surface stored them. */
export function sessionSearchTool(store: MemoryStore): CustomTool {
  return Tool.create({
    name: SESSION_SEARCH_TOOL_NAME,
    description:
      'Search what was said in earlier sessions, from any surface (chat platforms, WebChat, TUI, desktop). Returns the best matching turns with their surface and time, and the facts earlier sessions kept.',
    inputSchema: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(20).optional() }),
    handler: (input: { query: string; limit?: number }): string =>
      JSON.stringify({
        facts: store.facts().slice(-MAX_RECALLED_FACTS),
        results: store.search(input.query, input.limit ?? 5).map(({ surface, sessionKey, user, assistant, at }) => ({
          surface,
          sessionKey,
          at,
          user,
          assistant,
        })),
      }),
  }) as unknown as CustomTool
}

/** `save_memory`: given only to the reviewer fork; keeps one durable fact the next session recalls. */
export function saveMemoryTool(store: MemoryStore): CustomTool {
  return Tool.create({
    name: SAVE_MEMORY_TOOL_NAME,
    description: 'Keep one short, durable fact about the owner or their work so later sessions recall it.',
    inputSchema: z.object({ fact: z.string().min(1).max(500) }),
    handler: (input: { fact: string }): string => JSON.stringify({ saved: store.saveFact(input.fact) }),
  }) as unknown as CustomTool
}
