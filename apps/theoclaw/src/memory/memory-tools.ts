import { Tool } from '@theokit/sdk'
import type { CustomTool } from '@theokit/sdk'
import { z } from 'zod'

import type { MemoryStore } from './memory-store.js'

const searchSchema = z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(10).optional() })
const saveSchema = z.object({ fact: z.string().min(1).max(500) })

/** `session_search`: past turns of every surface (control, WebChat, ...) that match a query. */
export function sessionSearchTool(store: MemoryStore): CustomTool {
  return Tool.create({
    name: 'session_search',
    description:
      'Search what was said in earlier conversations, on any surface (control socket, WebChat). ' +
      'Returns the matching turns as { surface, sessionId, at, user, assistant }.',
    inputSchema: searchSchema,
    handler: (input) => ({ hits: store.searchSessions(input.query, input.limit ?? 5) }),
  })
}

/** `memory_save`: keep one durable fact for later sessions. Held only by the reviewer. */
export function memorySaveTool(store: MemoryStore): CustomTool {
  return Tool.create({
    name: 'memory_save',
    description: 'Keep one short, durable fact (a preference, a name, a decision) that later conversations should know. Returns { saved }.',
    inputSchema: saveSchema,
    handler: (input) => ({ saved: store.saveFact(input.fact) }),
  })
}
