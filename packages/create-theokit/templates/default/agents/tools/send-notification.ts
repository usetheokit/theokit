import { tool } from 'theokit/server/define'
import { z } from 'zod'

/**
 * A side-effecting demo tool — "sends" a notification (here it just echoes a confirmation; wire it to
 * email/SMS/push in a real app). It exists to show the **human-in-the-loop** gate: `chat.ts` marks it
 * `.approval('send_notification', …)`, so before the agent actually runs it the TUI pauses and shows an
 * `ApprovalPrompt` ("Send this notification?") — the human allows once/always or rejects. Ask the agent
 * to "notify me that …" to see the gate fire. Gate any tool with real-world side effects the same way.
 */
export const sendNotificationTool = tool('send_notification')
  .describe(
    'Send a notification message to the user. A gated action — the human approves it before it runs.',
  )
  .input(
    z.object({
      message: z.string().describe('The notification text to send to the user.'),
    }),
  )
  .execute(async ({ message }) => `📣 Notification sent: "${message}"`)
  .build()
