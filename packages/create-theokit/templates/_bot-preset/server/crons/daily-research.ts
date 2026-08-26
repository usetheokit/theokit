import { defineCron } from 'theokit/server/cron'

import { botScope } from '../../agents/lib/bot-scope.js'
import { workspaceSandbox } from '../../agents/lib/sandbox.js'
import { deliver } from '../delivery.js'

/**
 * The entry point that makes this a bot: a schedule, not a page.
 *
 * A chat app starts when someone opens it. This starts at 09:00 whether or not anyone is looking,
 * which is the whole shape the `bot` preset exists to demonstrate — and every hard question follows
 * from it. Whose conversation does an unattended run continue? (`botScope`, so the bot resumes its
 * own history rather than starting blank each morning.) Where does its output go when nobody is
 * attached? (`deliver`.)
 *
 * `concurrency: 'forbid'` is the default and the right one here: yesterday's run still going when
 * today's fires means the model is slow or stuck, and starting a second one against the same
 * workspace makes two bots fight over one directory.
 */
export default defineCron('daily-research', {
  // 09:00 UTC. Cron schedules are UTC — a bot that appears to run an hour early twice a year is
  // this line read as local time.
  schedule: '0 9 * * *',
  async handler({ traceId, scheduledAt }: { traceId: string; scheduledAt: Date }) {
    const scope = botScope({
      botId: 'researcher',
      // The thread is the DATE, so each day is its own conversation. One endless thread would grow
      // until the model spent its context re-reading last month.
      thread: scheduledAt.toISOString().slice(0, 10),
      projectRoot: process.cwd(),
      sandbox: workspaceSandbox(),
    })

    await deliver({
      subject: `daily-research started (${scope.conversationId})`,
      body:
        `Workspace: ${scope.workspace}\n` +
        `Trace: ${traceId}\n\n` +
        'Drive the researcher agent from here — POST /api/agents/researcher with a topic, or call\n' +
        'it in-process. The scope above is what keeps this run isolated from the publisher and from\n' +
        "yesterday's.",
    })
  },
})
