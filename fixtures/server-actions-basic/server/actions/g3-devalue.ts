import { defineAction } from 'theokit/server'
import { z } from 'zod'

// Scenario 1 — devalue roundtrip. Returns rich types (Date / Set / URL) that
// only survive serialization via devalue; serializeActionResult emits
// `application/json+devalue` and the client revives them.
export const echoRichTypes = defineAction({
  input: z.object({ seed: z.string() }),
  handler: ({ input }) => ({
    seed: input.seed,
    when: new Date('2026-06-01T00:00:00.000Z'),
    tags: new Set(['a', 'b', 'c']),
    homepage: new URL('https://example.com/theokit'),
  }),
})
