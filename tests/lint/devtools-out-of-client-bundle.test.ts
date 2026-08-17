/**
 * Lint test — the devtools tree cannot reach an end user's production bundle.
 *
 * ## What is being protected
 *
 * `packages/theo/src/devtools/**` is a React panel plus `goober` (a CSS-in-JS
 * runtime). It ships inside the package because `theokit dev` mounts it. It must
 * never enter the CLIENT bundle of an app built for production — a user who runs
 * `theokit build` pays for neither.
 *
 * The guarantee has exactly one mechanism, and it is a boundary rather than a
 * flag: devtools is reached ONLY through `import(...)`. The vite-plugin injects a
 * dev-only `<script>` for a virtual module whose whole body is
 * `import('theokit/devtools/entry')`, and every server-side touchpoint sits behind
 * an `__IS_DEV` guard with a dynamic import. A production build never evaluates
 * the injection, so the tree has no static edge to follow and drops out.
 *
 * ## Why this test and not a bundle assertion
 *
 * The gate that used to cover this built a scaffolded app and grepped the emitted
 * client assets for `theo-devtools-portal`, `goober` and `__theoDevtoolsMounted`.
 * That is the stronger oracle and it was deleted; rebuilding it needs a scaffold,
 * a network install and a production build — minutes per run, and unavailable
 * offline.
 *
 * This one is weaker on purpose and says so. It cannot prove a bundle is clean.
 * It proves the PRECONDITION that makes the bundle clean: that no runtime module
 * outside the tree statically imports it. That is the regression an ordinary
 * refactor introduces — turning an `import(...)` into a top-level `import`, which
 * silently welds the panel and `goober` into every consumer's bundle with every
 * other test still green.
 *
 * @internal
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..')
const SRC = join(REPO_ROOT, 'packages', 'theo', 'src')

/**
 * `vite-plugin/` is the DEV SERVER. It runs in Node while `theokit dev` is up and
 * is never part of an app's client bundle, so a static edge from there costs a
 * user nothing. It is the module that owns the injection, so forbidding it would
 * forbid the mechanism itself.
 */
const ALLOWED_STATIC_IMPORTERS = new Set(['vite-plugin'])

/** A `import type { … }` edge is erased by the compiler and emits no runtime import. */
const TYPE_ONLY = /^\s*import\s+type\s/

/** A top-level `import … from '…devtools…'` — the edge a bundler follows. */
const STATIC_DEVTOOLS_IMPORT = /^\s*import\s(?!type\s)[^'"]*from\s*['"][^'"]*devtools\/[^'"]*['"]/

const SOURCE_EXT = /\.(?:ts|tsx|mts|cts)$/
const SKIP_DIR = new Set(['node_modules', 'dist', 'coverage'])

async function walk(dir: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) out.push(...(await walk(p)))
    } else if (SOURCE_EXT.test(e.name) && !e.name.includes('.test.')) {
      out.push(p)
    }
  }
  return out
}

const isInsideDevtools = (rel: string): boolean => rel.split(sep)[0] === 'devtools'
const isAllowedImporter = (rel: string): boolean =>
  ALLOWED_STATIC_IMPORTERS.has(rel.split(sep)[0] ?? '')

describe('devtools cannot reach a production client bundle', () => {
  it('no runtime module outside the tree statically imports devtools', async () => {
    const files = await walk(SRC)

    // Non-vacuity floor. A walk that returns nothing reports zero offenders and
    // passes — the same silent-empty-scope failure this repository has now hit in
    // a dependency-cruiser rule, an eslint ignore and a coverage exclude.
    expect(files.length, 'walked no source file under packages/theo/src').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(SRC, file)
      if (isInsideDevtools(rel) || isAllowedImporter(rel)) continue
      const text = await readFile(file, 'utf8')
      for (const [i, line] of text.split('\n').entries()) {
        if (TYPE_ONLY.test(line)) continue
        if (STATIC_DEVTOOLS_IMPORT.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      }
    }

    expect(offenders, 'a static import welds devtools into every consumer bundle').toEqual([])
  })

  it('goober is imported only from inside the devtools tree', async () => {
    const files = await walk(SRC)
    expect(files.length).toBeGreaterThan(0)

    const importers: string[] = []
    for (const file of files) {
      const text = await readFile(file, 'utf8')
      if (/from\s*['"]goober['"]/.test(text)) importers.push(relative(SRC, file))
    }

    // The floor here is the opposite shape: goober MUST still be imported
    // somewhere, otherwise the styling it provides was dropped and this test would
    // pass by measuring an absence rather than a boundary.
    expect(importers.length, 'nothing imports goober — the styling layer vanished').toBeGreaterThan(
      0,
    )
    expect(importers.filter((r) => !isInsideDevtools(r))).toEqual([])
  })
})
