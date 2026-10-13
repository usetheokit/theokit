/**
 * `createA2ATool` ships from `@theokit/agents/a2a`, not from the root entry.
 *
 * The root bundle had reached 41 992 bytes against a 42 000-byte cap, and the A2A client is a
 * remote-delegation tool most agents never import. Paulo decided on 2026-10-09 to move it to its
 * own subpath in the same major the B-407 rewrite already carries (bundle decision F-arch-5), so
 * an app that never delegates over the network does not pay for it.
 *
 * Both halves are read from the BUILT output: the root `dist/index.js` must not carry the module,
 * and `dist/a2a.js` must export a callable `createA2ATool`. Without a build the test skips rather
 * than passing, for the reason `bundle-size.test.ts` gives.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const distDir = resolve(__dirname, '../../dist')

describe('the A2A tool subpath', () => {
  it('keeps createA2ATool out of the root bundle', (ctx) => {
    const path = resolve(distDir, 'index.js')
    if (!existsSync(path)) {
      ctx.skip()
      return
    }
    expect(readFileSync(path, 'utf8')).not.toContain('createA2ATool')
  })

  it('exports a callable createA2ATool from dist/a2a.js', async (ctx) => {
    const path = resolve(distDir, 'a2a.js')
    if (!existsSync(resolve(distDir, 'index.js'))) {
      ctx.skip()
      return
    }
    expect(existsSync(path), `${path} was not built`).toBe(true)
    const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>
    expect(typeof mod.createA2ATool).toBe('function')
  })
})
