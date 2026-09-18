import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import tsupConfig from '../../tsup.config.js'

/**
 * Every symbol the SOURCE barrel exports is present in the DECLARATION this package publishes.
 *
 * ## What this covers that nothing else does
 *
 * `subpath-surface.test.ts` already compares emit against source in both directions — for the FOUR
 * entries in `INFRA_SUBPATHS`, which are the ones that are a pure re-export of an SDK specifier. That
 * is the set its oracle CAN cover: it asks whether this layer's `export { … } from` lines match the
 * upstream surface.
 *
 * The package publishes twenty. The other sixteen have implementations of their own, so an emitted
 * declaration may declare a symbol inline rather than re-export it, and a regex over
 * `export { … } from` reads them as empty — which would make a parity check pass over nothing.
 *
 * `check:pack-exports` and `validate:attw` do not close it either: both start from the EMIT and ask
 * whether what is there resolves. A symbol that never reached the emit is invisible to both, and the
 * emit resolves precisely because nothing dangles.
 *
 * Measured on the reference repository (`@theokit/sdk-memory`, 2026-08-20): four symbols exported
 * from `src/index.ts` and absent from `dist/index.d.ts`, with the typecheck gate reporting ✓. The
 * mechanism is `stripInternal` — TypeScript deletes a declaration when the literal `@internal`
 * appears in ANY leading comment range, including a file header no statement separates from the
 * first declaration. A consumer then gets TS2305 against a name the source and the README both say
 * exists.
 *
 * ## The oracle is the compiler, not a regex
 *
 * `checker.getExportsOfModule` answers what a module exports, including symbols declared inline and
 * symbols that arrive through a star. Text matching cannot see either, and the failure mode of text
 * matching here is silence rather than a wrong answer.
 *
 * ## There is no waiver list, deliberately
 *
 * A symbol that should not be published should not be exported from a published barrel. The fix is
 * always in the source.
 */

/**
 * Exactly the slice of the compiler API this file touches. Narrower than `any` and narrower than the
 * real types, which are not worth importing for six members.
 */
interface TsCompilerApi {
  readonly ScriptTarget: { readonly ES2022: number }
  readonly ModuleKind: { readonly ESNext: number }
  readonly ModuleResolutionKind: { readonly Bundler: number }
  createProgram(
    files: string[],
    options: Record<string, unknown>,
  ): {
    getSourceFile(file: string): unknown
    getTypeChecker(): {
      getSymbolAtLocation(node: unknown): unknown
      getExportsOfModule(symbol: unknown): { name: string }[]
    }
  }
}

const require_ = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..', '..')

interface Entry {
  readonly name: string
  readonly source: string
  readonly emitted: string
}

/** The entry map the bundler is configured with — the authoritative source-barrel mapping. */
function declaredEntries(): Entry[] {
  const entry = (tsupConfig as { entry?: Record<string, string> }).entry ?? {}
  return Object.entries(entry).map(([name, source]) => ({
    name,
    source: join(ROOT, source),
    emitted: join(ROOT, 'dist', `${name}.d.ts`),
  }))
}

const ENTRIES = declaredEntries()
const BUILT = ENTRIES.filter((e) => existsSync(e.emitted))

/** Exported names per file, asked of the compiler. `undefined` when the file is not in the program. */
function exportedNamesByFile(files: string[]): Map<string, Set<string>> {
  const ts = require_('typescript') as TsCompilerApi
  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  const checker = program.getTypeChecker()
  const out = new Map<string, Set<string>>()
  for (const file of files) {
    const source = program.getSourceFile(file)
    if (source === undefined) continue
    const moduleSymbol = checker.getSymbolAtLocation(source)
    if (moduleSymbol === undefined) continue
    out.set(file, new Set(checker.getExportsOfModule(moduleSymbol).map((s) => s.name)))
  }
  return out
}

/**
 * The program is built ONCE. Two calls cost ~9s each over forty files, and the first version paid it
 * twice and timed out — a gate nobody can run is a gate nobody keeps.
 */
let NAMES: Map<string, Set<string>>

describe('every symbol the source barrel exports reaches the published declaration', () => {
  beforeAll(() => {
    NAMES = exportedNamesByFile([...BUILT.map((e) => e.source), ...BUILT.map((e) => e.emitted)])
  }, 120_000)

  it('test_the_tree_is_BUILT_or_this_gate_proves_nothing', () => {
    // COUNTERPROOF. On an unbuilt tree every entry would be skipped and the parity assertion would
    // pass over an empty set — green for the one reason that must never read as green.
    const unbuilt = ENTRIES.filter((e) => !existsSync(e.emitted)).map((e) => e.name)
    expect(
      unbuilt,
      `declared entr(ies) with no emitted declaration: ${unbuilt.join(', ')}.\n` +
        'Run the package build first — this gate does not pass on an unbuilt tree.',
    ).toEqual([])
  })

  it('test_the_compiler_answered_for_every_entry', () => {
    // COUNTERPROOF for the oracle itself: a file the program did not load yields no symbols, and a
    // parity check over no symbols is vacuous.
    const names = NAMES
    const silent = BUILT.filter(
      (e) => (names.get(e.source)?.size ?? 0) === 0 || (names.get(e.emitted)?.size ?? 0) === 0,
    ).map((e) => e.name)
    expect(
      silent,
      `entr(ies) for which the compiler reported no exports at all: ${silent.join(', ')}`,
    ).toEqual([])
  })

  it('test_no_source_export_is_missing_from_the_declaration', () => {
    const names = NAMES
    const gaps: string[] = []
    for (const e of BUILT) {
      const inSource = names.get(e.source)
      const inEmit = names.get(e.emitted)
      if (inSource === undefined || inEmit === undefined) continue
      const missing = [...inSource].filter((n) => !inEmit.has(n)).sort((a, b) => a.localeCompare(b))
      if (missing.length > 0) gaps.push(`${e.name}: ${missing.slice(0, 14).join(', ')}`)
    }
    expect(
      gaps,
      `symbol(s) exported from the source barrel and absent from the published declaration:\n  ${gaps.join('\n  ')}\n` +
        'A consumer importing one of these gets TS2305 against a name the source says exists. The fix ' +
        'is in the source, never here.',
    ).toEqual([])
  })
})
