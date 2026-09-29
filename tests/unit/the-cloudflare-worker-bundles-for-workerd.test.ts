/**
 * The Cloudflare worker entry must be bundleable by the thing that bundles it.
 *
 * `wrangler deploy` hands `worker.mjs` to esbuild. esbuild has no vite plugin and cannot load a
 * native `.node` addon, and workerd cannot run one at any bundler setting. So an entry that is
 * valid under the vite build can still be undeployable, and until 2026-09-26 it was: the first real
 * `wrangler deploy` this repository ever attempted failed with three errors before sending a
 * request.
 *
 *     ✘ Could not resolve "/@theo/entry-server"        worker.mjs:16:35
 *     ✘ No loader is configured for ".node" files:     @swc/core-linux-x64-gnu/…node
 *     ✘ Could not resolve "@swc/wasm"                  @swc/core/index.js:88
 *
 * Two defects, and neither is visible to any test that existed. `tests/integration/wrangler-smoke`
 * drives `wrangler dev` against MINIFLARE — its own header says "no Cloudflare account required" —
 * and it is opt-in behind an env var. A dev server resolves differently from a deploy bundle.
 *
 * ## Why these assertions and not a bundle run
 *
 * Running esbuild here would need the wrangler binary, the network, and ~40s. These are the two
 * properties that FAILED, asserted on the generated text, which costs milliseconds and runs in
 * every suite. The bundle itself stays covered by `wrangler deploy --dry-run`, which reproduces the
 * failure exactly and needs no Cloudflare account — that is the operator's oracle, recorded in
 * B-263, and this is the one that catches a regression before anybody reaches for it.
 */
import { describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

describe('the Cloudflare worker entry bundles for workerd', () => {
  it('test_no_vite_virtual_module_survives_into_the_worker', () => {
    // `/@theo/entry-server` is a vite virtual id (`vite-plugin/index.ts`), resolved because
    // `adapters/node.ts` passes it as the vite build's `input`. Emitting it as literal import text
    // hands esbuild a module nobody registered.
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: true })

    expect(
      entry,
      'the worker imports a vite virtual id; esbuild has no vite plugin and cannot resolve it',
    ).not.toContain('/@theo/entry-server')
  })

  it('test_the_streaming_import_names_a_file_that_exists_on_disk', () => {
    // The same build writes `.theokit/server/entry-server.js`, and the worker lands at
    // `.theokit/cloudflare/worker.mjs`, so the resolvable spelling is one directory up.
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: true })

    expect(entry).toMatch(/import \{ renderStreamingWeb \} from '\.\.\/server\/entry-server\.js'/)
  })

  it('test_the_off_path_imports_no_renderer_at_all', () => {
    // COUNTERPROOF for the two above: with streaming off there is no import to get right, so a
    // green result there would prove nothing about the on path. This pins that the flag still gates
    // it rather than the fix having removed the branch.
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false })

    expect(entry).not.toContain('renderStreamingWeb }')
    expect(entry).not.toContain('/@theo/entry-server')
    expect(entry).not.toContain('../server/entry-server.js')
  })

  // `preloadsApplyTo` requires BOTH `ssrStreaming: true` and an `assetsMap` — without the map the
  // import is never emitted, so the two tests below would pass over a worker that does not exercise
  // the path at all. Measured while writing them: they went green on the unfixed code.
  const WITH_PRELOADS = { ssrStreaming: true, assetsMap: { '/': ['/assets/index-abc.js'] } }

  it('test_the_worker_does_not_import_the_deprecated_umbrella', () => {
    // Bisected with the real oracle: a worker whose ONLY line was `import { matchRoute } from
    // 'theokit/server'` pulled `@swc/core`'s `.node` native addon into the bundle. workerd cannot
    // load a `.node` at any bundler setting. The narrow subpaths probe clean (dry-run exit 0), and
    // the umbrella prints its own deprecation notice on import.
    const entry = renderCloudflareWorkerEntry(WITH_PRELOADS)

    expect(
      entry,
      "the worker imports the deprecated `theokit/server` umbrella, which drags @swc/core's native binding",
    ).not.toMatch(/from 'theokit\/server'/)
  })

  it('test_injectModulePreloads_is_reached_without_the_barrel', () => {
    // The function is still needed — this asserts the narrow path replaced the barrel rather than
    // the call being dropped, which would pass the test above and break the response.
    const entry = renderCloudflareWorkerEntry(WITH_PRELOADS)

    expect(entry).toContain('injectModulePreloads(')
    expect(entry).toMatch(/import \{[^}]*injectModulePreloads[^}]*\} from 'theokit\/server\/http'/)
  })
})
