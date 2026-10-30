import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { BUILD_HOOK_TIMEOUT_MS, buildTheokitPackageOnce } from './_helpers/build-theokit-package.js'

/**
 * `theokit start` configures the storage manager and the cache engine from `theo.config.ts`, and
 * route code reads them through `theokit/server/storage` and `theokit/server`. Those are two
 * different builds in `tsup.config.ts`: the CLI build has its own chunk graph, so a module-level
 * `let` in `storage-manager.ts` or `engine-singleton.ts` exists once per build. Measured on
 * theokit@0.75.1 (usetheokit/theokit#1018): `start` configured one `StorageManager` and every
 * route got `Database "main" not configured`; `revalidateTag` threw `Cache engine not initialized`
 * with `cache.enabled: true`.
 *
 * Source tests cannot see this, because in source there is one module. So this test reads the
 * BUILT `dist`: it finds every chunk that carries a copy of the module, whatever tsup named it, and
 * checks that writing through one copy is visible through the public subpath. It runs the check in
 * a plain Node child process so the module graph is Node's, not Vite's.
 *
 * It asserts behaviour, never a chunk layout: if a later build stops duplicating the module, the
 * test still passes, and if it duplicates it into a third chunk, the third copy is checked too.
 */

const REPO = resolve(__dirname, '../..')
const THEO = resolve(REPO, 'packages/theo')
const DIST = join(THEO, 'dist')

function resolvePublished(subpath: string): string {
  const pkg = JSON.parse(readFileSync(join(THEO, 'package.json'), 'utf8')) as {
    exports: Record<string, { import?: string }>
  }
  const entry = pkg.exports[subpath]
  if (entry?.import === undefined) throw new Error(`theokit does not publish "${subpath}"`)
  return resolve(THEO, entry.import)
}

function jsFilesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full))
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

/** Every built file that defines AND exports `marker`, i.e. every importable copy of the module. */
function chunksExporting(marker: string): string[] {
  return jsFilesUnder(DIST).filter((file) => {
    const text = readFileSync(file, 'utf8')
    return (
      text.includes(`function ${marker}(`) &&
      new RegExp(`export \\{[^}]*\\b${marker}\\b`).test(text)
    )
  })
}

/** Run an ES module body in a fresh Node process and return what it printed as JSON. */
function runInNode(body: string): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', body], {
    cwd: THEO,
    encoding: 'utf8',
    timeout: 60_000,
  })
  const lastLine = out.trim().split('\n').pop() ?? ''
  return JSON.parse(lastLine)
}

describe('storage manager and cache engine are one instance across the built bundles (#1018)', () => {
  beforeAll(() => {
    buildTheokitPackageOnce()
  }, BUILD_HOOK_TIMEOUT_MS)

  it('test_storage_configured_through_any_built_copy_is_visible_through_theokit_server_storage', () => {
    const copies = chunksExporting('getStorageManager')
    expect(copies.length, 'no built chunk exports getStorageManager').toBeGreaterThan(0)
    const subpath = pathToFileURL(resolvePublished('./server/storage')).href

    const result = runInNode(`
      const copies = ${JSON.stringify(copies.map((c) => pathToFileURL(c).href))}
      const routeSide = (await import(${JSON.stringify(subpath)})).getStorageManager()
      const report = []
      for (const href of copies) {
        const m = await import(href)
        const mgr = m.getStorageManager()
        report.push({ href: href.split('/').pop(), same: mgr === routeSide })
      }
      // The order start uses: configure through a CLI-side copy, read on the route side.
      const cliSide = (await import(copies[copies.length - 1])).getStorageManager()
      cliSide.configure({
        servers: { s: { host: 'h', user: 'u', password: '' } },
        databases: { main: { server: 's', database: 'd' } },
      })
      console.log(JSON.stringify({ report, routeSideConfigured: routeSide.__isConfiguredForTests() }))
    `) as { report: { href: string; same: boolean }[]; routeSideConfigured: boolean }

    expect(result.report.filter((r) => !r.same)).toEqual([])
    expect(result.routeSideConfigured).toBe(true)
  })

  it('test_cache_engine_initialized_through_any_built_copy_serves_revalidate_tag_from_theokit_server', () => {
    const copies = chunksExporting('initCacheEngine')
    expect(copies.length, 'no built chunk exports initCacheEngine').toBeGreaterThan(0)
    const server = pathToFileURL(resolvePublished('./server')).href

    const result = runInNode(`
      const copies = ${JSON.stringify(copies.map((c) => pathToFileURL(c).href))}
      const { revalidateTag } = await import(${JSON.stringify(server)})
      const outcomes = []
      for (const href of copies) {
        const m = await import(href)
        m._resetCacheEngine()
        m.initCacheEngine({ enabled: true, storage: 'memory', maxEntries: 10, defaults: { maxAge: 60, cacheErrors: false } })
        try {
          await revalidateTag('posts')
          outcomes.push({ href: href.split('/').pop(), ok: true })
        } catch (err) {
          outcomes.push({ href: href.split('/').pop(), ok: false, error: String(err && err.message) })
        }
        m._resetCacheEngine()
      }
      console.log(JSON.stringify(outcomes))
    `) as { href: string; ok: boolean; error?: string }[]

    expect(result.filter((r) => !r.ok)).toEqual([])
  })
})
