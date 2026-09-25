/**
 * `ssrStreaming: true` is accepted by the schema and never reaches the build.
 *
 * Measured 2026-09-24 while accepting M2 against the released delivery. The scaffold declared
 * `ssr: true, ssrStreaming: true`, the build reported `✓ Build complete → node (SSR)`, and what was
 * served was the fully buffered document: reading the raw TCP socket on a route with a Suspense
 * boundary gave a single arrival whose time tracked the suspend delay — 60ms delay, TTFB 73ms;
 * 800ms delay, TTFB 815ms. The emitted entry exported `render` and nothing else, so
 * `cli/commands/start/request-handler.ts` found no streaming renderer and took the synchronous path.
 *
 * The generator was never the problem. The flag could not get to it, because the contract it travels
 * through has no field for it:
 *
 *   adapters/types.ts      makeVitePlugins?: (opts: { root: string; ssr?: boolean })
 *   adapters/node.ts       ctx.makeVitePlugins({ root: cwd, ssr: … })
 *   cli/commands/build.ts  theoPluginAsync({ ...opts, appDir, serverDir, agentsDir })
 *   vite-plugin/index.ts   streamingEnabled: options.ssrStreaming === true      // undefined === true
 *
 * `build.ts` carries a comment recording this same defect fixed once before, for the directories
 * (`#95`). The streaming flag was not included that time.
 *
 * ## Why the broken link is asserted on the source and the working one on behaviour
 *
 * The broken link is `nodeAdapter.build` handing opts to the plugin factory, and reaching it means
 * running the build: `vite` is externalised by this workspace's vitest config, so neither `vi.mock`
 * nor `vi.doMock` intercepts it — the real Rollup runs and fails on a missing `index.html`, which is
 * a failure about the harness rather than about the flag. `regression-build-uses-theo-plugin-async.test.ts`
 * reached the same conclusion for the same call site and says so: "a full integration test would
 * require dogfood-style E2E build".
 *
 * So that link is asserted as a DECLARATION — a field that exists or does not, checkable by anyone
 * with a grep — and the link that IS reachable without Rollup is asserted as behaviour.
 *
 * Both directions are held on purpose. The fix moves a boundary, and the half that is easy to break
 * while moving it is the OFF case: a build that streams when nobody asked is the same class of defect
 * pointed the other way.
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { generateEntryServer } from '../../packages/theo/src/router/entry-server.js'
import { theoPluginAsync } from '../../packages/theo/src/vite-plugin/index.js'

const ADAPTER_TYPES = resolve(__dirname, '../../packages/theo/src/adapters/types.ts')
const ADAPTER_NODE = resolve(__dirname, '../../packages/theo/src/adapters/node.ts')

/** `vite-plugin/index.ts` — the id Vite hands to `load` for the server entry. */
const RESOLVED_ENTRY_SERVER_ID = '\0@theo/entry-server'

/** A real project root, because the plugin factory resolves directories against it. */
function scratchProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'theo-streaming-flag-'))
  mkdirSync(join(root, 'src', 'app'), { recursive: true })
  return root
}

/** Emit the server entry the way Vite does: through the plugin chain's own `load` hook. */
async function emitServerEntry(options: Record<string, unknown>): Promise<string> {
  const root = scratchProject()
  const plugins = await theoPluginAsync({ root, appDir: 'src/app', ...options } as never)

  for (const plugin of plugins) {
    const load = (plugin as { load?: unknown }).load
    if (typeof load !== 'function') continue
    const out = await (load as (id: string, o?: { ssr?: boolean }) => unknown).call(
      plugin,
      RESOLVED_ENTRY_SERVER_ID,
      { ssr: true },
    )
    if (typeof out === 'string') return out
  }
  throw new Error('no plugin in the chain emitted the server entry')
}

describe('the ssrStreaming flag reaches the plugin that selects the entry', () => {
  it('test_the_make_vite_plugins_contract_has_a_field_for_the_streaming_flag', () => {
    // Given: the contract the CLI implements and the adapters call through
    const source = readFileSync(ADAPTER_TYPES, 'utf8')

    // When: we read the opts object `makeVitePlugins` accepts
    const match = source.match(/makeVitePlugins\?:\s*\(opts:\s*\{([^}]*)\}/s)
    expect(match, 'makeVitePlugins must declare an opts object').not.toBeNull()

    // Then: it declares the streaming flag. Without a field, no caller can pass one, and
    // `vite-plugin/index.ts` reads `options.ssrStreaming === true` on an `undefined` forever.
    expect(match![1]).toContain('ssrStreaming')
  })

  it('test_the_node_adapter_passes_the_streaming_flag_on_every_plugin_invocation', () => {
    // Given: the node adapter, which composes a plugin chain per Vite build
    const source = readFileSync(ADAPTER_NODE, 'utf8')

    // When: we read every opts object it builds
    const calls = source.match(/ctx\.makeVitePlugins\(\{[^}]*\}\)/g) ?? []

    // Then: both the client build and the SSR build carry the flag. The client build matters too —
    // the manifest it emits decides whether pages stay lazy, which is what makes React suspend.
    expect(calls.length, 'expected the client build and the SSR build').toBeGreaterThanOrEqual(2)
    for (const [i, call] of calls.entries()) {
      expect(call, `makeVitePlugins call ${String(i + 1)} does not pass ssrStreaming`).toContain(
        'ssrStreaming',
      )
    }
  })
})

describe('what already works, held so the fix cannot break it', () => {
  it('test_the_plugin_emits_a_streaming_entry_when_the_flag_is_on', async () => {
    const source = await emitServerEntry({ ssrStreaming: true })

    // `onShellReady` is the whole difference: it is where the head is written before React produces
    // a byte, and it is the export name `ssr-setup.ts` needs to find a streaming path at all.
    expect(source).toContain('onShellReady')
    expect(source).toContain('renderToPipeableStream')
  })

  it('test_the_plugin_emits_a_buffering_entry_when_the_flag_is_absent', async () => {
    const source = await emitServerEntry({})

    // Asserting the shape rather than the absence of a name: this is the branch the served build
    // actually took, and it must keep being the default nobody asked for.
    expect(source).toMatch(/html \+= chunk/)
    expect(source).not.toContain("setHeader('Transfer-Encoding', 'chunked')")
  })

  it('test_the_generator_itself_answers_both_ways', () => {
    expect(generateEntryServer({ streaming: true })).toContain('onShellReady')
    expect(generateEntryServer({ streaming: false })).toMatch(/html \+= chunk/)
  })
})
