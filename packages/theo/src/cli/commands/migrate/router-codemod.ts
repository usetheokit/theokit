/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time codemod: walks `<routesDir>` derived from the operator's
 * cwd via `theokit migrate router`. No HTTP input reaches these fs calls.
 */
/**
 * G6 T2.1 — Pure codemod core for `theokit migrate router`.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * `planRouterMigration` walks `<routesDir>` recursively and returns the
 * set of (from, to) renames required to convert legacy dotted-basename
 * routes (`auth.[provider].login.ts`) into the directory-nested form
 * (`auth/[provider]/login.ts`). The function is PURE — it does NOT
 * touch the filesystem beyond `readdirSync`/`statSync`. The CLI subcommand
 * (`router.ts`) is responsible for executing the renames via `git mv`
 * or `fs.rename` with the appropriate error handling.
 *
 * Edge cases covered:
 *   - EC-4: co-located `*.test.[jt]sx?` / `*.spec.[jt]sx?` files are
 *     silently skipped (same filter as the scanner).
 *   - EC-5: target collision detection is CASE-INSENSITIVE so a
 *     macOS/Windows dev doesn't silently overwrite a sibling file that
 *     differs only in case.
 *   - Idempotent: invoked twice on the same tree, the second pass is empty.
 */
import { readdirSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'

const ROUTE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const TEST_OR_SPEC_RE = /\.(test|spec)\.[jt]sx?$/

/**
 * One pending rename emitted by `planRouterMigration`.
 */
export interface RouterMigrationPlanItem {
  /** Absolute path of the offending dotted-basename file. */
  from: string
  /** Absolute path of the proposed directory-nested replacement. */
  to: string
}

/**
 * `RouterMigrationCollisionError` is thrown when migrating a dotted file
 * would overwrite an existing file (case-insensitive). The caller MUST
 * resolve the conflict manually before re-running the codemod.
 */
export class RouterMigrationCollisionError extends Error {
  override readonly name = 'RouterMigrationCollisionError'
  readonly from: string
  readonly to: string
  constructor(from: string, to: string) {
    super(
      `Router migration collision: ${from} would rename to ${to}, but that file already exists (case-insensitive match). Resolve manually.`,
    )
    this.from = from
    this.to = to
  }
}

/**
 * Compute the depth delta (number of extra `..` levels needed) between
 * the original (dotted) path and the migrated (nested) path, relative
 * to a common `routesDir` ancestor.
 *
 * - `admin.sdk-config.ts` (depth 0) → `admin/sdk-config.ts` (depth 1): delta = 1
 * - `debug.stability.last.ts` (depth 0) → `debug/stability/last.ts` (depth 2): delta = 2
 * - `canvas/artifacts.[id].ts` (depth 1) → `canvas/artifacts/[id].ts` (depth 2): delta = 1
 */
export function computeDepthDelta(from: string, to: string, routesDir: string): number {
  const depthOf = (p: string): number => {
    const rel = relative(routesDir, p).replace(/\\/g, '/')
    // depth = number of `/` separators in the relative path
    return rel.split('/').length - 1
  }
  return depthOf(to) - depthOf(from)
}

/**
 * Rewrite all relative imports in `source` by prepending `../` × `delta`
 * to every `./X` or `../X` specifier. Absolute / package specifiers
 * (`theokit/server`, `zod`, `node:fs`) are untouched.
 *
 * Handles three import shapes:
 *   - `import ... from './foo'`
 *   - `import('./foo')` (dynamic)
 *   - `import './foo'` (side-effect only)
 *   - `export ... from './foo'` (re-exports)
 *
 * Pure: returns the new source; does NOT touch disk.
 */
export function rewriteRelativeImports(source: string, delta: number): string {
  if (delta <= 0) return source

  const prefix = '../'.repeat(delta)

  // Rewrites a captured relative specifier: `./foo` → `<prefix>foo`,
  // `../foo` → `<prefix>../foo`. Single source of truth for the algorithm
  // shared by all three import-shape regexes below.
  const transformSpecifier = (specifier: string): string => {
    if (specifier.startsWith('./')) return `${prefix}${specifier.slice(2)}`
    return `${prefix}${specifier}`
  }

  // Three narrow regexes keep us out of catastrophic-backtracking territory.
  // Each is anchored on a keyword (`from`, `import`) and uses a possessive
  // character class (`[^'"]+`) for the specifier, so backtracking is bounded.
  const fromRe = /\bfrom\s+(['"])(\.{1,2}\/[^'"]+)\1/g
  const dynRe = /\bimport\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g
  const sideRe = /\bimport\s+(['"])(\.{1,2}\/[^'"]+)\1/g

  const fromSub = (_m: string, q: string, spec: string): string =>
    `from ${q}${transformSpecifier(spec)}${q}`
  const dynSub = (_m: string, q: string, spec: string): string =>
    `import(${q}${transformSpecifier(spec)}${q})`
  const sideSub = (_m: string, q: string, spec: string): string =>
    `import ${q}${transformSpecifier(spec)}${q}`

  // `from` covers both `import ... from '...'` and `export ... from '...'`
  // (the `\bfrom\s+` anchor matches the keyword position in both shapes).
  // `dynRe` handles `import('...')`. `sideRe` handles bare `import '...'`.
  // No overlap — `sideRe` requires `import` followed by whitespace then
  // a quote (vs. `import(` for dynRe and `import ... from` for fromRe).
  return source.replace(fromRe, fromSub).replace(dynRe, dynSub).replace(sideRe, sideSub)
}

function isTestOrSpecFile(filePath: string): boolean {
  return TEST_OR_SPEC_RE.test(filePath)
}

function hasDotOutsideBrackets(segment: string): boolean {
  let depth = 0
  for (const ch of segment) {
    if (ch === '[') depth++
    else if (ch === ']') depth--
    else if (ch === '.' && depth === 0) return true
  }
  return false
}

function splitDottedSegmentOutsideBrackets(segment: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const ch of segment) {
    if (ch === '[') {
      depth++
      current += ch
    } else if (ch === ']') {
      depth--
      current += ch
    } else if (ch === '.' && depth === 0) {
      if (current) parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

function toDirectoryNestedPath(filePath: string, routesDir: string): string {
  const rel = relative(routesDir, filePath).replace(/\\/g, '/')
  const ext = extname(rel)
  const withoutExt = rel.slice(0, -ext.length)
  const flattened = withoutExt.split('/').flatMap(splitDottedSegmentOutsideBrackets)
  return join(routesDir, `${flattened.join(sep)}${ext}`)
}

function walkRoutes(root: string, onFile: (absPath: string) => void): void {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      walkRoutes(full, onFile)
    } else if (entry.isFile() && ROUTE_EXTENSIONS.has(extname(entry.name))) {
      onFile(full)
    }
  }
}

function isDottedRouteFile(filePath: string, routesDir: string): boolean {
  const rel = relative(routesDir, filePath).replace(/\\/g, '/')
  const ext = extname(rel)
  const withoutExt = rel.slice(0, -ext.length)
  return withoutExt.split('/').some(hasDotOutsideBrackets)
}

/**
 * Compute the migration plan for a `<server>/routes` tree.
 *
 * Pure: does NOT mutate the filesystem.
 *
 * @throws RouterMigrationCollisionError when a target collides with an
 *   existing file (case-insensitive).
 */
export function planRouterMigration(routesDir: string): RouterMigrationPlanItem[] {
  const plan: RouterMigrationPlanItem[] = []
  const existingPathsLowercase = new Set<string>()

  walkRoutes(routesDir, (absPath) => {
    existingPathsLowercase.add(absPath.toLowerCase())
  })

  walkRoutes(routesDir, (absPath) => {
    if (isTestOrSpecFile(absPath)) return
    if (!isDottedRouteFile(absPath, routesDir)) return

    const to = toDirectoryNestedPath(absPath, routesDir)

    // EC-5: case-insensitive collision check — macOS HFS+/APFS default
    // and Windows NTFS treat case-only differences as the same path. If
    // any pre-existing file at a case-insensitive match exists, the codemod
    // would silently overwrite on those platforms; we bail explicitly.
    const targetLower = to.toLowerCase()
    if (existingPathsLowercase.has(targetLower) && targetLower !== absPath.toLowerCase()) {
      throw new RouterMigrationCollisionError(absPath, to)
    }
    // Also guard against statSync race using an explicit existence check.
    try {
      if (statSync(to).isFile()) {
        throw new RouterMigrationCollisionError(absPath, to)
      }
    } catch (err) {
      if (err instanceof RouterMigrationCollisionError) throw err
      // ENOENT — fine, target does not exist
    }

    plan.push({ from: absPath, to })
  })

  return plan
}
