/**
 * G3 canonical scenario 3 — accept:'form' coerces FormData via formDataToObject.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 6 / T6.1 + ADR D1.
 * Schema declares typed scalars (number, boolean); FormData strings get
 * coerced field-by-field.
 */
import { defineAction } from 'theokit/server'
import { z } from 'zod'

export const submitForm = defineAction({
  accept: 'form',
  input: z.object({
    name: z.string().min(1),
    age: z.number().int().nonnegative(),
    subscribe: z.boolean(),
  }),
  handler: ({ input }) => ({
    received: input,
  }),
})
