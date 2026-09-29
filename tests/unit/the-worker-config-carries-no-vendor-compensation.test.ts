/**
 * The generated `wrangler.toml` must carry no compensation for a dependency's defect.
 *
 * It carried `[define] "import.meta.url" = "\"file:///worker\""` from 2026-09-26 to 2026-09-28. Cloudflare
 * executes the top-level module during validation, so a dependency that resolves a path at load time
 * refused the whole upload — every deploy of a project declaring an agent was rejected with code 10021,
 * because the transitive `@theokit/sdk` did exactly that in `internal/providers/catalog-loader.ts`.
 *
 * It was never a hidden lie: the emitted comment and the test that guarded it both said what it was and
 * what it was not. What it WAS is unconditional and permanent, and it substituted a literal for an
 * expression — so the NEXT dependency with the same vice would be covered here, in silence, and the
 * symptom would be a wrong path rather than a refusal.
 *
 * ## Why it could be removed, measured rather than assumed
 *
 * The cause is fixed upstream and published as `@theokit/sdk@5.9.2`. Measured on the published tarball
 * itself — 254 executable files in `dist`, and ZERO of them resolve a path at module scope. The five
 * remaining textual hits are two source maps and three `.d.ts` declarations, none of which is executed.
 *
 * And the framework's declared floor is now `^5.9.2` in every place that declares it — the peer and dev
 * ranges of `packages/theo`, the dependency of `packages/agents` and of `packages/presenter`, the
 * `create-theokit` template pin, and the workspace override. So the versions that needed the compensation
 * cannot be installed against this framework.
 *
 * **That substitution is the trade this file asserts.** A declared dependency is the honest form of "this
 * needs a fixed SDK"; a `define` that makes a broken one appear to work is the form that hides it.
 */
import { readFileSync } from 'node:fs'

import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import { renderWranglerToml } from '../../packages/theo/src/adapters/cloudflare.js'

describe('the worker config carries no vendor compensation', () => {
  it('test_no_define_table_is_emitted_in_either_mode', () => {
    // THE case. Asserted on the PARSED document rather than on the text, because a comment recording the
    // removal legitimately names `[define]` and a text match would be failed by the note explaining the
    // absence — the trap the sibling parse test was written after walking into.
    for (const ssrStreaming of [true, false]) {
      const doc = parse(renderWranglerToml({ ssrStreaming })) as Record<string, unknown>

      expect(
        doc.define,
        `the ${String(ssrStreaming)} config still substitutes a value for a dependency that resolves a ` +
          `path at module scope, which also covers the next one in silence`,
      ).toBeUndefined()
    }
    expect((parse(renderWranglerToml()) as Record<string, unknown>).define).toBeUndefined()
  })

  it('test_the_config_still_parses_and_keeps_its_asset_binding', () => {
    // COUNTERPROOF: deleting lines from a TOML emitter is exactly how a table loses the keys that
    // followed it. A document that no longer parses, or an `[assets]` that lost `binding`, satisfies the
    // case above perfectly and breaks every deploy.
    const doc = parse(renderWranglerToml({ ssrStreaming: true })) as Record<
      string,
      Record<string, unknown>
    >

    expect(doc.assets?.binding).toBe('ASSETS')
    expect(doc.assets?.directory).toBe('.theokit/client')
    expect(doc.assets?.not_found_handling).toBe('none')
    expect(doc.main).toBeTruthy()
  })

  it('test_the_removal_is_recorded_where_the_next_reader_looks', () => {
    // A compensation removed with no trace invites the next person to re-add it on the same evidence
    // that justified it the first time. The record names the upstream version and the floor, which are
    // the two facts that made removal safe.
    const toml = renderWranglerToml({ ssrStreaming: true })

    expect(toml).toContain('B-332')
    expect(toml).toContain('5.9.2')
    expect(toml, 'the record does not say what made removal safe').toContain('floor')
  })

  it('test_the_build_no_longer_announces_a_compensation_it_does_not_apply', () => {
    // The build printed the caveat for as long as the block existed. Announcing one that is gone is the
    // same defect in reverse: a reader acts on a constraint that no longer holds.
    const source = readSource()

    expect(source).not.toContain('compensating for a dependency')
  })
})

/** The adapter's own source, for the one assertion that is about what the BUILD prints. */
function readSource(): string {
  return readFileSync(
    new URL('../../packages/theo/src/adapters/cloudflare.ts', import.meta.url),
    'utf8',
  )
}
