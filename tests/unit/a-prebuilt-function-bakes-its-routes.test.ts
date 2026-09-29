/**
 * A deployed entry whose platform uploads only what it bundled must bake its routes.
 *
 * The Vercel function scanned for them at request time — `scanServerRoutes(resolve(process.cwd(),
 * 'src/server'))`, a `readdirSync` — against a directory Build Output API v3 never uploads. The
 * function loaded, ran, and answered its own JSON 404 for every route the project declares.
 *
 * Measured on a deployed Vercel function, 2026-09-28 (B-319), with `src/server/routes/health.ts`
 * present in the project:
 *
 *     GET /api/health        ->  404  {"error":{"code":"NOT_FOUND"}}
 *     GET /api/agents/chat   ->  404  {"error":{"code":"NOT_FOUND"}}
 *     .vercel/output/functions/api.func/  ->  index.mjs, .vc-config.json, assets/   (no src/)
 *
 * Cloudflare solved the identical problem in #369 and the reasoning transfers verbatim: a platform
 * that uploads a bundle and nothing else has no filesystem to scan, so the routes are imported
 * statically at build time and the loader refuses anything the build did not bake.
 *
 * ## Why this is not B-315, which was a real fix
 *
 * B-315 corrected the PATH the scan resolves — `server` to `src/server`. Correcting where it looks
 * does not put the files there. A reader who conflates the two will read this 404 as a path bug.
 *
 * ## Why the emitters are shared rather than copied
 *
 * `renderBakedRoutes` and the route runtime were private to `cloudflare.ts`, and two adapters need
 * them. B-315 is what five copies of one call look like after a while: the same option threaded
 * correctly by two adapters and forgotten by three. One emitter, parameterised by the target it
 * names in its own error message.
 */
import { describe, expect, it } from 'vitest'

import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'
// The string-aware stripper, shared. Seven files carried a byte-identical regex copy that read
// `"/*"` in netlify.ts as a comment opener and deleted 36% of that file (B-338).
import { withoutComments as code } from './_helpers/adapter-source.js'

const ROUTES = [
  { filePath: 'src/server/routes/health.ts', routePath: '/api/health', methods: ['GET'] },
  { filePath: 'src/server/routes/users/[id].ts', routePath: '/api/users/:id', methods: ['GET'] },
] as const

describe('a prebuilt function bakes its routes', () => {
  it('test_each_route_is_imported_statically', () => {
    // Static, because the bundler follows static imports and nothing else. A dynamic `import(path)`
    // built from a string is exactly what the platform cannot resolve, and it is what the runtime
    // loader did.
    const entry = code(renderVercelFunctionEntry({ serverDir: 'src/server', routes: ROUTES }))

    expect(
      entry,
      'the entry does not import its route modules, so the bundler never sees them and the ' +
        'uploaded function has no routes to match — every /api/* answers 404',
    ).toContain("from '../../src/server/routes/health.ts'")
    expect(entry).toContain("from '../../src/server/routes/users/[id].ts'")
  })

  it('test_the_route_table_carries_the_path_and_the_methods', () => {
    // The table is what `matchRoute` reads. Imports without a table give a function that bundled
    // its routes and cannot find them.
    const entry = code(renderVercelFunctionEntry({ serverDir: 'src/server', routes: ROUTES }))

    expect(entry).toContain('"/api/health"')
    expect(entry).toContain('"/api/users/:id"')
    expect(entry).toContain('"GET"')
  })

  it('test_nothing_scans_a_directory_at_request_time', () => {
    // THE case. The whole defect is one call surviving into a runtime with no filesystem.
    const entry = code(renderVercelFunctionEntry({ serverDir: 'src/server', routes: ROUTES }))

    expect(
      entry,
      'the entry still calls scanServerRoutes at request time, against a directory Build Output ' +
        'API v3 does not upload',
    ).not.toContain('scanServerRoutes(')
  })

  it('test_the_loader_refuses_a_path_the_build_did_not_bake', () => {
    // Fail-clear, per `rules/error-handling.md`. Returning `undefined` here surfaces as a property
    // access far from the cause, which is the shape that costs an afternoon.
    const entry = code(renderVercelFunctionEntry({ serverDir: 'src/server', routes: ROUTES }))

    expect(entry).toContain('was not bundled')
    // And it names the command that fixes it, with THIS target rather than Cloudflare's.
    expect(entry).toContain('--target vercel')
  })

  it('test_an_entry_with_no_routes_emits_an_empty_table', () => {
    // COUNTERPROOF for the shape: a build that scanned nothing must not emit a half table. An empty
    // table is correct and answers 404 honestly.
    //
    // Whether it PARSES is asserted by `adapter-entry-parses.test.ts`, which runs `node --check` —
    // the parser the runtime uses — over every emitted entry including this one. Re-checking it here
    // would mean a second, weaker parser, and the obvious one (`new Function`) is eval.
    const entry = code(renderVercelFunctionEntry({ serverDir: 'src/server', routes: [] }))

    expect(entry).not.toContain('scanServerRoutes(')
    expect(entry).toMatch(/^const ROUTE_MODULES = \{\n\}$/m)
  })

  it('test_the_cloudflare_entry_is_unchanged_by_the_extraction', async () => {
    // COUNTERPROOF across the seam. The emitters moved out of `cloudflare.ts` to be shared, and the
    // target that already worked must keep working — including the error message, which names its
    // own build command and not the other one.
    const { renderCloudflareWorkerEntry } =
      await import('../../packages/theo/src/adapters/cloudflare.js')
    const worker = code(renderCloudflareWorkerEntry({ routes: ROUTES }))

    expect(worker).toContain("from '../../src/server/routes/health.ts'")
    expect(worker).toContain('was not bundled')
    expect(worker).toContain('--target cloudflare')
    expect(worker).not.toContain('--target vercel')
  })
})
