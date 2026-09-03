/**
 * The server-only import boundary's RULE — what it refuses, what it must not refuse, and whether
 * the name it prints matches the name the package publishes.
 *
 * The reachability question ("does `theokit build` ever run this?") is answered by
 * `tests/integration/server-only-import-boundary.test.ts`, which spawns the real CLI. This file
 * answers the complementary one the integration test cannot afford to sweep: does the rule cover
 * the WHOLE published server surface, and only it.
 *
 * ## Where the fixture comes from
 *
 * Not from the detector's idea of "server-only". The subpath list is read out of
 * `packages/theo/package.json`'s `exports` map at test time — the same map Node resolves against in
 * a consumer's `node_modules`. That map is written by whoever adds an entry point, not by the
 * boundary, so it can disagree with the boundary: publish `./server/foo` and forget the boundary,
 * and the first assertion fails; make the boundary refuse `./client` and the second one does. A
 * fixture that listed the subpaths by hand would agree with the code by construction and detect
 * neither.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ACTION_SCHEMAS_DIR } from '../../packages/theo/src/server/scan/action-scan.js'
import {
  ServerOnlyImportError,
  serverOnlyImportBoundary,
} from '../../packages/theo/src/vite-plugin/server-boundary.js'

const REPO = resolve(__dirname, '../..')
const THEO_PKG = resolve(REPO, 'packages/theo/package.json')
const THEO_SRC = resolve(REPO, 'packages/theo/src')

const PROJECT_ROOT = '/tmp/theo-boundary-unit-fixture'
const SERVER_DIR = join(PROJECT_ROOT, 'server')
const A_CLIENT_PAGE = join(PROJECT_ROOT, 'app/about/page.tsx')

interface ExportsMap {
  exports: Record<string, { import: string }>
}

/** Every subpath key of the published `exports` map, e.g. `.`, `./server`, `./client/core`. */
/**
 * `./package.json` is excluded here and in `exportTargets` below. It is the one subpath that
 * maps to a plain string rather than a conditions object, because it is METADATA and not an
 * entry point: nothing imports it, so it has no source file behind it and no boundary to
 * cross. Every helper in this file assumes `{ import: './dist/....js' }` and would read
 * `undefined` from it.
 *
 * It exists so that `require('theokit/package.json')` resolves at all — without it Node answers
 * ERR_PACKAGE_PATH_NOT_EXPORTED, which bundlers, test-runner resolvers and version telemetry
 * all hit.
 */
const IS_ENTRY_POINT = (subpath: string): boolean => subpath !== './package.json'

function publishedSubpaths(): string[] {
  const pkg = JSON.parse(readFileSync(THEO_PKG, 'utf8')) as ExportsMap
  return Object.keys(pkg.exports).filter(IS_ENTRY_POINT)
}

/**
 * The SOURCE file a published subpath is built from.
 *
 * `exports` names the build output (`./dist/server/define/index.js`); a test running against the
 * workspace resolves the same entry point through the alias `config-hook.ts` installs, which points
 * at `src`. The mapping between the two is the tsup layout, and it is one substitution.
 */
function sourceFileFor(pkgExportTarget: string): string {
  return join(THEO_SRC, pkgExportTarget.replace(/^\.\/dist\//, '').replace(/\.js$/, '.ts'))
}

function exportTargets(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(THEO_PKG, 'utf8')) as ExportsMap
  return Object.fromEntries(
    Object.entries(pkg.exports)
      .filter(([k]) => IS_ENTRY_POINT(k))
      .map(([k, v]) => [k, v.import]),
  )
}

const isServerSubpath = (subpath: string): boolean =>
  subpath === './server' || subpath.startsWith('./server/')

/** Specifier a consumer writes for a subpath key: `./server/define` → `theokit/server/define`. */
const specifierFor = (subpath: string): string =>
  subpath === '.' ? 'theokit' : `theokit/${subpath.slice(2)}`

/**
 * Ask the boundary to resolve one import, and report the error it threw (or `undefined`).
 *
 * `resolveId` is invoked directly here because the RULE is what is under test; the production
 * wiring that gets Rollup to call it is asserted end-to-end in the integration suite.
 */
async function refusalFor(
  source: string,
  opts?: { importer?: string; noImporter?: boolean; ssr?: boolean },
): Promise<ServerOnlyImportError | undefined> {
  const plugin = serverOnlyImportBoundary({ projectRoot: PROJECT_ROOT, serverDir: SERVER_DIR })
  const hook = plugin.resolveId
  if (typeof hook !== 'function') throw new Error('resolveId must be a plain function hook')
  try {
    // The hook refuses by throwing, so the resolved value is never interesting. It is awaited
    // because Rollup types the hook as possibly async, and an unawaited rejection would be
    // reported as an unhandled promise rather than as a refused import.
    await hook.call(
      // The hook reads none of the Rollup plugin context; an empty object keeps the test honest
      // about that, and fails loudly the day it starts reading one.
      {} as never,
      source,
      opts?.noImporter === true ? undefined : (opts?.importer ?? A_CLIENT_PAGE),
      { ssr: opts?.ssr ?? false } as never,
    )
    return undefined
  } catch (error) {
    if (error instanceof ServerOnlyImportError) return error
    throw error
  }
}

describe('the boundary covers the published server surface, and only it', () => {
  it('refuses every `./server*` entry point the package publishes', async () => {
    // Arrange: the surface, read from the map a consumer's Node resolves against.
    const serverSubpaths = publishedSubpaths().filter(isServerSubpath)
    expect(
      serverSubpaths.length,
      'the exports map should publish a server surface',
    ).toBeGreaterThan(1)

    // Act + Assert: both forms a specifier can arrive in — as written, and as the
    // `theokit/server` alias rewrites it before any `enforce: 'pre'` plugin sees it.
    const targets = exportTargets()
    for (const subpath of serverSubpaths) {
      const written = await refusalFor(specifierFor(subpath))
      expect(written, `bare specifier ${specifierFor(subpath)} was not refused`).toBeInstanceOf(
        ServerOnlyImportError,
      )

      const aliased = await refusalFor(sourceFileFor(targets[subpath]))
      expect(aliased, `aliased path for ${subpath} was not refused`).toBeInstanceOf(
        ServerOnlyImportError,
      )
    }
  })

  it('names the module exactly as the package publishes it', async () => {
    // The message is the deliverable. A refusal that prints an internal file path sends the reader
    // looking for a file instead of at the import they wrote.
    const targets = exportTargets()
    for (const subpath of publishedSubpaths().filter(isServerSubpath)) {
      const refusal = await refusalFor(sourceFileFor(targets[subpath]))
      expect(refusal?.module, `wrong name for ${subpath}`).toBe(specifierFor(subpath))
    }
  })

  it('lets every non-server entry point through', async () => {
    // The other direction of the same anchor. `theokit/client`, `theokit/client/core`,
    // `theokit/react-query` and the bare barrel are what client code is SUPPOSED to import; a
    // boundary that over-matched would break every app while all the refusal assertions stayed
    // green.
    const targets = exportTargets()
    const clientSubpaths = publishedSubpaths().filter((s) => !isServerSubpath(s))
    expect(clientSubpaths).toContain('./client')

    for (const subpath of clientSubpaths) {
      expect(
        await refusalFor(specifierFor(subpath)),
        `${specifierFor(subpath)} was refused`,
      ).toBeUndefined()
      expect(
        await refusalFor(sourceFileFor(targets[subpath])),
        `the source file behind ${subpath} was refused`,
      ).toBeUndefined()
    }
  })
})

describe("the boundary and the project's own server directory", () => {
  it('refuses a client page that imports a route module, naming both', async () => {
    // Arrange + Act
    const refusal = await refusalFor('../../server/routes/health.js')

    // Assert: the criterion, in two fields.
    expect(refusal).toBeInstanceOf(ServerOnlyImportError)
    expect(refusal?.module).toContain(join('server', 'routes', 'health'))
    expect(refusal?.importer).toBe(join('app', 'about', 'page.tsx'))
  })

  it(`lets \`actions/${ACTION_SCHEMAS_DIR}/**\` through — the framework bundles it on purpose`, async () => {
    // Arrange: the path the `@theo/actions` facade emits an import for, built from the constant the
    // action scanner uses to find it. If someone renames the convention, this reads the new name
    // and the exemption follows — which is the whole reason the literal lives in one file.
    const schema = join(SERVER_DIR, 'actions', ACTION_SCHEMAS_DIR, 'greet.ts')

    // Act + Assert
    expect(await refusalFor(schema)).toBeUndefined()
    // …while its sibling, an actual action, is still server-only.
    expect(await refusalFor(join(SERVER_DIR, 'actions', 'greet.ts'))).toBeInstanceOf(
      ServerOnlyImportError,
    )
  })

  it('leaves the SSR graph alone', async () => {
    // Importing server code IS the point of the server bundle and of `ssrLoadModule`.
    expect(await refusalFor('theokit/server', { ssr: true })).toBeUndefined()
    expect(await refusalFor(join(SERVER_DIR, 'routes/health.ts'), { ssr: true })).toBeUndefined()
  })

  it('says nothing when there is no importing file to name', async () => {
    // A build entry has no importer, so the criterion's second half cannot be met. That is a
    // deliberate Vite config, not the accident this boundary exists to catch.
    expect(await refusalFor('theokit/server', { noImporter: true })).toBeUndefined()
  })
})

describe('the remedies the message names are real', () => {
  // Same discipline as `tests/unit/policy-gate-remedy-is-importable.test.ts`: a build error that
  // tells the reader to import something nobody exports reads as actionable and is not.
  const refusal = new ServerOnlyImportError({ module: 'theokit/server', importer: 'app/page.tsx' })

  it('`@theo/client` really exports `client`', () => {
    const emitter = readFileSync(join(THEO_SRC, 'vite-plugin/app-typed-client.ts'), 'utf8')
    expect(refusal.message).toContain("import { client } from '@theo/client'")
    expect(emitter).toContain("declare module '@theo/client'")
    expect(emitter).toMatch(/export const client\b/)
  })

  it('`@theo/actions` really exports `actions`', () => {
    const emitter = readFileSync(join(THEO_SRC, 'vite-plugin/actions-virtual-module.ts'), 'utf8')
    expect(refusal.message).toContain("import { actions } from '@theo/actions'")
    expect(emitter).toContain("declare module '@theo/actions'")
    expect(emitter).toMatch(/export const actions\b/)
  })

  it('names the module and the importing file, which is the whole criterion', () => {
    expect(refusal.message).toContain('theokit/server')
    expect(refusal.message).toContain('app/page.tsx')
    expect(refusal.name).toBe('ServerOnlyImportError')
  })
})

// Guards the one assumption the source-vs-dist mapping above rests on: that a published server
// entry point is built from a file of the same name under `src`. If tsup's layout changes, the
// mapping silently starts pointing at files that do not exist, and every "was refused" assertion
// above would then be testing a path nobody ships.
describe('the source-vs-dist mapping this file relies on', () => {
  it('resolves every published server entry point to a file that exists', () => {
    const targets = exportTargets()
    for (const subpath of publishedSubpaths().filter(isServerSubpath)) {
      const src = sourceFileFor(targets[subpath])
      expect(readFileSync(src, 'utf8').length, `${src} is empty or missing`).toBeGreaterThan(0)
      expect(dirname(src).startsWith(THEO_SRC)).toBe(true)
    }
  })
})
