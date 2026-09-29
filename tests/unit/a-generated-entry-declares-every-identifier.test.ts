/**
 * The general check the sibling file's name promises and does not perform.
 *
 * `a-generated-entry-declares-every-name-it-uses.test.ts` checks exactly ONE identifier — `cwd` — and
 * says so in its own first comment, because a reader took the filename as a general guarantee and was
 * wrong. This file is the general one, and it is not a second opinion: it is a different instrument.
 *
 * ## Why a type-checker rather than a regex
 *
 * A free variable in generated code is invisible to everything this repository already runs.
 * `adapter-entry-parses.test.ts` runs `node --check`, which sees syntax and not an undeclared name.
 * `/code-quality`'s symbol detector reads this repository's own source, and the entry is a STRING at
 * type-check time. A regex would have to know scoping, shadowing, destructuring, catch parameters and
 * function parameters — that is a type-checker, written worse.
 *
 * So the entry is written to a temp file and handed to the TypeScript compiler already installed here
 * (parsimony ladder, rung 4), and only diagnostic **TS2304 — "Cannot find name"** is read. The
 * unresolved bare specifiers produce TS2307 and Node globals produce TS2591; both are expected and
 * neither is a finding. TS still learns the imported NAMES from an import statement whose module it
 * cannot resolve, which is what makes the check discriminate at all.
 *
 * ## What it found the day it was written, 2026-09-29
 *
 *     vercel       (none)
 *     aws-lambda   (none)
 *     netlify      loaderCache, createProductionLoader      <- a real defect, an hour old
 *     deno-deploy  Deno                                     <- a genuine runtime global
 *
 * The netlify one was introduced by B-338's route wiring and shipped past a full suite, `node --check`,
 * six static gates and a 200 from the emulator — because the reference sits on the AGENTS path and
 * `/api/health` goes through the baked route table. Exactly the shape of the `cwd` defect the sibling
 * file records, one identifier over, and exactly why that file's scope had to become its own item.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { renderAwsLambdaEntry } from '../../packages/theo/src/adapters/aws-lambda.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { renderVercelFunctionEntry } from '../../packages/theo/src/adapters/vercel.js'

/**
 * Agents AND a route must both be configured, or the fragments that reference the most names are
 * never emitted and the check passes over an entry that exercises nothing.
 *
 * This is the trap the sibling file hit twice: `deployedAgentsFragment` returns EMPTY without a
 * source, and `renderBakedRoutes([])` emits an empty table — so a fixture missing either one makes
 * every name used only on that path invisible.
 */
const FIXTURE = {
  agentsDir: 'src/server/agents',
  serverDir: 'src/server',
  routes: [{ filePath: 'src/server/routes/health.ts', routePath: '/api/health', methods: ['GET'] }],
} as const

/**
 * Identifiers that are genuinely global on a target's runtime.
 *
 * Per target, never global to the sweep: `Deno` exists on Deno Deploy and nowhere else, and an
 * allowlist shared across targets would excuse it on a platform where it really is undefined.
 */
const RUNTIME_GLOBALS: Readonly<Record<string, readonly string[]>> = {
  'deno-deploy': ['Deno'],
}

function freeIdentifiers(source: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'theo-entry-'))
  const file = join(dir, 'entry.mjs')
  writeFileSync(file, source)

  const program = ts.createProgram([file], {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // No ambient types: the point is what the ENTRY declares, and pulling @types/node in would also
    // pull every global it declares, hiding a reference the target has no business making.
    types: [],
    skipLibCheck: true,
  })

  return [
    ...new Set(
      ts
        .getPreEmitDiagnostics(program)
        .filter((d) => d.code === 2304)
        .map(
          (d) =>
            /'([^']+)'/u.exec(ts.flattenDiagnosticMessageText(d.messageText, ' '))?.[1] ??
            'unknown',
        ),
    ),
  ]
}

const ENTRIES: readonly (readonly [string, string])[] = [
  ['vercel', renderVercelFunctionEntry(FIXTURE)],
  ['aws-lambda', renderAwsLambdaEntry(FIXTURE)],
  ['netlify', renderNetlifyFunction(FIXTURE)],
  ['deno-deploy', renderDenoEntry(3000, FIXTURE)],
]

describe('a generated entry declares every identifier it uses', () => {
  it('reports a dropped import, so the check is known to discriminate', () => {
    // COUNTERPROOF FIRST, and it is the exact regression that shipped: `netlify` emitted a baked route
    // table calling `compilePattern(...)` with the import narrowed to `matchRoute`, and the emulator
    // answered `ReferenceError: compilePattern is not defined`. A guard that cannot be made to fail is
    // a guard nobody can trust.
    const entry = renderNetlifyFunction(FIXTURE)
    const sabotaged = entry.replace(
      'import { matchRoute, compilePattern }',
      'import { matchRoute }',
    )

    expect(sabotaged, 'the sabotage did not apply, so this case proves nothing').not.toBe(entry)
    expect(freeIdentifiers(sabotaged)).toContain('compilePattern')
  })

  it('finds nothing free in an entry that declares what it uses', () => {
    // COUNTERPROOF for the sweep itself: an empty population would satisfy the assertion below.
    expect(ENTRIES.length).toBe(4)
    expect(freeIdentifiers(renderVercelFunctionEntry(FIXTURE))).toEqual([])
  })

  it.each(ENTRIES.map(([name, src]) => ({ name, src })))(
    'the $name entry declares every identifier it references',
    ({ name, src }) => {
      const allowed = RUNTIME_GLOBALS[name] ?? []
      const free = freeIdentifiers(src).filter((id) => !allowed.includes(id))

      expect(
        free,
        `the ${name} entry references these names and neither declares nor imports them. Generated ` +
          'code is a string at type-check time, so nothing else in this repository can see it: ' +
          '`node --check` sees syntax only, and the symbol detector reads this repository rather ' +
          'than the text an adapter emits. On the platform each one is a ReferenceError on the first ' +
          'request that reaches its branch',
      ).toEqual([])
    },
  )
})
