import { tool } from 'theokit/server/define'
import { z } from 'zod'

import { deliver } from '../../server/delivery.js'

/**
 * The action that leaves the building — and therefore the one behind an approval.
 *
 * `publisher.ts` marks it `.approval('publish', …)`, so the run PAUSES here. On an attended run the
 * surface shows the prompt. On a scheduled one nobody is attached, which is the whole problem a bot
 * product has and a chat app does not — see `server/delivery.ts`.
 *
 * It "publishes" by delivering the text, because a scaffold should not guess whether your product
 * means a blog, a channel or a queue. Replace the body; keep the gate.
 */
export const publishTool = tool('publish')
  .describe('Publish finished output. A gated action — a human approves it before it runs.')
  .input(
    z.object({
      title: z.string().describe('What is being published.'),
      body: z.string().describe('The content.'),
    }),
  )
  .execute(async ({ title, body }) => {
    await deliver({ subject: `Published: ${title}`, body })
    return `Published "${title}".`
  })
  .build()
