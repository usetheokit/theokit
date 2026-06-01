/**
 * G3 canonical scenario 1 — devalue roundtrip preserves rich JS types
 * (Date, Set, URL, bigint) that JSON.stringify would lose.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 6 / T6.1 + ADR D1.
 */
import { defineAction } from 'theokit/server'
import { z } from 'zod'

export const echoRichTypes = defineAction({
  input: z.object({ seed: z.string() }),
  handler: ({ input }) => ({
    seed: input.seed,
    when: new Date('2026-06-01T00:00:00.000Z'),
    tags: new Set(['a', 'b', 'c']),
    homepage: new URL('https://example.com/theokit'),
  }),
})
