/**
 * The optional peer dependencies that broke every scaffold's first Cloudflare deploy.
 *
 * `@theokit/sdk` reaches its storage backends through bare dynamic imports behind a loader-override
 * seam — `overrides?.betterSqlite3?.() ?? import('better-sqlite3')`. The seam is right; the fallback
 * is statically resolvable, so wrangler's esbuild resolves it at BUILD time and a project that never
 * installed the package cannot be bundled at all.
 *
 * Measured 2026-09-30 on a fresh `create-theokit` scaffold installed from npm:
 *
 *     wrangler deploy
 *       ✘ [ERROR] Could not resolve "better-sqlite3"
 *           node_modules/@theokit/sdk/dist/chunk-XZHJYSPB.js:76:74
 *
 * ## Why the list is DERIVED and not written down
 *
 * The first cut of this fix hardcoded the three names a grep of that dist turned up. It was already
 * wrong: the SDK declares SEVEN optional peers and `@lancedb/lancedb` — another native module — was
 * not among the three. A list of names in this repository is a second copy of a fact the dependency
 * already publishes, and it rots on the release where the dependency adds the eighth.
 *
 * The declaration is `peerDependenciesMeta.<name>.optional === true`, which is exactly the statement
 * "this may be absent". Measured across the scaffold's ten direct dependencies: 28 absent optional
 * peers from four owners.
 *
 * ## Why aliasing all of them is correct rather than over-broad
 *
 * Most of those 28 belong to `@theokit/ui` and appear only in the CLIENT bundle, which vite builds.
 * An alias for a module the worker graph never imports is inert config — it changes nothing. The
 * alternative is deciding which owners are "server-side", and that judgement is exactly the
 * hardcoding this design removes.
 *
 * Two filters are real, not conveniences:
 *
 *   - an INSTALLED optional peer is left alone. The consumer installed it deliberately, and aliasing
 *     it would overrule that. It also means the table shrinks by itself the day they add one.
 *   - `@types/*` is skipped. A types package never appears in a runtime import graph.
 */
import { describe, expect, it } from 'vitest'

import {
  absentOptionalPeers,
  renderWranglerToml,
  renderWorkersUnsupportedStub,
  WORKERS_UNSUPPORTED_STUB_PATH,
} from '../../packages/theo/src/adapters/cloudflare.js'

/** Who declares which optional peers, as a table rather than a nested ternary. */
const OPTIONAL_PEERS: Record<string, readonly string[]> = {
  theokit: ['better-sqlite3', 'sqlite-vec', 'ws', '@types/ws'],
  '@theokit/ui': ['mermaid', 'tailwindcss'],
}

/** The shape `absentOptionalPeers` reads, so the decision is testable without a node_modules tree. */
const PROJECT = {
  directDependencies: ['theokit', '@theokit/ui'],
  optionalPeersOf: (name: string) => OPTIONAL_PEERS[name] ?? [],
  isInstalled: (name: string) => name === 'ws' || name === 'tailwindcss',
}

describe('the worker bundle survives an uninstalled optional import', () => {
  it('names every absent optional peer', () => {
    // THE case: without `better-sqlite3` here the bundle cannot be produced at all.
    expect(absentOptionalPeers(PROJECT)).toEqual(['better-sqlite3', 'sqlite-vec', 'mermaid'])
  })

  it('leaves an installed optional peer alone', () => {
    // `ws` and `tailwindcss` are installed, so the consumer meant to have them. Aliasing an installed
    // module would overrule a decision they made, and would keep overruling it after they made it.
    const names = absentOptionalPeers(PROJECT)

    expect(names).not.toContain('ws')
    expect(names).not.toContain('tailwindcss')
  })

  it('skips a types-only package', () => {
    // `@types/ws` is declared optional and absent, and never appears in a runtime import graph.
    expect(absentOptionalPeers(PROJECT)).not.toContain('@types/ws')
  })

  it('emits no alias table when nothing is absent', () => {
    // COUNTERPROOF: the table must not appear unconditionally. A project with every optional peer
    // installed has nothing to compensate, and an empty `[alias]` is noise that reads as a decision.
    const toml = renderWranglerToml({ workersUnsupported: [] })

    expect(toml).not.toContain('[alias]')
  })

  it('points every alias at the stub the build emits', () => {
    // An alias to a path nothing writes fails the same way it failed before, one layer down.
    const toml = renderWranglerToml({ workersUnsupported: ['better-sqlite3', 'sqlite-vec'] })

    expect(toml).toContain('[alias]')
    expect(toml).toContain(`"better-sqlite3" = "./${WORKERS_UNSUPPORTED_STUB_PATH}"`)
    expect(toml).toContain(`"sqlite-vec" = "./${WORKERS_UNSUPPORTED_STUB_PATH}"`)
  })

  it('puts the alias table after the assets table', () => {
    // COUNTERPROOF for placement: TOML tables are positional, so a key emitted after `[assets]`
    // belongs to it. `[alias]` must open its own table.
    const toml = renderWranglerToml({ workersUnsupported: ['better-sqlite3'] })

    expect(toml.indexOf('[alias]')).toBeGreaterThan(toml.indexOf('[assets]'))
  })

  it('emits a stub that throws and names what to do', () => {
    // The seam's contract: reaching this import means no override was supplied. It must fail, and the
    // message must name the remedy — otherwise the runtime error is about a path in `.theokit`.
    const stub = renderWorkersUnsupportedStub()

    expect(stub).toMatch(/throw new Error/)
    expect(stub, 'the error must name the override seam, not esbuild or a build path').toMatch(
      /override/i,
    )
  })
})
