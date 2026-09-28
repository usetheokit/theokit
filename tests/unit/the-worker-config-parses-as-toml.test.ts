/**
 * The generated `wrangler.toml` is checked by a parser, not by a regex over its text.
 *
 * Ten test files assert on `renderWranglerToml`'s output and none of them parsed it. Every assertion was
 * a substring or a line pattern, and a document whose STRUCTURE is wrong satisfies all of them — which
 * matters here because this file has a documented structural hazard, stated in its own emitted comment:
 *
 *     # LAST, on purpose. A TOML table owns every key after it until the next header, so placing this
 *     # above `[assets]` would parse `directory` and `binding` as define entries — a config that
 *     # deploys and serves no assets.
 *
 * So the failure mode is known, it has cost this repository once, and nothing verified it. The gap was
 * found on 2026-09-28 while inserting comment lines beside `[define]` — exactly the edit that can absorb
 * the next table's keys — and the check was done by hand with Python's `tomli` because no parser was
 * reachable from a test (B-333).
 *
 * `smol-toml` is the parser wrangler itself uses, so this asserts against the same reader the real
 * consumer applies, and it was already in the store as a transitive dependency of it — declared rather
 * than imported as a phantom.
 */
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import { renderWranglerToml } from '../../packages/theo/src/adapters/cloudflare.js'

/** The emitted config, as a parsed document. */
function config(opts: { ssrStreaming: boolean }): Record<string, unknown> {
  return parse(renderWranglerToml(opts)) as Record<string, unknown>
}

function table(doc: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = doc[key]
  expect(value, `\`[${key}]\` is not a table in the emitted config`).toBeTypeOf('object')
  return value as Record<string, unknown>
}

describe('the generated worker config parses as TOML', () => {
  it('test_both_modes_parse_at_all', () => {
    // Anti-vacuity FIRST: every assertion below reads a key off a parse result, and a parse that threw
    // would fail them for the wrong reason while a parse of an EMPTY document would pass some.
    for (const ssrStreaming of [true, false]) {
      const doc = config({ ssrStreaming })
      expect(
        Object.keys(doc).length,
        `the ${String(ssrStreaming)} config parsed to almost nothing`,
      ).toBeGreaterThan(4)
      expect(doc).toHaveProperty('main')
      expect(doc).toHaveProperty('name')
    }
  })

  it('test_the_asset_binding_survives_as_its_own_table', () => {
    // THE case the hazard is about. `binding` and `directory` belong to `[assets]`; a comment or a block
    // moved above it absorbs them into whatever table precedes them, and the worker then has no
    // `env.ASSETS` at all — which is a 404 for every static file and, before #412, for the document.
    const assets = table(config({ ssrStreaming: true }), 'assets')

    expect(assets.binding).toBe('ASSETS')
    expect(assets.directory).toBe('.theokit/client')
  })

  it('test_not_found_handling_differs_by_mode_and_is_inside_assets', () => {
    // The two modes need different values and the key belongs to `[assets]`. A regex over the text
    // cannot say which table it landed in, and landing in the wrong one is silent.
    expect(table(config({ ssrStreaming: true }), 'assets').not_found_handling).toBe('none')
    expect(table(config({ ssrStreaming: false }), 'assets').not_found_handling).toBe(
      'single-page-application',
    )
  })

  it('test_no_define_table_is_emitted', () => {
    // This case asserted the OPPOSITE until 2026-09-28: `[define]` had to be its own table, because the
    // config carried a compensation for a dependency that resolved a path at module scope. That cause is
    // fixed upstream in `@theokit/sdk@5.9.2` and the framework's declared floor is now `^5.9.2`, so the
    // block is gone and its absence is what the emitter must keep — see
    // `the-worker-config-carries-no-vendor-compensation.test.ts` for the reasoning and the measurement.
    //
    // Kept here rather than deleted because a parse is the only thing that can tell "the table is absent"
    // from "the table is absent because its header was absorbed by the one before it", and this file is
    // where that distinction lives.
    expect(config({ ssrStreaming: true }).define).toBeUndefined()
  })

  it('test_the_hazard_is_a_block_between_a_header_and_its_keys', () => {
    // The hazard, executable — and the first version of this case measured the emitted comment's own
    // wording to be imprecise, which is why it is asserted at all.
    //
    // That comment says placing `[define]` "above `[assets]`" would absorb `directory` and `binding`.
    // Read literally it does not: `[assets]` is then the next header and owns its keys, so the document
    // parses correctly. What DOES absorb them is the block landing between the `[assets]` header and the
    // keys under it — which is exactly the shape an insertion into the emitter's flat line array takes
    // when it lands one index too late.
    const emitted = renderWranglerToml({ ssrStreaming: true })
    const withoutDefine = emitted.replace(/\[define\][\s\S]*$/, '')
    const defineBlock = '[define]\n"import.meta.url" = "\\"file:///worker\\""\n'

    // Anchored at the start of a line: the literal `[assets]` also appears inside a comment two
    // lines up, and a bare substring replace hits that one and produces a document that does not
    // parse at all — measured, and the reason this is a regex.
    const safe = parse(withoutDefine.replace(/^\[assets\]$/m, `${defineBlock}[assets]`)) as Record<
      string,
      Record<string, unknown>
    >
    expect(
      safe.assets?.directory,
      'placing the block before the `[assets]` header is claimed to break it, and does not',
    ).toBe('.theokit/client')

    const broken = parse(
      withoutDefine.replace(/^\[assets\]$/m, `[assets]\n${defineBlock.trimEnd()}`),
    ) as Record<string, Record<string, unknown>>
    expect(
      broken.define?.directory,
      'the real hazard does not occur either, so the cases above guard nothing',
    ).toBe('.theokit/client')
    expect(broken.assets?.binding).toBeUndefined()
  })
})
