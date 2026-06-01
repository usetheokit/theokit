/**
 * G3 canonical scenario 4 — csrf:false opts out of multi-header enforcement.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 6 / T6.1.
 * Public-facing webhooks need this; the trade-off is the action handler
 * MUST validate the request independently (e.g., signature header).
 */
import { defineAction } from 'theokit/server'
import { z } from 'zod'

export const publicEcho = defineAction({
  csrf: false,
  input: z.object({ msg: z.string() }),
  handler: ({ input }) => ({ echoed: input.msg }),
})
