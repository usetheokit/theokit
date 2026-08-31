/**
 * A deploy adapter must emit the project's ACTUAL server directory, not the literal `server`.
 *
 * `serverDir` is configurable and defaults to `server`, so every adapter that hardcodes the string
 * agrees with the default by coincidence. The moment a project sets it — which is the whole point
 * of the option — the generated entrypoint resolves a directory that does not exist, and it does so
 * only after deploy: the build succeeds, the bundle is written, and routes 404 in production with
 * nothing in the log naming the cause.
 *
 * Measured before this test existed: `bun`, `cloudflare`, `vercel` and `aws-lambda` all emitted
 * `resolve(cwd, 'server')` (or the Cloudflare equivalent) while receiving the full `TheoConfig` as
 * an argument. The value was in hand and unused.
 *
 * This is a **generated-code** assertion, which is why it reads the emitted string rather than
 * calling the entrypoint: the defect lives in what is written to disk for another runtime to
 * execute, so that text is the artifact under test.
 */
import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

const CUSTOM = 'src/server'

describe('deploy adapters resolve the configured server directory', () => {
  it('bun emits the configured directory, not the literal `server`', () => {
    const entry = renderBunEntry(3000, { serverDir: CUSTOM })

    expect(entry).toContain(CUSTOM)
  })

  it('bun does not emit a bare `server` when another directory was configured', () => {
    // The load-bearing half. Without it, an adapter that emitted BOTH paths would satisfy the
    // assertion above while still resolving the wrong one at runtime.
    const entry = renderBunEntry(3000, { serverDir: CUSTOM })

    expect(entry).not.toMatch(/resolve\(cwd,\s*['"]server['"]\)/u)
  })

  it('falls back to `server` when nothing was configured', () => {
    // The default has to keep working: `serverDir` defaults to `server` in the schema, and an
    // adapter that demanded the option would break every project that never set it.
    const entry = renderBunEntry(3000)

    expect(entry).toMatch(/resolve\(cwd,\s*['"]server['"]\)/u)
  })

  it('emits the directory as a quoted, escaped literal', () => {
    // The generated file is TypeScript source, so a naively interpolated path becomes a syntax
    // error in someone else's build — a worse failure than the one being fixed.
    //
    // Asserted through `JSON.stringify` rather than against a hand-written `'…'`: the first
    // version of this test pinned the QUOTE STYLE, which is not the contract. Single quotes would
    // satisfy it while still breaking on a value containing one.
    const dir = 'my server/api'
    const entry = renderBunEntry(3000, { serverDir: dir })

    expect(entry).toContain(JSON.stringify(dir))
  })

  it('escapes a directory containing a quote instead of emitting broken source', () => {
    // The case the quoting exists for, and the one a `'…'` wrapper gets wrong. Absurd as a
    // directory name, but it is user config reaching a code generator: the generator does not get
    // to assume the value is well-behaved.
    const dir = `we"ird`
    const entry = renderBunEntry(3000, { serverDir: dir })

    expect(entry).toContain(JSON.stringify(dir))
    expect(entry).not.toContain(`resolve(cwd, "we"ird")`)
  })
})
describe('every adapter that emits a server directory honours the config', () => {
  /**
   * Table-driven because the defect was identical in four files and a per-adapter test would have
   * had to be remembered four times. A fifth adapter added tomorrow is one row, and forgetting the
   * row is visible in a way that forgetting a whole file is not.
   *
   * Each entry renders with a directory nobody would pick by accident, so a hardcoded `'server'`
   * cannot pass by coincidence — which is exactly how these four passed before.
   */
  const adapters: readonly [string, (dir: string) => string][] = [
    ['bun', (dir) => renderBunEntry(3000, { serverDir: dir })],
    ['aws-lambda', (dir) => renderAwsLambdaEntry({ serverDir: dir })],
    ['cloudflare', (dir) => renderCloudflareWorkerEntry({ serverDir: dir })],
    ['vercel', (dir) => renderVercelFunctionEntry({ serverDir: dir })],
  ]

  it.each(adapters)('%s emits the configured directory', (_name, render) => {
    expect(render(CUSTOM)).toContain(JSON.stringify(CUSTOM))
  })

  it.each(adapters)('%s does not fall back to a bare `server` literal', (_name, render) => {
    const emitted = render(CUSTOM)

    // `'server'` in single quotes is what all four used to emit. Matching it specifically keeps
    // the assertion from tripping on the word appearing in an import or a comment.
    expect(emitted).not.toMatch(/=\s*'server'|,\s*'server'\)/u)
  })
})
