import { AgentBuilder } from '@theokit/agents'
import { z } from 'zod'

import { publishTool } from './tools/publish.js'
import { readNotesTool } from './tools/read-notes.js'

/**
 * `publisher` — turns the researcher's notes into something that leaves the building.
 *
 * The second bot, and the one that shows what a bot product has to solve that a chat app does not:
 * **nobody is watching when this runs**. The approval below pauses the run, and on a schedule there
 * is no attached client to show it to — which is why `server/delivery.ts` exists and why its seam is
 * not optional in a template called `bot`.
 *
 * It can read the researcher's notes and cannot write them. That asymmetry is enforced by
 * `botScope`'s `writeRoot`, not by instruction: a prompt asking a model not to write is a request,
 * and a write root is a wall.
 */
export const policy = 'public'

export default AgentBuilder.create()
  .input(z.object({ instruction: z.string() }))
  .model(process.env.LLM_MODEL ?? 'openai/gpt-4o-mini')
  .system(
    'You turn research notes into published output. Read notes with read_notes, then publish. ' +
      'Publishing is gated: a human approves it before it happens.',
  )
  .tool(readNotesTool)
  .tool(publishTool)
  // The gate that makes this a bot rather than a script. On an attended run the surface shows the
  // prompt; on a scheduled one it reaches the owner through `server/delivery.ts`.
  .approval('publish', { question: 'Publish this?' })
  .build()
