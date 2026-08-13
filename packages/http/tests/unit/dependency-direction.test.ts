import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * G1, asserted on the package it constrains: `@theokit/http` does not depend on `@theokit/agents`.
 *
 * ## Why this had to be written
 *
 * `system-design-guardrails.md` § G1 states the direction in one line — "`@theokit/http` does NOT
 * import `@theokit/agents` (agents depends on http, not the reverse)" — and nothing checked it.
 * `packages/agents/tests/unit/dependency-direction.test.ts` guards the OTHER side of the same rule,
 * over agents' own manifest. The half that constrains this package had no oracle at all, so the
 * violation lived in `src/app.ts` through every review that ever ran here.
 *
 * ## What the violation actually cost
 *
 * `TheoApp.autoWireAgents` reached into `@theokit/agents` with a dynamic `import()`, which forced
 * this package to declare it as a peer, which made pnpm auto-install the **published** copy next to
 * the workspace sibling one directory away. Measured on 2026-08-13: three published copies of our
 * own packages in the production tree (`@theokit/agents`, `@theokit/http`, `@theokit/presenter`) —
 * the defect ADR 0062 recorded for the SDK, generalised. Two versions of one contract in one tree,
 * where the tests exercise one and the consumer may reach the other.
 *
 * It also made the cycle unbreakable by manifest edit: linking the sibling to satisfy the peer
 * closed a TYPE cycle (this package's dts → agents' types → this package's `dist/*.d.ts`) and the
 * build died with `TS5055: Cannot write file 'dist/app.d.ts' because it would overwrite input file`.
 *
 * ## Why a dynamic import is not an escape hatch
 *
 * `await import('@theokit/agents')` is still a dependency: it appears in the manifest, it resolves
 * at install time, and it is what pnpm acts on. "Optional" and "dynamic" change WHEN the module is
 * needed, never WHETHER this package depends on it. The seam that replaced it inverts the
 * direction properly — the caller supplies the agent runtime, per DIP (`architecture.md` § 2) and
 * the composition-root rule (§ 1).
 */

const PKG_DIR = fileURLToPath(new URL('../..', import.meta.url))
const FORBIDDEN = '@theokit/agents'

interface Manifest {
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as Manifest
}

/** Every `.ts` file under `src/`, recursively. */
function sourceFiles(dir = join(PKG_DIR, 'src')): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path))
    } else if (entry.endsWith('.ts')) {
      found.push(path)
    }
  }
  return found
}

/**
 * Module specifiers a file imports — static, `export … from`, and dynamic `import()` alike.
 *
 * `ts.preProcessFile` is TypeScript's own scanner for exactly this question, and using it is rung 4
 * of the parsimony ladder: the compiler is already a dependency here, so there is no reason to
 * hand-roll a parser.
 *
 * The first version of this check WAS hand-rolled — a regex over the raw text — and it failed on
 * its first run against the fixed code, flagging `src/app.ts` because the new error message quotes
 * the import line as documentation:
 *
 *     "  import { generateAgentRoutes, createSdkAgentStream } from '@theokit/agents'\n"
 *
 * A string is not an import. That regex could not tell the difference between code and prose about
 * code, which is the same class of defect this whole guard exists to catch: an oracle that does not
 * measure what its name promises. The compiler's scanner has no such ambiguity — it ignores string
 * literals and comments by construction.
 */
function importedSpecifiers(path: string): string[] {
  const info = ts.preProcessFile(readFileSync(path, 'utf8'), /* readImportFiles */ true, true)
  return info.importedFiles.map((ref) => ref.fileName)
}

describe('G1 — this package does not depend on @theokit/agents', () => {
  it.each(['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies'] as const)(
    'test_%s_does_not_declare_the_agents_package',
    (section) => {
      // All four sections, not just `dependencies`: a peer is what pnpm auto-installed, and a
      // devDependency is what closed the type cycle. Checking one section would have passed while
      // the defect sat in another.
      expect(
        manifest()[section]?.[FORBIDDEN],
        `${section} declares ${FORBIDDEN}, inverting the direction G1 fixes: agents depends on ` +
          'http, never the reverse.',
      ).toBeUndefined()
    },
  )

  it('test_no_source_file_imports_the_agents_package', () => {
    // Static OR dynamic. `await import(...)` is still a dependency — it resolves at install time
    // and it is what pnpm acts on. "Optional" and "dynamic" change WHEN the module is needed,
    // never WHETHER this package depends on it.
    const offenders = sourceFiles()
      .filter((path) =>
        importedSpecifiers(path).some(
          (spec) => spec === FORBIDDEN || spec.startsWith(`${FORBIDDEN}/`),
        ),
      )
      .map((path) => path.slice(PKG_DIR.length))
    expect(
      offenders,
      'these reach into the agents layer from the HTTP layer. The caller supplies the agent ' +
        'runtime instead (see `TheoAppOptions.agentRuntime`).',
    ).toEqual([])
  })

  it('test_the_scanner_reads_code_and_not_prose_about_code', () => {
    // The counter-proof for the paragraph above. Without it, a future simplification back to a text
    // scan would pass every other assertion here and silently re-introduce the false positive.
    const source = `
      const help = "run: import { x } from '${FORBIDDEN}'"
      // import { y } from '${FORBIDDEN}'
      /* import { z } from '${FORBIDDEN}' */
      import { real } from './neighbour.js'
    `
    const specs = ts.preProcessFile(source, true, true).importedFiles.map((r) => r.fileName)
    expect(specs).toEqual(['./neighbour.js'])
  })

  it('test_the_scanner_DOES_see_a_dynamic_import', () => {
    // And the other counter-proof: the exact shape that was removed from `app.ts` must still be
    // detectable, or this guard would go green the moment someone reintroduces it.
    const specs = ts
      .preProcessFile(`const m = await import('${FORBIDDEN}')`, true, true)
      .importedFiles.map((r) => r.fileName)
    expect(specs).toEqual([FORBIDDEN])
  })

  it('test_the_scan_actually_read_this_packages_sources', () => {
    // Anti-vacuity floor: if `sourceFiles()` returned nothing — wrong path, moved directory — the
    // assertion above would pass by scanning zero files, which is the emptiest possible green.
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(5)
    expect(files.some((path) => path.endsWith('app.ts'))).toBe(true)
  })
})
