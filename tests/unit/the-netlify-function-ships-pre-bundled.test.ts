/**
 * The Netlify function must ship bundled, and say so in the toml.
 *
 * `buildNetlify` wrote `renderNetlifyFunction(...)` to disk as source. That source imports
 * `theokit/server/scan` and five sibling sub-paths by bare specifier, so the file only runs if
 * something resolves them — and Netlify's own bundler is what tries. Measured end to end on the
 * Netlify emulator, 2026-09-29, driving `GET /api/health`:
 *
 *   1. Netlify's zisi/esbuild bundler emitted a `ReferenceError` on an identifier that was
 *      base64 of the source.
 *   2. Handed a file theokit had already bundled, it re-bundled it anyway and produced
 *      `SyntaxError: Invalid left-hand side in assignment`.
 *   3. Told `node_bundler = "none"`, Netlify shipped the file untouched and it RAN:
 *
 *          HTTP/1.1 200 OK
 *          x-request-id: 2efd96c3-…   x-trace-id: 2efd96c3-…
 *          {"status":"ok","timestamp":…,"framework":"TheoKit"}
 *
 * So the fix is two halves and neither works alone: theokit bundles the entry, AND the toml tells
 * Netlify not to bundle it again. Cloudflare and Vercel already bundle — this target was the one
 * shipping raw source and hoping the platform would resolve it.
 *
 * ## Why the toml half needs its own cases
 *
 * A second `[functions]` table is a TOML parse error, and `mergeNetlifyToml` works at the line
 * level by deliberate design (it avoids a TOML parser dependency). A project that already declares
 * `[functions]` for its own reasons — `directory`, `included_files`, `external_node_modules` — must
 * keep it and gain one key, not receive a duplicate table that breaks the whole file.
 *
 * And a project that explicitly chose a different bundler is the same situation as a `/api/*`
 * redirect pointing elsewhere: an intentional declaration that contradicts what this adapter needs.
 * `NetlifyConflictError` refuses the redirect case rather than overwriting it; `NetlifyFunctionsConflictError`
 * refuses for the same reason, as its own type — a redirect conflict and a bundler conflict need
 * different instructions, so one class for both would give the reader the wrong one.
 */
import { describe, expect, it } from 'vitest'

import {
  buildNetlify,
  mergeNetlifyToml,
  NetlifyFunctionsConflictError,
} from '../../packages/theo/src/adapters/netlify.js'
import type { TheoConfig } from '../../packages/theo/src/config/schema.js'

const baseConfig = { distDir: '.theokit', serverDir: 'server', ssr: false } as unknown as TheoConfig

describe('the Netlify function ships pre-bundled', () => {
  it('bundles the entry instead of writing the source raw', async () => {
    const bundled: Array<{ entryFileName: string; outDir: string; entrySource: string }> = []
    const written: Record<string, string> = {}

    await buildNetlify(baseConfig, '/cwd', {
      runNodeBuild: async () => {},
      writeFile: (p, c) => {
        written[p] = c
      },
      ensureDir: () => {},
      readTomlIfExists: () => null,
      bundleFunction: async (o) => {
        bundled.push({
          entryFileName: o.entryFileName,
          outDir: o.outDir,
          entrySource: o.entrySource,
        })
      },
    })

    expect(bundled, 'the entry was not handed to the bundler').toHaveLength(1)
    expect(bundled[0]?.entryFileName).toBe('theo.mjs')
    // A directory, not the shared functions dir: the bundler code-splits, and Netlify zips a
    // directory-shaped function whole so the chunks travel with it.
    expect(bundled[0]?.outDir).toContain('.netlify/functions/theo')
    // The bare specifiers are exactly what makes bundling necessary — the raw file cannot resolve
    // them on the platform.
    expect(bundled[0]?.entrySource).toContain('theokit/server/scan')

    expect(
      Object.keys(written).filter((k) => k.includes('theo.mjs')),
      'the raw source was still written to the function path, so the platform bundler gets it and ' +
        'produces the ReferenceError measured on the emulator',
    ).toEqual([])
  })

  it('still writes the toml through the seam', async () => {
    // COUNTERPROOF for the case above: asserting the function is NOT written must not be satisfied
    // by a build that writes nothing at all.
    const written: Record<string, string> = {}

    await buildNetlify(baseConfig, '/cwd', {
      runNodeBuild: async () => {},
      writeFile: (p, c) => {
        written[p] = c
      },
      ensureDir: () => {},
      readTomlIfExists: () => null,
      bundleFunction: async () => {},
    })

    expect(Object.keys(written).some((k) => k.endsWith('netlify.toml'))).toBe(true)
  })

  it('declares where the function is and that Netlify must not re-bundle it', () => {
    const toml = mergeNetlifyToml(null)

    expect(toml).toContain('[functions]')
    // Measured on the emulator: WITHOUT this key the CLI scans its default `netlify/functions/`,
    // finds nothing, and /api/* answers `Function not found...` with a 404. It is the key the
    // adapter never wrote, and the reason this target had never served a request.
    expect(toml).toContain('directory = ".netlify/functions"')
    expect(toml).toContain('node_bundler = "none"')
  })

  it('adds the key to an existing [functions] rather than a second table', () => {
    // A duplicate `[functions]` is a TOML parse error, so this is not a tidiness point.
    const toml = mergeNetlifyToml('[functions]\n  included_files = ["data/**"]\n')

    expect(
      toml.match(/^\[functions\]/gmu) ?? [],
      'a second [functions] table makes the whole netlify.toml unparseable',
    ).toHaveLength(1)
    expect(toml).toContain('node_bundler = "none"')
    expect(toml, "the project's own key was dropped").toContain('included_files = ["data/**"]')
    expect(toml).toContain('directory = ".netlify/functions"')
  })

  it('refuses when the project explicitly chose another bundler', () => {
    // Same situation as a /api/* redirect pointing elsewhere: a deliberate declaration that
    // contradicts what this adapter needs. Overwriting it silently would break their build for a
    // reason nothing states.
    expect(() => mergeNetlifyToml('[functions]\n  node_bundler = "esbuild"\n')).toThrow(
      NetlifyFunctionsConflictError,
    )
  })

  it('refuses when the project points the functions directory elsewhere', () => {
    // The same class as the bundler conflict, on the other required key. Both are measured
    // requirements rather than preferences, so both refuse rather than overwrite.
    expect(() => mergeNetlifyToml('[functions]\n  directory = "netlify/fns"\n')).toThrow(
      NetlifyFunctionsConflictError,
    )
  })

  it('reads a value that carries an inline comment', () => {
    // TOML allows one, and stripping quotes alone read `"none"  # keep` as `none"  # keep` — a hard
    // refusal of a legal file. Found by reviewing the helper rather than by a failing run, which is
    // why the negative case below ships with it.
    const toml = mergeNetlifyToml(
      '[functions]\n  directory = ".netlify/functions"  # set by theokit\n  node_bundler = "none" # keep\n',
    )

    expect(toml).toContain('# set by theokit')
    expect((toml.match(/node_bundler/gu) ?? []).length).toBe(1)
  })

  it('does not mistake a # inside a value for a comment', () => {
    // NEGATIVE case for the one above: cutting at the first `#` would mangle a legal value, so the
    // two halves of that fix have to be asserted separately.
    expect(() => mergeNetlifyToml('[functions]\n  directory = "netlify/a#b"\n')).toThrow(
      /netlify\/a#b/u,
    )
  })

  it('is idempotent — re-merging does not duplicate the keys', () => {
    const once = mergeNetlifyToml(null)
    const twice = mergeNetlifyToml(once)

    expect((twice.match(/node_bundler/gu) ?? []).length).toBe(1)
    expect((twice.match(/directory/gu) ?? []).length).toBe(1)
    expect((twice.match(/^\[functions\]/gmu) ?? []).length).toBe(1)
  })
})
