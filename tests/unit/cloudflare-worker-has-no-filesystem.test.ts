import { describe, it, expect } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'

/**
 * usetheokit/theokit#369 — the generated Worker discovered its routes by reading
 * a directory, in a runtime that has no directories.
 *
 * Three calls, all impossible on Workers:
 *
 *   - `scanServerRoutes(serverDir)` — a `readdirSync`
 *   - `scanWebSocketRoutes(serverDir)` — the same
 *   - `createProductionLoader()` — `pathToFileURL(path)` then `import(url)`,
 *     which needs `node:url` and a file to point at
 *
 * The adapter already knows the answer to this class of problem and applies it
 * one line away: the document shell is read at BUILD time and inlined as a
 * literal, with the comment "a Worker has no filesystem at request time"
 * (#343). Routes take the same road — scanned on the build machine, emitted as
 * static imports and a literal table.
 *
 * These assertions read the emitted source. That is the honest limit of what
 * can be verified here: no deploy runs in CI, so this proves the Worker no
 * longer calls three APIs that cannot exist, and does not prove it serves a
 * request on the platform.
 */

const ROUTES = [
  { filePath: 'server/routes/users.ts', routePath: '/api/users', methods: ['GET', 'POST'] },
  { filePath: 'server/routes/health.ts', routePath: '/api/health', methods: ['GET'] },
]

describe('the generated Cloudflare Worker touches no filesystem (#369)', () => {
  it('test_it_does_not_scan_a_directory_at_runtime', () => {
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false, routes: ROUTES })

    // The CALL, not the mention: the emitted source names both functions in
    // comments explaining what it stopped doing, and that history is worth
    // keeping. A test that banned the string would delete the explanation.
    expect(entry).not.toMatch(/scanServerRoutes\(/u)
    expect(entry).not.toMatch(/scanWebSocketRoutes\(/u)
    expect(entry).not.toMatch(/^import .*\bscanServerRoutes\b/mu)
  })

  it('test_it_does_not_import_a_module_by_file_path_at_runtime', () => {
    // `createProductionLoader` resolves `pathToFileURL(path)` and imports it.
    // There is no path to resolve and no file to import.
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false, routes: ROUTES })

    expect(entry).not.toMatch(/createProductionLoader\(/u)
    expect(entry).not.toMatch(/^import .*\bcreateProductionLoader\b/mu)
  })

  it('test_every_route_module_is_imported_statically', () => {
    // Static, so Wrangler's bundler follows them and the code is IN the worker
    // rather than expected beside it — `wrangler.toml` uploads `.theokit/client`
    // and has never uploaded `server/`.
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false, routes: ROUTES })

    expect(entry).toMatch(/^import \* as \w+ from '.*server\/routes\/users\.ts'$/mu)
    expect(entry).toMatch(/^import \* as \w+ from '.*server\/routes\/health\.ts'$/mu)
  })

  it('test_the_route_table_is_a_literal_carrying_each_path_and_its_methods', () => {
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false, routes: ROUTES })

    // Quoting is the emitter's business; the values are the contract.
    expect(entry).toMatch(/routePath: ["']\/api\/users["']/u)
    expect(entry).toMatch(/routePath: ["']\/api\/health["']/u)
    expect(entry).toMatch(/["']POST["']/u)
  })

  it('test_an_unknown_module_is_refused_by_name_rather_than_returning_undefined', () => {
    // The loader can only serve what the build baked in. Asked for anything
    // else it must say so: returning `undefined` would surface later as a
    // property access on nothing, far from the cause.
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false, routes: ROUTES })

    expect(entry).toMatch(/throw new Error\([^)]*not bundled|was not bundled/u)
  })

  it('test_a_project_with_no_routes_still_emits_a_worker', () => {
    // The empty case is the scaffold's first build, and it must not emit a
    // syntax error — which is how #344 shipped.
    const entry = renderCloudflareWorkerEntry({ ssrStreaming: false, routes: [] })

    expect(entry).toContain('export default')
    expect(entry).not.toMatch(/scanServerRoutes\(/u)
  })
})
