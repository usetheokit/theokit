import { AgentBuilder } from '@theokit/agents'
import { z } from 'zod'

import { readNotesTool } from './tools/read-notes.js'
import { writeNoteTool } from './tools/write-note.js'

/**
 * `researcher` — gathers and writes notes, unattended.
 *
 * The first of two bots, and the pair is the point: one bot is a chat app with a cron. Two is where
 * the questions a bot product actually has start — whose conversation is this, whose workspace can
 * it write to, who approves the thing that leaves the building.
 *
 * It has NO approval gate, deliberately: everything it does is confined to its own workspace by
 * `botScope`, and gating a write nobody outside can see would teach the ceremony without the reason.
 * `publisher` is the one that needs it.
 */
export const policy = 'public'

export default AgentBuilder.create()
  .input(z.object({ topic: z.string() }))
  .model(process.env.LLM_MODEL ?? 'openai/gpt-4o-mini')
  .system(
    'You research a topic and leave notes for the publisher bot. ' +
      'Write what you find with write_note; read what you already know with read_notes. ' +
      "You cannot publish — that is another bot's job, and it needs a human to approve.",
  )
  .tool(readNotesTool)
  .tool(writeNoteTool)
  .build()
