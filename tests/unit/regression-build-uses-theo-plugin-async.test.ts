/**
 * Regression test — theokit 0.2.2 fix.
 *
 * `cli/commands/build.ts` must invoke `theoPluginAsync` (NOT the sync
 * `theoPlugin`) because only the async factory returns the full Plugin[]
 * chain — including the `@theo/actions` virtual module + the typed-client
 * plugin + the services-typed-client plugin + @theokit/ui auto-chain.
 *
 * Previous (broken in 0.2.1):
 *   const { theoPlugin } = await import('../../vite-plugin/index.js')
 *   makeVitePlugins: (opts) => [react(), theoPlugin(opts)].flat()
 *
 * Result: `pnpm build` of any app that imports `@theo/actions` (which is
 * any G3 consumer using `useAction(actions.foo)`) failed with:
 *   `Rollup failed to resolve import "@theo/actions" from app/...`
 *
 * Fix: switch to `theoPluginAsync` + `AdapterBuildContext.makeVitePlugins`
 * accepts `Plugin[] | Promise<Plugin[]>`; `adapter-node.ts` awaits the call.
 *
 * This test reads `build.ts` source to assert the regression cannot recur
 * via a silent revert. A full integration test would require dogfood-style
 * E2E build — covered separately in `theokit-build-succeeds.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const BUILD_TS = resolve(__dirname, '../../packages/theo/src/cli/commands/build.ts')
const ADAPTER_TYPES = resolve(__dirname, '../../packages/theo/src/adapters/types.ts')
const ADAPTER_NODE = resolve(__dirname, '../../packages/theo/src/adapters/node.ts')

describe('regression: build command wires theoPluginAsync (0.2.2 fix)', () => {
  it('build.ts imports theoPluginAsync (not sync theoPlugin)', () => {
    // Given: the build command source
    const source = readFileSync(BUILD_TS, 'utf8')

    // When: we look at the vite-plugin import
    const importMatch = source.match(
      /const\s+\{\s*([A-Za-z, \n\t]+?)\s*\}\s*=\s*await\s+import\(['"]\.\.\/\.\.\/vite-plugin\/index\.js['"]\)/,
    )

    // Then: it must destructure `theoPluginAsync`, NOT `theoPlugin`
    expect(importMatch, 'build.ts must dynamically import from vite-plugin/index.js').not.toBeNull()
    const destructured = importMatch![1].trim()
    expect(destructured).toContain('theoPluginAsync')
    expect(destructured).not.toMatch(/^theoPlugin\b/) // bare `theoPlugin` is the broken sync version
  })

  it('build.ts makeVitePlugins is async + spreads theoPluginAsync result', () => {
    // Given: the build command source
    const source = readFileSync(BUILD_TS, 'utf8')

    // When: we look at the makeVitePlugins factory
    // Then: it must be `async (opts) =>` and `await theoPluginAsync(...)`. Since #95 the call spreads
    // `opts` with the config dirs (`theoPluginAsync({ ...opts, appDir, serverDir, agentsDir })`), so we
    // assert the async call + the opts spread rather than the exact `(opts)` literal.
    expect(source).toMatch(/makeVitePlugins:\s*async\s*\(/)
    expect(source).toMatch(/await theoPluginAsync\(\s*\{?\s*\.\.\.opts/)
  })

  it('AdapterBuildContext.makeVitePlugins type accepts Promise<Plugin[]>', () => {
    // Given: the adapters/types.ts contract
    const source = readFileSync(ADAPTER_TYPES, 'utf8')

    // Then: the return type union must include Promise<Plugin[]>
    expect(source).toMatch(/makeVitePlugins\?:.*Plugin\[\]\s*\|\s*Promise<Plugin\[\]>/s)
  })

  it('adapter-node.ts awaits ctx.makeVitePlugins (both client + ssr builds)', () => {
    // Given: the node adapter source
    const source = readFileSync(ADAPTER_NODE, 'utf8')

    // Then: both viteBuild calls must `await ctx.makeVitePlugins(...)`
    const awaitCalls = source.match(/await\s+ctx\.makeVitePlugins\(/g) ?? []
    expect(
      awaitCalls.length,
      'expected 2 awaited makeVitePlugins calls (client + SSR build)',
    ).toBeGreaterThanOrEqual(2)
  })
})
