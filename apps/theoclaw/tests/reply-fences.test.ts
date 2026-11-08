import { describe, expect, it } from 'vitest'

import { chunkText } from '@theokit/gateway'

/**
 * B-515 / OC-49: a reply holding a fenced code block longer than a platform's message limit must
 * be split outside the fence (or with the fence closed and reopened), so every chunk has balanced
 * fences. The published gateway packages (`@theokit/gateway` 0.12.0 and the adapters' latest) do
 * not do this yet: B-518 and B-519 have not shipped. This test pins the gap with `it.fails`, so it
 * goes red the day a bumped release fixes it, which is the signal to raise the ranges in
 * package.json, drop `.fails`, and cover each gateway's own chunker.
 */
const LIMIT = 200
const reply = ['Here is the script:', '', '```ts', ...Array.from({ length: 40 }, (_, i) => `const v${i} = ${i}`), '```', '', 'Done.'].join('\n')

function balanced(chunk: string): boolean {
  return (chunk.match(/^```/gm) ?? []).length % 2 === 0
}

describe('a reply with a fence longer than the platform limit', () => {
  it('the input is longer than the limit and holds one fenced block', () => {
    expect(reply.length).toBeGreaterThan(LIMIT)
    expect(reply.match(/^```/gm)).toHaveLength(2)
  })

  it.fails('arrives as chunks with balanced fences (blocked on B-518 and B-519 shipping)', () => {
    const chunks = chunkText(reply, { limit: LIMIT })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(balanced)).toBe(true)
  })
})
