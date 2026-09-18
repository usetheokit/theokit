/**
 * Generates `docs/capability-map.md` — every public symbol this package publishes, and the exact
 * specifier to import it from.
 *
 * ## Why this exists, measured in this repository
 *
 * `delegation/role-discovery.ts` in `apps/theocode` carries the cost in its own words:
 *
 *   > `applySubagentMemory` is on the `./config` subpath, not the root: it lives in
 *   > `src/config/agent-memory.ts` and the root barrel does not re-export it. Importing it from the
 *   > root type-checks — the bundled `.d.ts` declares it — and throws at RUNTIME with
 *   > `does not provide an export named`. Measured 2026-09-16, and the types never said a word.
 *
 * Twenty subpaths are published and nothing inventories which symbol crosses which one, so a
 * consumer guesses the specifier. The guess type-checks and fails at run time, which is the worst
 * order for a mistake to happen in.
 *
 * ## Generated, never hand-written
 *
 * The map's whole value is that it agrees with the package. A hand-written one is a second copy of
 * the export list, and the copy is the one that goes stale — the same reason `INFRA_SUBPATHS` is read
 * rather than restated. `--check` fails when the committed file has drifted, and
 * `tests/unit/capability-map-is-current.test.ts` runs that comparison in the suite.
 *
 * ## The oracle is the compiler
 *
 * `checker.getExportsOfModule` over each declared `types` entry — the same question a consumer's
 * editor asks. A regex cannot see a symbol declared inline, and its failure mode is silence.
 *
 * ## An unbuilt entry ABORTS, it is not filtered
 *
 * Dropping unbuilt entries would write a map missing a whole subpath, and `--check` would then agree
 * with it. A gate that passes because the input was incomplete is worse than one that fails.
 *
 * Usage: npx tsx scripts/capability-map.mts [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require_ = createRequire(import.meta.url)
export const ROOT = join(import.meta.dirname, '..')
export const OUT = join(ROOT, 'docs', 'capability-map.md')

/** Exactly the slice of the compiler API this file touches. Narrower than `any`. */
interface TsCompilerApi {
  readonly ScriptTarget: { readonly ES2022: number }
  readonly ModuleKind: { readonly ESNext: number }
  readonly ModuleResolutionKind: { readonly Bundler: number }
  readonly SymbolFlags: { readonly Value: number; readonly Alias: number }
  createProgram(
    files: string[],
    options: Record<string, unknown>,
  ): {
    getSourceFile(file: string): unknown
    getTypeChecker(): {
      getSymbolAtLocation(node: unknown): unknown
      getExportsOfModule(symbol: unknown): { name: string; flags: number }[]
      getAliasedSymbol(symbol: { flags: number }): { flags: number }
    }
  }
}

export interface Entry {
  /** The specifier a consumer writes, e.g. `@theokit/agents/config`. */
  readonly specifier: string
  /** The emitted declaration the manifest points at. */
  readonly emitted: string
}

export interface Symbols {
  readonly values: readonly string[]
  readonly types: readonly string[]
}

/** Every published entry, read from the manifest a consumer resolves through. */
export function declaredEntries(): Entry[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    name: string
    exports?: Record<string, unknown>
  }
  const out: Entry[] = []
  for (const [sub, value] of Object.entries(pkg.exports ?? {})) {
    if (!sub.startsWith('.') || sub === './package.json') continue
    const types = typeof value === 'string' ? value : (value as { types?: string }).types
    if (types === undefined) continue
    out.push({
      specifier: sub === '.' ? pkg.name : `${pkg.name}${sub.slice(1)}`,
      emitted: join(ROOT, types),
    })
  }
  return out
}

/** What each file exports, split into runtime values and type-only names. Asked of the compiler. */
export function exportedSymbols(files: string[]): Map<string, Symbols> {
  const ts = require_('typescript') as TsCompilerApi
  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  const checker = program.getTypeChecker()
  const byFile = new Map<string, Symbols>()
  const alphabetical = (a: string, b: string): number => a.localeCompare(b)
  for (const file of files) {
    const source = program.getSourceFile(file)
    if (source === undefined) continue
    const moduleSymbol = checker.getSymbolAtLocation(source)
    if (moduleSymbol === undefined) continue
    const values: string[] = []
    const types: string[] = []
    for (const s of checker.getExportsOfModule(moduleSymbol)) {
      // A re-exported name is an ALIAS, and an alias carries `SymbolFlags.Alias` rather than the
      // flags of the thing it points at. Reading `s.flags` directly classified 1071 of 1076 symbols
      // as type-only — including `declare function applySubagentMemory` — which would have sent a
      // consumer to `import type` for a function. Resolve first, then ask.
      const resolved = (s.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(s) : s
      ;((resolved.flags & ts.SymbolFlags.Value) !== 0 ? values : types).push(s.name)
    }
    values.sort(alphabetical)
    types.sort(alphabetical)
    byFile.set(file, { values, types })
  }
  return byFile
}

/** The document. Deterministic: same package, same bytes. */
export function renderCapabilityMap(entries: Entry[], symbols: Map<string, Symbols>): string {
  const rows = entries
    .map((e) => ({ e, s: symbols.get(e.emitted) }))
    .filter((r): r is { e: Entry; s: Symbols } => r.s !== undefined)
  const total = rows.reduce((n, r) => n + r.s.values.length + r.s.types.length, 0)

  const lines: string[] = [
    '# Capability map',
    '',
    'Every public symbol this package publishes, and the exact specifier to import it from.',
    '',
    '**Generated — do not edit.** `npx tsx scripts/capability-map.mts` rewrites it, and',
    '`tests/unit/capability-map-is-current.test.ts` fails when the committed copy has drifted. A',
    'hand-edited map is a second copy of the export list, and the copy is the one that goes stale.',
    '',
    'A symbol reachable from one specifier is NOT reachable from another: importing from the root a',
    'symbol that lives on a subpath type-checks against the bundled declaration and throws at run time',
    'with `does not provide an export named`. That is the mistake this file exists to prevent.',
    '',
    `${total} export(s) across ${rows.length} entry point(s).`,
    '',
  ]
  for (const { e, s } of rows) {
    lines.push(`## \`${e.specifier}\``, '')
    if (s.values.length + s.types.length === 0) {
      lines.push('_No public export._', '')
      continue
    }
    lines.push('| Symbol | Kind |', '|---|---|')
    for (const n of s.values) lines.push(`| \`${n}\` | value |`)
    for (const n of s.types) lines.push(`| \`${n}\` | type |`)
    lines.push('')
  }
  return lines.join('\n')
}

/** The map this package's current build implies. Throws when an entry is not built. */
export function currentCapabilityMap(): string {
  const entries = declaredEntries()
  const unbuilt = entries.filter((e) => !existsSync(e.emitted))
  if (unbuilt.length > 0) {
    throw new Error(
      `capability map: ${unbuilt.length} declared entr(ies) are not built: ` +
        `${unbuilt.map((e) => e.specifier).join(', ')}. Run the package build first — a map written ` +
        'from a partial build is missing a whole subpath, and `--check` would then agree with it.',
    )
  }
  return renderCapabilityMap(entries, exportedSymbols(entries.map((e) => e.emitted)))
}

// Run as a CLI, not when imported by a test. Comparing the resolved URLs is the idiom that does not
// misfire on a name that merely ends the same way.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rendered = currentCapabilityMap()
  if (process.argv.includes('--check')) {
    const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
    if (committed !== rendered) {
      console.error('✗ docs/capability-map.md has drifted. Re-run without --check.')
      process.exit(1)
    }
    console.log('✓ docs/capability-map.md is current.')
  } else {
    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, rendered)
    console.log(`✓ wrote ${OUT}`)
  }
}
