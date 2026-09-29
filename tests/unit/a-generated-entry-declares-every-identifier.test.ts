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
 * (parsimony ladder, rung 4), and the diagnostics that mean "this name is not declared here" are
 * read — **TS2304 and TS2552**; see `UNDECLARED_NAME` for why the second is not optional. The
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
import { renderBunEntry } from '../../packages/theo/src/adapters/bun.js'
import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'
import { renderNetlifyFunction } from '../../packages/theo/src/adapters/netlify.js'
import { VALID_TARGETS } from '../../packages/theo/src/adapters/types.js'
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
  // IN the shared fixture, not on the rows that remembered it. Three of the six rows passed
  // `FIXTURE` bare — `aws-lambda`, `deno-deploy` and `bun` — so their agents fragment was never
  // emitted and every name used only on that path was invisible here. That is how
  // `ReferenceError: url is not defined` reached a live Lambda while this file called the target
  // clean. A per-row option is a population gap waiting for the next row.
  agents: [{ filePath: 'agents/chat.js', agentPath: '/api/agents/chat', name: 'chat' }],
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

/**
 * The diagnostics that mean "this name is not declared here".
 *
 * TS2304 is the plain one. **TS2552 is the SAME defect when a similar name exists** — TypeScript
 * swaps the message for `Cannot find name 'x'. Did you mean 'Y'?` and changes the code with it.
 *
 * Reading only 2304 cost a live 502. Measured 2026-09-29 on a real AWS Lambda deployment: the
 * emitted entry referenced `url` in the agents fragment while `const url` lived in a different
 * function, and the compiler reported
 *
 *     TS2552: Cannot find name 'url'. Did you mean 'URL'?
 *
 * so this file called `aws-lambda` clean, the defect shipped, and `/api/agents/chat` answered
 * `502 ReferenceError: url is not defined`. A guard written for exactly this class had a hole the
 * width of one diagnostic code — and the global `URL` is what made the code differ.
 */
const UNDECLARED_NAME: ReadonlySet<number> = new Set([2304, 2552])

/**
 * Every undeclared-name diagnostic, WITH its code.
 *
 * Split out of `freeIdentifiers` so a test can assert WHICH code TypeScript emitted. Without that,
 * a sabotage proving the 2552 half would pass identically if the compiler had emitted 2304 — and
 * 2304 is the half that was already read.
 */
function undeclaredNames(
  source: string,
): readonly { readonly name: string; readonly code: number }[] {
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

  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => UNDECLARED_NAME.has(d.code))
    .map((d) => ({
      name:
        /'([^']+)'/u.exec(ts.flattenDiagnosticMessageText(d.messageText, ' '))?.[1] ?? 'unknown',
      code: d.code,
    }))
}

function freeIdentifiers(source: string): string[] {
  return [...new Set(undeclaredNames(source).map((d) => d.name))]
}

const ENTRIES: readonly (readonly [string, string])[] = [
  ['vercel', renderVercelFunctionEntry(FIXTURE)],
  ['aws-lambda', renderAwsLambdaEntry(FIXTURE)],
  ['netlify', renderNetlifyFunction(FIXTURE)],
  ['deno-deploy', renderDenoEntry(3000, FIXTURE)],
  ['cloudflare', renderCloudflareWorkerEntry({ ...FIXTURE, ssrStreaming: false })],
  ['bun', renderBunEntry(3000, FIXTURE)],
]

/**
 * Targets that emit no generated entry for this check to read, each with the reason.
 *
 * Declared rather than omitted, because the completeness case below derives its population from
 * `VALID_TARGETS`: a tenth target then has to be classified into one list or the other, and cannot
 * end up in neither. That is the argument
 * `every-deploy-target-carries-the-agents-fragment.test.ts` makes in its own header — two lists is
 * how a new adapter gets added to neither, since the excluding list is the one that costs nothing.
 */
const NO_GENERATED_ENTRY: readonly string[] = [
  // Runs from the project directory against real source; there is no emitted entry string.
  'node',
  // Emits static assets and no server entry at all.
  'static',
  // Ships no adapter in this repository yet, so there is nothing to render.
  'theo-cloud',
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

  it('reports a name TypeScript reports as TS2552, which the case above never exercises', () => {
    // The SECOND counterproof, and it exists because the first one does not cover the half that
    // shipped a 502. `compilePattern` has no similar name in scope, so TypeScript emits 2304 — the
    // code this guard already read. `url` has the global `URL` one keystroke away, so the same
    // defect arrives as 2552, and the guard called the aws-lambda entry clean while a deployed
    // `/api/agents/chat` answered `ReferenceError: url is not defined`.
    //
    // The code is asserted, not just the name. Without that, this case would pass identically if
    // the compiler had emitted 2304, and would prove nothing the case above does not.
    const source = 'export function route(request) { return { baseUrl: url.origin, request } }\n'

    const found = undeclaredNames(source)

    expect(found.map((d) => d.name)).toContain('url')
    expect(
      found.find((d) => d.name === 'url')?.code,
      'this case is meant to exercise TS2552 specifically; a 2304 here means it duplicates the ' +
        'case above and the second half of UNDECLARED_NAME is still unproven',
    ).toBe(2552)
  })

  it('finds nothing free in an entry that declares what it uses', () => {
    // COUNTERPROOF for the sweep itself: an empty population would satisfy the assertion below. The
    // EXACT population is pinned by the derived case above rather than by a number here — two places
    // asserting one fact is how the two diverge.
    expect(ENTRIES.length).toBeGreaterThan(0)
    expect(freeIdentifiers(renderVercelFunctionEntry(FIXTURE))).toEqual([])
  })

  it('covers every target that emits an entry, derived rather than listed', () => {
    // The population gap is the defect this repository keeps paying for: a guard whose INPUT excludes
    // the case looks green and proves nothing. This file shipped covering 4 of the 6 renderers, and
    // that was found by asking rather than by a failure — so the question is asked mechanically now.
    const covered = new Set([...ENTRIES.map(([n]) => n), ...NO_GENERATED_ENTRY])
    const unclassified = VALID_TARGETS.filter((target) => !covered.has(target))

    expect(
      unclassified,
      'these build targets are in neither list, so nothing says whether their emitted entry is ' +
        'checked or why it cannot be. Add the renderer to ENTRIES, or the target to ' +
        'NO_GENERATED_ENTRY with the reason',
    ).toEqual([])
    expect(ENTRIES.length + NO_GENERATED_ENTRY.length).toBe(VALID_TARGETS.length)
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
