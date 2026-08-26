/**
 * M90 — an AUTHORING tool, single-use: enumerates the exports of a subpath alias and prints the
 * named re-export block to paste into the matching `*-entry.ts`.
 *
 * ## Why generate, and why NOT at build time
 *
 * There are 172 symbols across the five infra subpaths. Writing them by hand goes wrong, and a
 * mistake here is a symbol that disappears from the public surface with nothing flagging it.
 * Generating **at build time**, however, would hand the problem back: an `export *` executed by a
 * script is still an `export *`, and the decision goes implicit again. The list is committed source,
 * reviewable in a diff — that is half its value.
 *
 * Precedent for a single-use tool in this corpus: M72's `git blame` attribution, whose
 * `adr-governance.md § 6` says explicitly "do not reuse this procedure as a standing tool".
 *
 * npx tsx [--json]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/**
 * The five infra subpaths: entry name → source specifier.
 *
 * **The order is alphabetical by contract, not by taste** — theokit#161 (A). `--json` serializes in
 * this order, and the snapshot at `tests/unit/__snapshots__/subpath-surface.json` is written from it.
 * In any other order, regenerating the snapshot rewrote 145 lines to add 4 symbols, and the reviewer
 * lost the real change inside the noise — friction that pushes towards "I'll regenerate later", which
 * is exactly the omission failure mode that left this gate red on `develop`.
 */
/**
 * `pty` is deliberately absent. It carried `@theokit/sdk-pty`, whose `install` script downloads a
 * prebuild or compiles C++, and as a hard dependency of this package every web application paid for
 * a terminal it never opened (usetheokit/theokit#460). It lives in `@theokit/agents-pty` now, which
 * owns both the subpath and the dependency, so an app that wants a terminal declares that name and
 * one that does not never compiles it.
 *
 * It is NOT re-addable here. Putting it back reinstates the native install for everyone, and the
 * barrel test asserts its absence from the manifest rather than merely not mentioning it.
 */
export const INFRA_SUBPATHS: Readonly<Record<string, string>> = {
  interactive: '@theokit/sdk/interactive',
  persistence: '@theokit/sdk/persistence',
  sandbox: '@theokit/sdk/sandbox',
  tools: '@theokit/sdk-tools',
}

export interface Surface {
  /** Symbols that exist at runtime — they go in `export { … }`. */
  readonly values: readonly string[]
  /** Type-only symbols — they go in `export type { … }`, as `isolatedModules` requires. */
  readonly types: readonly string[]
}

/**
 * Enumerates a specifier's exports, classifying value vs type-only.
 *
 * Resolves from `src/index.ts` — the build's own point of view, so it does not diverge from what the
 * bundler resolve.
 */
/**
 * Enumerates a specifier's exports, classifying value vs type-only.
 *
 * The **complete set** comes from the compiler (`getExportsOfModule`), because only it sees the
 * type-only ones. The **classification** comes from the runtime, and that is not laziness: measured,
 * `SymbolFlags` lies in both directions here. The wide mask (`SymbolFlags.Value`) marked
 * `AtomicWriteJsonOptions`, `FileLockOptions` and `WalApplyResult` as values — they are `interface`s.
 * The strict mask (`Function|Class|Variable|Enum|Method`) lost six real functions from
 * `/persistence`, because `atomicWriteText` resolves to a `Transient|Property` symbol
 * (`flags = 33554436`) rather than a function declaration: the alias crosses a namespace object in
 * the source's `.d.ts`.
 *
 * The ESM namespace is the truth about what `export { … }` can carry — putting a type-only symbol
 * there fails under `isolatedModules`, and that is exactly the mistake the classification must not
 * make.
 *
 * Resolves from `src/index.ts` — the build's own point of view, so it does not diverge from the bundler.
 */
export async function enumerateSurface(specifier: string): Promise<Surface> {
  const host = ts.createCompilerHost({})
  const res = ts.resolveModuleName(
    specifier,
    join(ROOT, 'src', 'index.ts'),
    { moduleResolution: ts.ModuleResolutionKind.Bundler },
    host,
  )
  const file = res.resolvedModule?.resolvedFileName
  if (file === undefined) throw new Error(`did not resolve: ${specifier}`)

  const prog = ts.createProgram([file], {
    noEmit: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  })
  const sf = prog.getSourceFile(file)
  if (sf === undefined) throw new Error(`no source file: ${file}`)
  const ck = prog.getTypeChecker()
  const mod = ck.getSymbolAtLocation(sf)
  if (mod === undefined) throw new Error(`no module symbol: ${file}`)
  const all = ck.getExportsOfModule(mod).map((s) => s.getName())

  const emRuntime = new Set(Object.keys((await import(specifier)) as object))
  // `localeCompare` and not a bare `sort()`: the order must be stable across machines, otherwise the
  // surface snapshot turns into a spurious diff by locale.
  const alfabetica = (a: string, b: string): number => a.localeCompare(b)
  const values = all.filter((n) => emRuntime.has(n)).sort(alfabetica)
  const types = all.filter((n) => !emRuntime.has(n)).sort(alfabetica)

  // Anti-vacuity floor: an empty `all` would mean resolution broke, and the generated entry would
  // come out empty — reducing the public surface to zero in silence. It is the plan's risk #1.
  if (all.length === 0) throw new Error(`empty surface for ${specifier} — resolution broke`)
  return { values, types }
}

/** The block ready to paste into the `*-entry.ts`. */
export function renderBlock(specifier: string, s: Surface): string {
  const list = (names: readonly string[]) => names.map((n) => `  ${n},`).join('\n')
  const parts: string[] = []
  if (s.values.length > 0) parts.push(`export {\n${list(s.values)}\n} from '${specifier}'`)
  if (s.types.length > 0) parts.push(`export type {\n${list(s.types)}\n} from '${specifier}'`)
  return parts.join('\n')
}

// Run as a CLI (`npx tsx [--json]`), never imported by production
// code — it is an authoring tool. The functions above are exported so the surface test uses the SAME
// enumeration rather than reimplementing it (the duplication M78 called "two lists that have to stay
// in sync").
//
// The main guard is not ceremony: without it, the test's `import` of this module RUNS the CLI and
// dumps 172 names into the suite's stdout. That is what happened in the first version.
// `process.argv[1]` is typed `string` (no `noUncheckedIndexedAccess`), so checking for `undefined`
// is dead code the lint rejects — in Node it is only absent under `-e`, where there is no file to
// compare against.
const invokedAsCli = pathToFileURL(process.argv[1]).href === import.meta.url

if (invokedAsCli) {
  const measurements: [sub: string, spec: string, surface: Surface][] = []
  for (const [sub, spec] of Object.entries(INFRA_SUBPATHS)) {
    measurements.push([sub, spec, await enumerateSurface(spec)])
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(Object.fromEntries(measurements.map(([sub, , s]) => [sub, s])), null, 2) +
        '\n',
    )
  } else {
    for (const [sub, spec, s] of measurements) {
      process.stdout.write(
        `\n// \u2550\u2550 ${sub}-entry.ts \u2550\u2550\n${renderBlock(spec, s)}\n`,
      )
    }
  }
}

/**
 * Enumerates what the LAYER exports on a subpath, by reading the emitted `dist/*.d.ts`.
 *
 * It exists because `enumerateSurface` answers a different question — "what does the SOURCE export".
 * The first version of the surface gate compared source×snapshot and never layer×source, so it was
 * **vacuous for `/tools` and `/pty`** (98 of 173 symbols, 57%): removing four real symbols from the
 * entries left the whole suite green. It was through that crack that `TruncationMode` disappeared
 * from the published surface of `4.25.0` — the generator ran against a local `sdk-tools@0.26.0` while
 * the registry already had `0.26.1`, and nothing compared the result against the source.
 *
 * It reads the **emitted** `.d.ts`, not `src/*-entry.ts`, because that is the artifact the consumer
 * sees — what the plan's ADR-3 promised and the first implementation did not deliver.
 */
export function enumerateLayerSurface(sub: string): Surface {
  const dts = join(ROOT, 'dist', `${sub}.d.ts`)
  const source = readFileSync(dts, 'utf8')
  const values: string[] = []
  const types: string[] = []
  // `export { a, b } from '…'` and `export type { c } from '…'`, on one or several lines.
  //
  // The whitespace quantifiers are `\s?` and not `\s+`: the lint flagged `security/detect-unsafe-regex`
  // in the first version, and rightly — `\s+` adjacent to `\s*` opens quadratic backtracking over a
  // file that is uncontrolled input (the `.d.ts` comes from the bundler). A single space is enough
  // for the emitted format.
  for (const m of source.matchAll(/export (type )?\{([^}]*)\} ?from/g)) {
    // `m[1]`/`m[2]` are typed `string` (no `noUncheckedIndexedAccess`), so checking for `undefined`
    // is dead code the lint rejects. Group 1 is optional in the regex and arrives as `''` when absent.
    const target = m[1] === '' ? values : types
    for (const raw of m[2].split(',')) {
      const name = raw.trim().split(' as ')[0].trim()
      if (name !== '') target.push(name)
    }
  }
  const alfabetica = (a: string, b: string): number => a.localeCompare(b)
  // An explicit copy: the lint asks for `toSorted`, the tsconfig `lib` predates es2023 and `tsc` rejects it.
  return { values: [...values].sort(alfabetica), types: [...types].sort(alfabetica) }
}
