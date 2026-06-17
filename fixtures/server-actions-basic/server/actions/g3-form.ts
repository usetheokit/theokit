import { defineAction } from 'theokit/server'
import { z } from 'zod'

// Scenario 3 — accept:'form'. FormData arrives as strings; formDataToObject
// coerces each field against the declared zod types (Astro pattern): age →
// number, subscribe → boolean.
export const submitForm = defineAction({
  accept: 'form',
  input: z.object({
    name: z.string(),
    age: z.number(),
    subscribe: z.boolean(),
  }),
  handler: ({ input }) => ({ received: input }),
})
