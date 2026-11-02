import { randomUUID } from 'node:crypto'

import { createQuestionTool, createTaskCompleteTool, createTaskDeclareTool } from '@theokit/agents/tools'
import type { TaskRegistry } from '@theokit/agents/tools'
import type { CustomTool } from '@theokit/sdk'

/**
 * What the model reads of `question` on a `/control` agent: a `/control` turn is one socket request
 * and the socket has no frame that answers a question mid-turn (`control-socket.ts`), so the tool
 * answers `no_asker` at once instead of waiting out its five-minute timeout (plan D1).
 */
const QUESTION_DESCRIPTION =
  'Ask the owner a question. On this surface nobody can answer while the turn runs: the call returns ' +
  '{ ok: false, error: "no_asker" } at once. Put the question in your reply instead, and the owner answers it in the next turn.'

/** `question` with no asker, so it never hangs a `/control` turn (plan D1). */
export function questionTool(): CustomTool {
  return createQuestionTool({ description: QUESTION_DESCRIPTION })
}

/**
 * A registry for one agent's declared tasks. The work starts inside `submit`, so the resolver
 * `task_declare` captures is set before `submit` returns its id; the SDK's process-wide `Task`
 * queues work past its 8 slots and would return first, and every open declaration would hold one
 * of those slots for as long as it stays open (plan D2).
 */
function declaredTasks(): TaskRegistry {
  return {
    resolvers: new Map(),
    submit: (_kind, work) => {
      // A declaration ends when task_complete releases it; nothing aborts it, and it holds no slot.
      void work({ signal: new AbortController().signal })
      return Promise.resolve({ id: randomUUID() })
    },
  }
}

/** `task_declare` and `task_complete` over one registry, fresh for each agent (plan D2). */
export function taskTools(): CustomTool[] {
  const registry = declaredTasks()
  // The handlers type their input as `unknown` and parse it with the tool's own schema.
  return [createTaskDeclareTool({ registry }), createTaskCompleteTool({ registry })] as unknown as CustomTool[]
}
