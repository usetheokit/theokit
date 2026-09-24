/**
 * AC-016 — the streaming entry carries the provider in every interpolation.
 *
 * `generateStreamingEntry` calls `buildAppTreeJs` ONCE and interpolates the returned string three
 * times: the web renderer, the node renderer and the back-compat one. So a single insertion in the
 * builder adds three occurrences here, and a count of 1 is the signature of a wrap that reached only
 * one renderer. The arithmetic is visible in the tree with no patch at all —
 * `React.createElement(TheoUIProvider` counts 3 in the streaming entry against 1 in the single-shot.
 *
 * The bare-name count is the half that matters, and it was missing until a fifth panel round. A seat
 * patched a scratch copy exactly as T2.1 prescribes and forgot the import at the streaming site:
 *
 *   state                        createElement(   createElement(NonceProvider   bare NonceProvider
 *   today                              9                     0                          0
 *   import forgotten                  12                     3                          3
 *   correct, both sites               12                     3                          4
 *
 * Without the third column the middle row PASSES — and that row is a generated module that throws on
 * evaluation and supplies a nonce to nobody. `tsc` never sees it, because the entry is a string. It
 * is also the Cloudflare path, the only target rendering HTML per request, so FR-002 would go unmet
 * in exactly the deploy path it exists for.
 *
 * Its own file for the reason T1.3's is: the alignment brief's signed AC-001 pins `^ok ` at exactly 8
 * over `nonce-reaches-a-component.test.ts`, and that file is already at 8.
 */
import { describe, it, expect } from 'vitest'

import { generateEntryServer } from '../src/router/entry-server.js'

describe('the streaming SSR entry', () => {
  it('the streaming entry carries the provider in every interpolation', () => {
    const count = (src: string, lit: string): number => src.split(lit).length - 1
    const src = generateEntryServer({ streaming: true, theoUi: { theme: 'violet-forge' } })

    expect(count(src, 'React.createElement(')).toBe(12)
    // Three elements: one per renderer the builder's single result is interpolated into.
    expect(count(src, 'React.createElement(NonceProvider')).toBe(3)
    // Four: those three plus the import statement. This is what separates a correct wrap from one
    // whose element arrived in all three renderers with nothing imported.
    expect(count(src, 'NonceProvider')).toBe(4)
  })
})
