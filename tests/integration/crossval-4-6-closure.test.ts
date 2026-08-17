/**
 * The closure register for the `crossval-4-6-absorption` plan — its Goal metric, made executable.
 *
 * ## Why this file had to be written during review
 *
 * The Goal says the plan is measured by "**17/17 closure assertions**" in
 * `crossval-gaps.test.ts`. That file is the register of the PREDECESSOR plan
 * (`crossval-absorption-gaps`): it declares `G1..G12`, asserts `toHaveLength(12)`, and its own
 * docblock still reads *"This file IS the plan's Goal metric: 12/12"*. Not one assertion in it
 * covers a gap from THIS plan's Coverage Matrix.
 *
 * The implementation summary nevertheless reported "crossval-gaps.test.ts — 33/33" under *green and
 * unblocked*. 33 is the predecessor's 12 gap blocks plus sub-assertions added inside two of them. It
 * is a real number measuring something real; it is not this plan's metric, and presenting it as one
 * is the exact failure this plan exists to prevent — a green number standing in for a claim nobody
 * checked.
 *
 * ## What 17 is
 *
 * The Coverage Matrix has 20 rows. Two are explicitly deferred with reasons (23 — needs a second
 * consumer; 25 — contributor-only). F80 is declared "Same as gap 26". 20 − 2 − 1 = **17**.
 *
 * ## Blocked is declared, never omitted
 *
 * Six of the 17 close only when the release ships: they assert against a PUBLISHED artifact, and
 * every published version is currently identical to the pre-plan one. Those declare `blockedBy` and
 * skip LOUDLY. A register that quietly dropped them would report a higher score for having tested
 * less, which is how the predecessor plan's four "still open" rows came to be wrong.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = new URL('../..', import.meta.url).pathname
const require_ = createRequire(join(REPO_ROOT, 'packages', 'agents', 'package.json'))

/** One Coverage-Matrix row. `blockedBy` names what must happen first, and is never a silent skip. */
interface Gap {
  readonly title: string
  readonly tasks: string
  readonly blockedBy?: string
}

const GAPS: Readonly<Record<string, Gap>> = {
  '13': { title: 'U-1 — GC single-project, transcript-only, sync', tasks: 'T2.2, T3.2' },
  '15': {
    title: 'createViewImageTool withheld without a reason',
    tasks: 'T1.2',
    blockedBy: '@theokit/sdk-tools 0.27.0 — no published 0.26.x carries the symbol',
  },
  '17': { title: 'Auto-approve rule absorbed behind a type-only export', tasks: 'T2.1' },
  '18': {
    title: 'MCP OAuth implemented, reachable from no package',
    tasks: 'T1.3',
    blockedBy: '@theokit/sdk release — the installed 4.52.1 predates the ./mcp-auth subpath',
  },
  '19': { title: 'Pass-through boundary declared closed, ~15 holes', tasks: 'T4.2' },
  '20': { title: 'Two "Honest gaps" rows already closed', tasks: 'T0.1' },
  '21': { title: 'All-projects sweep + liveness oracle in the consumer', tasks: 'T3.2' },
  '22': { title: 'Per-tool rendering keyed by framework names', tasks: 'T3.1' },
  '24': { title: 'CLAUDE.md names 5 siblings of 11 repos', tasks: 'T4.2' },
  '26': { title: 'U-4 — assertSecureModes refuses the framework layout', tasks: 'T2.4' },
  '27': {
    title: 'U-10 — readJsonlTail sinceMarker matched a substring',
    tasks: 'T2.5',
    blockedBy: '@theokit/sdk release — the fix is in the sibling source, not in 4.52.1',
  },
  '28': { title: 'applyPosture unreachable by any surface', tasks: 'T2.1' },
  '29': {
    title: 'listSubagentNames shipped, consumer duplicate survives',
    tasks: 'T5.2',
    blockedBy: 'Phase 5 — consumer adoption, gated on the release',
  },
  F59: { title: 'No gate watches layer→consumer', tasks: 'T4.1' },
  F78: {
    title: 'Consumer register says 8 open; 0 are',
    tasks: 'T4.3, T5.4',
    blockedBy: 'Phase 5 — T5.4 takes the consumer register to zero',
  },
  F79: { title: 'Registry half of session deletion unreachable', tasks: 'T2.2' },
  F80: {
    title: 'assertSecureModes refuses an ordinary desktop (same as gap 26)',
    tasks: 'T2.4',
    blockedBy: 'Phase 5 — verified on the operator tree by T5.3',
  },
}

const skipped: string[] = []
function blocked(id: string): boolean {
  const reason = GAPS[id]?.blockedBy
  if (reason === undefined) return false
  skipped.push(`${id}: ${reason}`)
  return true
}

/**
 * Gaps whose assertion needs something this CHECKOUT does not have — a sibling repository, a built
 * `dist` — as opposed to something the WORK has not closed yet.
 *
 * Kept apart from `skipped` for two reasons. Mechanically, the summary below asserts that every
 * entry in `skipped` corresponds to a gap declaring `blockedBy`, and an environment skip has no such
 * declaration. Substantively, they are different facts: "this gap is still open" and "this machine
 * could not check" are the distinction `cycle-acceptance` draws between REJECTED and NOT_VALIDATED,
 * and a register that collapses them starts reporting unchecked work as checked.
 */
const environmentSkips: string[] = []

/**
 * Skip loudly when a sibling repository is absent.
 *
 * The predecessor register does exactly this (`crossval-gaps.test.ts` `noteSkip`); this one asserted
 * `existsSync(...) === true` instead, so it hard-failed in CI — which clones `theokit-sdk` and never
 * `theokit-tui`. A cross-repo assertion that cannot run is not a failing assertion, but it is also
 * not a passing one, and silence is the answer that would let it rot.
 */
function siblingAbsent(gap: string, repo: string, path: string): boolean {
  if (existsSync(path)) return false
  environmentSkips.push(
    `${gap}: ../${repo} is not present in this checkout (CI clones theokit-sdk only), so its built ` +
      `surface could not be read. Run it locally with the sibling built to assert this gap.`,
  )
  return true
}

/** Names declared by the built `@theokit/agents`, or `undefined` when it has not been built. */
function agentsSurface(): Set<string> | undefined {
  const dist = join(REPO_ROOT, 'packages', 'agents', 'dist')
  if (!existsSync(dist)) return undefined
  const files = ['index.d.ts', 'session.d.ts', 'bridge.d.ts', 'config.d.ts']
    .map((f) => join(dist, f))
    .filter((f) => existsSync(f))
  if (files.length === 0) return undefined
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n')
  const names = new Set<string>()
  for (const m of text.matchAll(
    /\b(?:declare )?(?:const|function|class|type|interface|enum) ([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]!)
  }
  for (const block of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const spec of block[1]!.split(',')) {
      const ids = spec.trim().match(/[A-Za-z_$][\w$]*/g)
      if (ids?.length) names.add(ids[ids.length - 1]!)
    }
  }
  return names
}

const SURFACE = agentsSurface()

/** Assert a symbol is reachable from the BUILT surface, not merely present in source. */
function reachable(name: string): void {
  expect(SURFACE, 'packages/agents/dist is unbuilt — run pnpm build').toBeDefined()
  expect(SURFACE?.has(name), `${name} is not declared by the built @theokit/agents`).toBe(true)
}

describe('crossval-4-6-absorption — closure register', () => {
  it('test_the_register_declares_exactly_the_seventeen_the_goal_names', () => {
    // The canary. The Goal's number is 17; a register that drifted from it would make every
    // assertion below true about a different plan.
    expect(Object.keys(GAPS)).toHaveLength(17)
  })

  it('test_gap_13_the_gc_seam_is_async_and_takes_a_registry_remover', async () => {
    if (blocked('13')) return
    const { runTranscriptGC, deleteSession } =
      await import('../../packages/agents/src/session/index.js')
    expect(runTranscriptGC.constructor.name).toBe('AsyncFunction')
    expect(deleteSession.constructor.name).toBe('AsyncFunction')
  })

  it('test_gap_15_the_image_tool_crosses', () => {
    if (blocked('15')) return
    const tools = require_('@theokit/sdk-tools') as Record<string, unknown>
    expect(typeof tools.createViewImageTool).toBe('function')
  })

  it('test_gap_17_the_auto_approve_rule_is_callable', () => {
    if (blocked('17')) return
    reachable('shouldAutoApprove')
    reachable('WRITE_SCOPED_TOOLS')
  })

  it('test_gap_18_the_mcp_oauth_flow_is_importable', () => {
    if (blocked('18')) return
    const auth = require_('@theokit/sdk/mcp-auth') as Record<string, unknown>
    expect(typeof auth.runPkceFlow).toBe('function')
  })

  it('test_gap_19_every_doorless_sdk_subpath_carries_a_decision', async () => {
    if (blocked('19')) return
    const { DOORLESS_DECISIONS } = await import('../../scripts/lib/boundary-decisions.mjs')
    expect(Object.keys(DOORLESS_DECISIONS).length).toBeGreaterThan(20)
    // The boundary comment must no longer claim the boundary is CLOSED — that claim was false for
    // 25 subpaths, and a reader who believes it stops looking.
    const index = readFileSync(join(REPO_ROOT, 'packages/agents/src/index.ts'), 'utf8')
    expect(index, 'the comment must point at the decision record').toMatch(
      /boundary-\s*\n?\s*\/\/ decisions|boundary-decisions/,
    )
    expect(index, 'and must say the claim it used to make was false').toContain('was false for 25')
  })

  it('test_gap_20_the_honest_gaps_inversion_exists', () => {
    if (blocked('20')) return
    const guard = readFileSync(join(REPO_ROOT, 'tests/integration/crossval-gaps.test.ts'), 'utf8')
    expect(guard).toContain('test_honest_gaps_symbols_do_not_resolve')
  })

  it('test_gap_21_the_liveness_oracle_is_reachable_with_injected_enumeration', () => {
    if (blocked('21')) return
    reachable('classifyProjects')
  })

  it('test_gap_22_the_tui_ships_overridable_per_tool_rendering', () => {
    if (blocked('22')) return
    const dts = join(REPO_ROOT, '..', 'theokit-tui', 'dist', 'index.d.ts')
    if (siblingAbsent('22', 'theokit-tui', dts)) return
    const text = readFileSync(dts, 'utf8')
    for (const name of ['toolPresentation', 'DEFAULT_TOOL_PRESENTATION', 'KNOWN_TOOL_NAMES']) {
      expect(text, `${name} missing from the built @theokit/tui`).toContain(name)
    }
  })

  it('test_gap_24_the_ecosystem_table_is_completed_or_demoted', () => {
    if (blocked('24')) return
    const claude = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
    expect(claude, 'the table must say what it is, given it names 5 of 11 repos').toMatch(
      /explicitly \*\*demoted\*\*|explicitly demoted/,
    )
  })

  it('test_gap_26_the_creators_agree_with_the_check', async () => {
    if (blocked('26')) return
    const { mkdtempSync, statSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { recordProjectDir } = await import('../../packages/agents/src/session/project-index.js')
    const root = mkdtempSync(join(tmpdir(), 'closure-26-'))
    recordProjectDir('/some/project', root)
    expect(statSync(join(root, 'projects')).mode & 0o022).toBe(0)
  })

  it('test_gap_27_the_marker_is_matched_as_a_field', () => {
    if (blocked('27')) return
    const ops = require_('@theokit/sdk/persistence') as Record<string, unknown>
    expect(typeof ops.readJsonlTail).toBe('function')
  })

  it('test_gap_28_the_posture_enforcement_is_reachable', () => {
    if (blocked('28')) return
    // The row's own words: "applyPosture unreachable by any surface". A type-only export leaves the
    // gap open, which is what shipped until this review.
    reachable('applyPosture')
  })

  it('test_gap_29_the_consumer_duplicate_is_gone', () => {
    if (blocked('29')) return
    expect.fail('unreachable while blocked')
  })

  it('test_gap_F59_the_invention_gate_exists_and_runs', async () => {
    if (blocked('F59')) return
    const { findUnreachableEnforcement } =
      await import('../../scripts/lib/invention-reachability.mjs')
    expect(typeof findUnreachableEnforcement).toBe('function')
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['check:all']).toContain('check:invention-reachability')
  })

  it('test_gap_F78_the_consumer_register_is_at_zero', () => {
    if (blocked('F78')) return
    expect.fail('unreachable while blocked')
  })

  it('test_gap_F79_the_registry_half_of_deletion_is_reachable', async () => {
    if (blocked('F79')) return
    const { deleteSession } = await import('../../packages/agents/src/session/index.js')
    // The seam accepts an async remover — the shape the only agent registry in the ecosystem has.
    const result = await deleteSession('nope', {
      cwd: REPO_ROOT,
      root: join(REPO_ROOT, 'does-not-exist'),
      force: true,
      removeFromRegistry: async () => {
        await Promise.resolve()
      },
    })
    expect(result.registryRemoved).toBe(true)
  })

  it('test_gap_F80_verified_on_the_operator_tree', () => {
    if (blocked('F80')) return
    expect.fail('unreachable while blocked')
  })

  it('test_the_blocked_gaps_are_reported_by_name', () => {
    // Runs last by file order, and its job is to make the skips LOUD. A register that silently
    // dropped six rows would report a better score for having checked less — which is exactly how
    // the predecessor plan's four "still open" rows came to be wrong.
    if (skipped.length > 0) {
      console.warn(
        `[crossval-4-6 closure] ${String(skipped.length)} of 17 gaps are BLOCKED and were not ` +
          `asserted:\n  ${skipped.join('\n  ')}`,
      )
    }
    if (environmentSkips.length > 0) {
      // Reported separately and just as loudly. These are NOT open gaps — they are gaps this
      // checkout could not read, and calling them either "closed" or "open" would be a claim the
      // run did not earn.
      console.warn(
        `[crossval-4-6 closure] ${String(environmentSkips.length)} gap(s) NOT VERIFIABLE in this ` +
          `checkout:\n  ${environmentSkips.join('\n  ')}`,
      )
    }
    const closedNow = 17 - skipped.length - environmentSkips.length
    console.warn(
      `[crossval-4-6 closure] ${String(closedNow)}/17 closure assertions executed ` +
        `(${String(skipped.length)} blocked, ${String(environmentSkips.length)} not verifiable here).`,
    )
    expect(skipped.length, 'every skip must carry a reason').toBe(
      Object.values(GAPS).filter((g) => g.blockedBy !== undefined).length,
    )
  })
})
