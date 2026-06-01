/**
 * G3 canonical scenario 5 — handler throws ActionError, gets mapped to
 * status code via IANA registry and emits flat envelope.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 6 / T6.1 + T0.1.
 */
import { ActionError } from 'theokit/server'
import { defineAction } from 'theokit/server'
import { z } from 'zod'

export const denyAlways = defineAction({
  input: z.object({}),
  handler: () => {
    throw new ActionError({
      code: 'FORBIDDEN',
      message: 'Access denied',
    })
  },
})
