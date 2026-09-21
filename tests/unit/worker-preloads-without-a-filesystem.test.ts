/**
 * B-035 T1.3 — the Cloudflare worker preloads a route's chunks without reading a filesystem.
 *
 * A Worker cannot read `.theokit/client/assets-map.json` at request time, so the map is baked into
 * the generated entry as a literal — the same reason and the same mechanism the document shell
 * already uses (`cloudflare.ts` #343).
 *
 * WHAT THESE ASSERTIONS ARE, stated plainly rather than implied: they read the EMITTED SOURCE.
 * That is the honest limit of what can be verified here, and it is the limit the sibling
 * `cloudflare-worker-has-no-filesystem.test.ts` already states for the same emitter. The entry
 * imports `/@theo/entry-server`, a Vite virtual module that resolves only inside a build, so
 * running the whole worker is not available to a unit test. Behaviour is covered against the Node
 * server in `tests/integration/route-preloads-its-chunks.test.ts`, and the injector itself in
 * `tests/unit/assets-map.test.ts`.
 *
 * **An earlier revision of this file compared the worker against a hand-written COPY of the
 * injector.** The copy is gone — the worker imports the real function from `theokit/server` — so
 * what is asserted now is the wiring that makes the copy unnecessary.
 */
import { describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

const MAP = { '/about': ['assets/page-about.js', 'assets/shared.js'], '/': [] }

const entry = (over: Record<string, unknown> = {}): string =>
  renderCloudflareWorkerEntry({
    ssrStreaming: true,
    htmlHead: '<html><head><title>App</title></head><body><div id="root">',
    htmlTail: '</div></body></html>',
    assetsMap: MAP,
    ...over,
  } as Parameters<typeof renderCloudflareWorkerEntry>[0])

describe('the worker preloads without reading a filesystem', () => {
  it('bakes the map as a literal and reads no file for it', () => {
    const source = entry()
    expect(source).toContain('const __THEO_ASSETS_MAP =')
    expect(source).toContain('assets/page-about.js')
    // The whole point: the map is DATA in the module, not a path to be opened.
    expect(source).not.toContain('assets-map.json')
    expect(source).not.toContain('readFileSync')
    expect(source).not.toContain('node:fs')
  })

  it('imports the injector rather than carrying a copy of it', () => {
    const source = entry()
    // One implementation, imported. The previous revision emitted a duplicate and it drifted
    // within a day — a fix for proxy-form request targets landed in the original only.
    // The subpath is `theokit/server/http`, not the `theokit/server` umbrella. The symbol was
    // first added to the umbrella alone, which the package smoke test correctly refused: an
    // export with no subpath of its own has no migration path off the deprecated barrel. A
    // specifier the package does not export resolves at build time here and fails at DEPLOY,
    // so the exact path is the assertion rather than the mere presence of an import.
    expect(source).toMatch(
      /import \{[^}]*\binjectModulePreloads\b[^}]*\} from 'theokit\/server\/http'/,
    )
    expect(source).not.toContain('function __theoInjectPreloads')
    expect(source).not.toContain('function __theoEscapeAttribute')
  })

  it('calls the injector with the baked map on the streaming branch', () => {
    // The literal is what is generated; asserting the CALL passes it is what stops the bake and
    // the call from being wired to different things.
    expect(entry()).toContain('injectModulePreloads(')
    expect(entry()).toContain('__THEO_ASSETS_MAP')
  })

  it('emits nothing about preloads when the build produced no map', () => {
    const source = entry({ assetsMap: undefined })
    expect(source).not.toContain('__THEO_ASSETS_MAP')
    expect(source).not.toContain('injectModulePreloads')
  })

  it('emits nothing about preloads when the target cannot render at request time', () => {
    // Found at review. Without streaming, the worker serves the document from `env.ASSETS` as a
    // static file and can inject nothing — so baking the route table would be pure weight.
    const source = entry({ ssrStreaming: false })
    expect(source).not.toContain('__THEO_ASSETS_MAP')
    expect(source).not.toContain('injectModulePreloads')
  })
})
