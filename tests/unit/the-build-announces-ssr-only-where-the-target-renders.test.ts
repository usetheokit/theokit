/**
 * The build must not announce SSR for a target whose entry cannot render.
 *
 * `build.ts` printed the note from the CONFIG alone:
 *
 *     const ssrNote = config.ssr ? ' (SSR)' : ''
 *
 * So every target printed `(SSR)` whenever `ssr: true` was set, including the ones that delegate the
 * document to a static host and say so in their own emitted comments. The build told you server
 * rendering was on for a build that produced none.
 *
 * Measured on 2026-09-28 by building a real project (`ssr: true, ssrStreaming: true`) with
 * `--target bun` and driving the emitted entry under Bun 1.3.14:
 *
 *     ✓ Build complete → bun (SSR)
 *     GET /   ->  200  text/html  531 bytes   <div id="root"></div>
 *
 * The same project on Cloudflare answers 14889 bytes of rendered markup.
 *
 * ## Why a table and not a string search at print time
 *
 * The note is printed by the CLI, which has no access to what the adapter emitted. A capability is a
 * property of the adapter, so it is declared beside the target list and checked against the adapters
 * here — in both directions, so the table cannot drift from the code either way.
 *
 * This is the shape `a-prebuilt-function-bakes-its-routes.test.ts` names in its own header: "the same
 * option threaded correctly by two adapters and forgotten by three". A per-target assertion would have
 * to be written again for the next adapter; a sweep is already written for it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { VALID_TARGETS, targetRendersDocument } from '../../packages/theo/src/adapters/types.js'

const ADAPTERS = resolve(__dirname, '../../packages/theo/src/adapters')

/** The adapter file each target is emitted by. */
const SOURCE: Record<string, string> = {
  cloudflare: 'cloudflare.ts',
  vercel: 'vercel.ts',
  netlify: 'netlify.ts',
  bun: 'bun.ts',
  node: 'node.ts',
  'aws-lambda': 'aws-lambda.ts',
  'deno-deploy': 'deno-deploy.ts',
  static: 'static.ts',
  'theo-cloud': 'theo-cloud.ts',
}

/**
 * Source with comments removed. Prose naming a call is not the call — three false positives were
 * measured this session by grepping raw source, and `bun.ts` carried a COMMENT reading
 * "ssrStreaming on; renderStreamingWeb may be consumed by app code" with no code behind it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Whether the adapter's own source reaches a server-side render of the document. */
function emitsDocumentRender(target: string): boolean {
  const file = SOURCE[target]
  if (file === undefined) return false
  const src = code(readFileSync(resolve(ADAPTERS, file), 'utf-8'))
  return (
    src.includes('renderStreamingWeb') ||
    src.includes('readDocumentShell') ||
    src.includes('entry-server')
  )
}

describe('the build announces SSR only where the target renders', () => {
  it('declares the capability for every target the build accepts', () => {
    // A target missing from the table would fall to whatever the default is, which is the silence
    // this test exists to remove.
    for (const target of VALID_TARGETS) {
      expect(
        typeof targetRendersDocument(target),
        `${target} has no declared document-render capability, so the build cannot tell whether ` +
          `announcing (SSR) for it would be true`,
      ).toBe('boolean')
    }
  })

  it('agrees with what each adapter actually emits', () => {
    // BOTH directions. A table claiming render where the adapter has no call is the original defect
    // wearing a data structure; a table denying it where the call exists would silence a real (SSR).
    const disagreements = VALID_TARGETS.filter(
      (t) => targetRendersDocument(t) !== emitsDocumentRender(t),
    ).map((t) => `${t}: table=${targetRendersDocument(t)} source=${emitsDocumentRender(t)}`)

    expect(
      disagreements,
      'the capability table disagrees with the adapters it describes, so the build announcement is ' +
        'derived from something that stopped being true',
    ).toEqual([])
  })

  it('pins the two ends of the fleet, so an empty diff list cannot be a broken detector', () => {
    // COUNTERPROOF for the sweep above: `toEqual([])` also passes over a table that is wrong in the
    // same direction as a broken detector. This pins the one target driven on its own runtime.
    // Bun renders after this item; `netlify` is the target that legitimately does not and says so.
    expect(targetRendersDocument('bun')).toBe(true)
    expect(targetRendersDocument('netlify')).toBe(false)
    expect(targetRendersDocument('cloudflare')).toBe(true)
  })

  it('derives the printed note from the capability, not from config.ssr alone', () => {
    // THE defect. One line in the CLI, and it is what made the build lie about three targets.
    const build = code(readFileSync(resolve(ADAPTERS, '../cli/commands/build.ts'), 'utf-8'))

    expect(
      build,
      'build.ts still computes the SSR note without asking whether the target can render, so a ' +
        'shell-serving target is announced as (SSR)',
    ).toContain('targetRendersDocument')
    expect(build).not.toMatch(/ssrNote\s*=\s*config\.ssr\s*\?/)
  })
})
