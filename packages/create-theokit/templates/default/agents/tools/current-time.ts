import { tool } from 'theokit/server/define'
import { z } from 'zod'

/**
 * A local, deterministic tool — the current date + time, optionally in an IANA timezone. No network,
 * always works: the counterpart to `weather.ts` (which hits an HTTP API), so the scaffold shows both a
 * remote-call tool and a pure local one. Imported into `chat.ts` and chained with `.tool(currentTimeTool)`.
 */
export const currentTimeTool = tool('current_time')
  .describe('Get the current date and time, optionally for a specific IANA timezone.')
  .input(
    z.object({
      timezone: z
        .string()
        .optional()
        .describe('IANA timezone, e.g. "Europe/Lisbon" or "America/Sao_Paulo". Defaults to UTC.'),
    }),
  )
  .execute(async ({ timezone }) => {
    const tz = timezone ?? 'UTC'
    try {
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(new Date())
      return `Current time (${tz}): ${formatted}`
    } catch {
      // fail-fast with a clear, actionable message (Rule 8) rather than a cryptic RangeError.
      throw new Error(
        `Unknown timezone "${tz}". Use an IANA name like "Europe/Lisbon" or "America/Sao_Paulo".`,
      )
    }
  })
  .build()
