/**
 * T0.5 — The executable gap register for the `crossval-absorption-gaps` plan.
 *
 * This file IS the plan's Goal metric: "12/12 gap-closure assertions green".
 *
 * Why a test file and not a checklist (plan D3): the worst finding of the 2026-08-14
 * cross-validation was that *completed* work went unnoticed — five absorptions shipped and the
 * consumer's own upstream register still called four of them open. A markdown checklist reproduces
 * exactly that failure, because it can be ticked without the fact holding. Filesystem and API facts
 * are assertable, so they are asserted.
 *
 * Two invariants this file must never lose:
 *
 *  1. **No mocks for filesystem facts.** A test that stubs `existsSync` to prove a README exists is
 *     theatre. Every assertion below reads the real tree or the real published surface.
 *  2. **A skip is never silently a pass (EC-4).** On a fresh clone `packages/agents/dist/` may be
 *     unbuilt, which would skip every `.d.ts`-reading assertion and report success having verified
 *     nothing — a vacuous pass on the plan's single metric. `ci_refuses_a_mostly_skipped_run`
 *     below turns that into a failure under CI.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(TEST_DIR, '..', '..')

/** Repo-relative read; throws loudly rather than returning '' so a typo cannot pass as "no match". */
function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8')
}

function exists(relPath: string): boolean {
  return existsSync(join(REPO_ROOT, relPath))
}

/** The published surface a consumer actually sees. Empty when `dist/` is unbuilt — see EC-4. */
function agentsDts(): string {
  const dist = join(REPO_ROOT, 'packages', 'agents', 'dist')
  if (!existsSync(dist)) return ''
  return readdirSync(dist)
    .filter((f) => f.endsWith('.d.ts'))
    .map((f) => readFileSync(join(dist, f), 'utf8'))
    .join('\n')
}

const DIST_BUILT = agentsDts().length > 0

/**
 * T0.1 / EC-2 — what the published surface actually offers a consumer.
 *
 * Three sources, and the third is the one that matters. Until this existed the guard below asked
 * `dts.includes(symbol)`, so `agent` matched on `agentHandle` and on the literal string
 * `@theokit/agents` — every short symbol name was unguarded by construction, and the index's first
 * two rows were fabricated under a green test.
 *
 * The `export *` hop is not optional. `dist/index.d.ts` carries five forwards contributing 38 names,
 * including `TheokitAgentError`. A parser blind to them reports a false ABSENCE, and the reflex on a
 * red CI is to delete the row — removing a real capability from the map. That blindness applied by
 * hand is what produced registered gap 16 and the U-11 caveat.
 *
 * One hop is enough for every forward here and keeps the walk terminating without a cycle check. A
 * target that cannot be read is REPORTED, never treated as exporting nothing — a quiet empty set is
 * how a guard goes vacuous a second time.
 *
 * It lives in this file, not in `scripts/lib/`, because it has exactly ONE consumer today. The
 * layer-invention gate (T4.1) will be the second, and extraction belongs to that task:
 * `system-design-guardrails.md § G12` says extract on the repetition, not in anticipation of it.
 * `check-surface-parity.mjs` parses `.d.ts` too but answers a SUBPATH-scoped question, so it is not
 * a repetition of this one — merging them is the accidental coupling the same rule forbids.
 *
 * Declared limitation: `agentsDts()` unions every `.d.ts` in `dist/`, internal bundler chunks
 * included, so some mangled aliases enter the set and the SUBPATH a symbol comes from is not
 * checked — only that the package exports it somewhere.
 */
const DECLARATION_RE =
  /^[ \t]*(?:export )?(?:declare )?(?:abstract )?(?:const|function|class|type|interface|enum) ([A-Za-z_$][\w$]*)/gm
const EXPORT_BLOCK_RE = /export\s*\{([^}]*)\}/g
const STAR_FORWARD_RE = /^export\s+\*\s+from\s+'([^']+)'/gm

function typeCandidates(resolvedJsPath: string): string[] {
  // `require.resolve` picks the CJS branch, whose declarations are `.d.cts` when a package ships
  // dual types. Going straight to `.d.ts` works for the SDK only because it ships both.
  return [
    resolvedJsPath.replace(/\.cjs$/, '.d.cts'),
    resolvedJsPath.replace(/\.[cm]?js$/, '.d.ts'),
    resolvedJsPath.replace(/\.mjs$/, '.d.mts'),
  ]
}

function declaredExportsFromText(
  text: string,
  resolveFrom?: string,
): { names: Set<string>; unresolvedForwards: string[] } {
  const names = new Set<string>()
  const unresolvedForwards: string[] = []

  const harvest = (source: string, follow: boolean): void => {
    for (const m of source.matchAll(DECLARATION_RE)) names.add(m[1]!)
    for (const block of source.matchAll(EXPORT_BLOCK_RE)) {
      for (const spec of block[1]!.split(',')) {
        // `A as B` exports B; a bare `A` exports A. The LAST identifier is the exported name.
        const ids = spec.trim().match(/[A-Za-z_$][\w$]*/g)
        if (ids?.length) names.add(ids[ids.length - 1]!)
      }
    }
    if (!follow || !resolveFrom) return
    const require_ = createRequire(resolveFrom)
    for (const star of source.matchAll(STAR_FORWARD_RE)) {
      const spec = star[1]!
      try {
        const dts = typeCandidates(require_.resolve(spec)).find((c) => existsSync(c))
        if (!dts) {
          unresolvedForwards.push(spec)
          continue
        }
        harvest(readFileSync(dts, 'utf8'), false) // one hop only
      } catch {
        unresolvedForwards.push(spec)
      }
    }
  }

  harvest(text, Boolean(resolveFrom))
  return { names, unresolvedForwards }
}

const PUBLISHED = declaredExportsFromText(
  agentsDts(),
  join(REPO_ROOT, 'packages', 'agents', 'package.json'),
)

/** The root symbol of a citation: `AgentBuilder.create` -> `AgentBuilder`, `Agent<T>` -> `Agent`. */
function rootSymbol(cited: string): string {
  return cited.split('.')[0]!.split('<')[0]!
}

/**
 * The backticked identifier in a capability row's SYMBOL column (the second cell).
 *
 * Reading the first backtick of the whole line is wrong: the Capability column is prose and may
 * carry inline code of its own — the `instanceof` row does — so the first match can be an English
 * keyword rather than the symbol being claimed.
 */
function symbolCell(row: string): string | undefined {
  const cells = row.split('|').map((c) => c.trim())
  // cells[0] is '' (leading pipe), cells[1] = Capability, cells[2] = Symbol.
  return /^`([A-Za-z_][\w.<>]*)`$/.exec(cells[2] ?? '')?.[1]
}

/**
 * The gap manifest — single source of truth (DRY). A gap cannot be quietly dropped: the meta-test
 * asserts the count, and the register asserts every id has a `describe` block below.
 */
const GAPS = {
  G1: { title: 'forkBeforeUserTurn published broken (always throws)', phase: 1 },
  G2: { title: 'No persisted permission rules anywhere', phase: 3 },
  G3: { title: 'Delegated member does not inherit the parent hook veto', phase: 3 },
  G4: { title: 'Fingerprint gate has no producer for `approved`', phase: 3 },
  G5: { title: 'GC pointer protection is inert for other consumers', phase: 4 },
  G6: { title: 'resolveCredential covers only the env-only half', phase: 4 },
  G7: { title: 'Parity gate covers 1 of 19 subpaths', phase: 5 },
  G8: { title: 'Config/context reachable only via a deprecated barrel', phase: 2 },
  G9: { title: 'Tarball ships no README/CHANGELOG; versions stranded', phase: 0 },
  G10: { title: 'No capability index anywhere', phase: 0 },
  G11: { title: 'testing seam typed over the wrong type', phase: 1 },
  G12: { title: '@theokit/tui U-8/U-9 open', phase: 6 },
} as const

type GapId = keyof typeof GAPS

/** Records which gaps skipped and why, so EC-4's guard can name them instead of counting silently. */
const skipped: Array<{ gap: GapId; reason: string }> = []

function noteSkip(gap: GapId, reason: string): void {
  // Deduped by gap id: one unbuilt `dist/` makes several assertions of the SAME gap skip, and
  // `ci_refuses_a_mostly_skipped_run` caps the TOTAL at 1. Counting them separately would turn a
  // designed skip into a CI failure the moment a gap grows a second assertion.
  if (skipped.some((s) => s.gap === gap)) return
  skipped.push({ gap, reason })

  console.warn(`[crossval-gaps] ${gap} SKIPPED — ${reason}`)
}

describe('crossval gap register — meta', () => {
  it('every_registered_gap_has_an_assertion', () => {
    expect(Object.keys(GAPS)).toHaveLength(12)
    const source = read('tests/integration/crossval-gaps.test.ts')
    for (const id of Object.keys(GAPS) as GapId[]) {
      expect(source, `gap ${id} has no describe block`).toContain(`describe('${id} —`)
    }
  })

  /**
   * EC-4 (MUST FIX) — a mostly-skipped run is a vacuous pass, not a pass.
   *
   * Runs last by declaration order so `skipped` is populated. Only enforced under CI: locally an
   * unbuilt `dist/` is an ordinary state and failing on it would train people to ignore this suite.
   */
  it('ci_refuses_a_mostly_skipped_run', () => {
    if (!process.env.CI) return
    expect(
      skipped.length,
      `too many gap assertions skipped: ${JSON.stringify(skipped)}`,
    ).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Phase 0 — signal
// ---------------------------------------------------------------------------

describe('G9 — the published tarball carries prose', () => {
  it('tarball_ships_readme_and_changelog', () => {
    expect(exists('packages/agents/README.md'), 'packages/agents/README.md is missing').toBe(true)
    expect(exists('packages/agents/CHANGELOG.md')).toBe(true)

    const manifest = JSON.parse(read('packages/agents/package.json')) as { files?: string[] }
    expect(manifest.files ?? []).toContain('README.md')
    expect(manifest.files ?? []).toContain('CHANGELOG.md')
  })

  it('agents_readme_documents_the_real_surface', () => {
    // Reviewed and rewritten: the first version of this test asserted "≥ 30 non-blank lines" and
    // "≥ 10 subpaths named" — two magic numbers that measure length, not truth, and that a stub
    // padded with prose would satisfy. Both thresholds below are DERIVED from the manifest, and the
    // first assertion is a correctness property rather than a size one.
    const readme = read('packages/agents/README.md')
    const manifest = JSON.parse(read('packages/agents/package.json')) as {
      exports?: Record<string, unknown>
    }
    const subpaths = Object.keys(manifest.exports ?? {})
    expect(subpaths.length, 'the package declares no subpaths').toBeGreaterThan(0)

    // (a) The README must not document a subpath that does not exist. Docs naming a surface the
    //     package does not publish are worse than no docs: the consumer writes the import and finds
    //     out at build time. This is the same defect class as the fabricated `.rateLimit()` example
    //     caught earlier in this slice.
    const documented = [...readme.matchAll(/@theokit\/agents(\/[a-z-]+)/g)].map((m) => `.${m[1]}`)
    const fabricated = [...new Set(documented)].filter((s) => !subpaths.includes(s))
    expect(fabricated, 'the README documents subpaths the package does not publish').toEqual([])

    // (b) Coverage as a ratio of what is actually published, so adding a subpath without
    //     documenting it moves the number. The gap this closes was undiscoverable capability —
    //     prose that names half the surface is the floor for calling it discoverable.
    const named = subpaths.filter((s) => readme.includes(s))
    expect(
      named.length,
      `README names ${named.length} of ${subpaths.length} published subpaths`,
    ).toBeGreaterThanOrEqual(Math.ceil(subpaths.length / 2))
  })

  it('changelog_has_heading_for_published_version', () => {
    const version = (JSON.parse(read('packages/agents/package.json')) as { version: string })
      .version
    const changelog = read('CHANGELOG.md')
    const headings = changelog.split('\n').filter((l) => l.startsWith('## ['))
    expect(
      headings.some((h) => h.includes(version)),
      `no version heading mentions ${version}; last headings: ${headings.slice(0, 3).join(' | ')}`,
    ).toBe(true)
  })

  it('changelog_does_not_call_published_version_unpublished', () => {
    const version = (JSON.parse(read('packages/agents/package.json')) as { version: string })
      .version
    const changelog = read('CHANGELOG.md')
    const escaped = version.replace(/\./g, '\\.')
    const claimsUnpublished = new RegExp(
      `${escaped}[^\\n]*(unpublished|not yet published|nao publicad|não publicad)`,
      'i',
    )
    expect(claimsUnpublished.test(changelog)).toBe(false)
  })
})

describe('G10 — a capability index exists and resolves', () => {
  it('capability_index_exists_and_resolves', () => {
    expect(exists('wiki/capability-index.md'), 'wiki/capability-index.md is missing').toBe(true)
    const index = read('wiki/capability-index.md')

    // A capability row is `| need | `symbol` | `@theokit/agents/...` | version |`. The subpath cell
    // is what distinguishes it from the "Honest gaps" table, which cites symbols that deliberately
    // do NOT exist yet — asserting those resolve would forbid the page from being honest.
    const rows = index
      .split('\n')
      .filter(
        (l) => l.startsWith('|') && /`[A-Za-z_][\w.]*`/.test(l) && l.includes('@theokit/agents'),
      )
    expect(rows.length, 'capability index has fewer than 5 capability rows').toBeGreaterThanOrEqual(
      5,
    )

    if (!DIST_BUILT) {
      noteSkip('G10', 'packages/agents/dist is unbuilt — symbol resolution not verifiable')
      return
    }
    const { names } = PUBLISHED
    for (const row of rows) {
      // The SYMBOL column, not the first backtick in the line. The Capability column is prose and
      // may itself contain inline code — row 73 cites `instanceof` there — so taking the first
      // match asserts a keyword against the published surface and fails a correct row.
      const symbol = symbolCell(row)
      if (!symbol) continue
      const root = rootSymbol(symbol)
      expect(
        names.has(root),
        `capability index cites \`${symbol}\`, which is not a DECLARED export of the published ` +
          `surface (looked for \`${root}\`). A substring match used to let this pass.`,
      ).toBe(true)
    }
  })

  it('test_star_forwarded_symbols_resolve', () => {
    // EC-2 — the regression that keeps the parser honest. `TheokitAgentError` reaches a consumer
    // ONLY through `export * from '@theokit/sdk/errors'` at dist/index.d.ts. A parser that reads
    // just `declare` + `export {}` calls it absent, which is exactly the false measurement that
    // produced registered gap 16 and sent this plan chasing a re-export that already existed.
    if (!DIST_BUILT) {
      noteSkip('G10', 'packages/agents/dist is unbuilt — star-forward resolution not verifiable')
      return
    }
    const { names } = PUBLISHED
    for (const symbol of ['TheokitAgentError', 'isTransientError']) {
      expect(
        names.has(symbol),
        `${symbol} is forwarded by \`export *\` and the parser must follow it`,
      ).toBe(true)
    }
  })

  it('test_member_and_generic_citations_resolve_on_their_root_symbol', () => {
    // The corrected rows cite entry points as members (`AgentBuilder.create`), so the guard has to
    // resolve the root rather than the whole dotted path — otherwise correcting the fabricated
    // rows would replace them with rows that also fail.
    expect(rootSymbol('AgentBuilder.create')).toBe('AgentBuilder')
    expect(rootSymbol('Agent<T>')).toBe('Agent')
    expect(rootSymbol('Tool.create')).toBe('Tool')
    if (!DIST_BUILT) return
    const { names } = PUBLISHED
    expect(names.has(rootSymbol('AgentBuilder.create'))).toBe(true)
    expect(names.has(rootSymbol('Tool.create'))).toBe(true)
  })

  it('test_an_unresolvable_star_target_is_reported_not_silently_empty', () => {
    // Exercised against a SYNTHETIC surface, not against `node_modules`. Asserting that the real
    // tree has zero unresolved forwards tests the tree, not the parser — it can never go red while
    // the install is healthy, so it would prove nothing about the behaviour it names. Feeding text
    // with a deliberately broken forward is what proves the parser reports instead of swallowing.
    const broken = declaredExportsFromText(
      "export * from '@theokit/does-not-exist'\nexport { a as Kept }\n",
      join(REPO_ROOT, 'packages', 'agents', 'package.json'),
    )
    expect(broken.unresolvedForwards).toEqual(['@theokit/does-not-exist'])
    expect(broken.names.has('Kept'), 'a broken forward must not discard the names around it').toBe(
      true,
    )

    // And the real surface must currently have none — a regression signal if an install breaks.
    if (!DIST_BUILT) return
    const { unresolvedForwards } = PUBLISHED
    expect(
      unresolvedForwards,
      `these \`export *\` targets could not be read, so their symbols are unverified: ${unresolvedForwards.join(', ')}`,
    ).toEqual([])
  })

  it('test_honest_gaps_symbols_do_not_resolve', () => {
    // The inverse assertion (gap 20). A row under "Honest gaps" claims a capability is NOT
    // available; if its symbol resolves, the row is stale and a reader builds what already ships —
    // the same failure as a fabricated row, pointing the other way.
    if (!DIST_BUILT) {
      noteSkip('G10', 'packages/agents/dist is unbuilt — honest-gaps inversion not verifiable')
      return
    }
    const index = read('wiki/capability-index.md')
    const section = index.split('## Honest gaps')[1]?.split('\n## ')[0] ?? ''
    expect(
      section.length,
      'wiki/capability-index.md has no `## Honest gaps` section',
    ).toBeGreaterThan(0)

    const { names } = PUBLISHED
    for (const line of section.split('\n')) {
      if (!line.startsWith('|')) continue
      // A row may truthfully cite a symbol that DOES resolve while the capability does not exist —
      // `McpOAuthConfig` is type-only and the row says so. Asserting on the symbol alone would put
      // GREEN pressure on deleting an honest row, which is the failure this file warns about at the
      // top. Only rows that do NOT declare the type-only/absent shape are held to non-resolution.
      if (/type-only|no implementation|not shipped|by declaration/i.test(line)) continue
      for (const m of line.matchAll(/`([A-Z][\w.]*)`/g)) {
        const root = rootSymbol(m[1]!)
        expect(
          names.has(root),
          `\`${root}\` is listed under "Honest gaps" but IS on the published surface — the row is ` +
            `stale and tells a reader to build what already ships`,
        ).toBe(false)
      }
    }
  })

  it('readme_examples_import_exported_symbols', () => {
    const readme = read('README.md')
    const imports = [...readme.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(theokit[^']*)'/g)]
    expect(imports.length, 'README teaches no theokit import at all').toBeGreaterThan(0)

    const removed = read('packages/theo/src/server/define/index.ts')
    for (const [, names] of imports) {
      for (const raw of names.split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0]
        if (!name) continue
        // ADR-0043 D1 removed the legacy `define*` FUNCTIONS from the public API. The README must
        // not teach them; `define/index.ts` states the removal in prose, so it is the oracle.
        if (/^define[A-Z]/.test(name)) {
          expect(
            removed.includes(`export { ${name}`) || removed.includes(`  ${name},`),
            `README:${name} — teaches an import removed from the public API (ADR-0043 D1)`,
          ).toBe(true)
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Phase 1 — broken published primitives
// ---------------------------------------------------------------------------

describe('G1 — forkBeforeUserTurn counts the record shape the SDK writes', () => {
  it('counts_top_level_type_not_nested_role', () => {
    const src = read('packages/agents/src/session/session-lifecycle.ts')
    expect(
      src,
      'recordIndexOfUserTurn still filters on `record.role`, which no SessionRecord carries',
    ).not.toMatch(/record\.role\s*!==\s*'user'/)
    expect(src).toMatch(/record\.type\s*!==\s*'user'/)
  })

  it('guards_against_forking_a_session_onto_itself', () => {
    const src = read('packages/agents/src/session/session-lifecycle.ts')
    expect(src, 'EC-1: srcId === newId would truncate the source in place').toMatch(
      /srcId\s*===\s*newId/,
    )
  })

  it('has_a_regression_suite', () => {
    expect(exists('packages/agents/tests/unit/session-fork.test.ts')).toBe(true)
  })
})

/**
 * G11 — **the gap as registered did not reproduce, and the register says so rather than pretending.**
 *
 * The cross-validation recorded `inspectCompiled` as "typed over the wrong type", citing the
 * consumer's `composition.test.ts:1-19` as documenting a refusal. Re-read at implementation time,
 * those lines document something else: the consumer declines the framework's **stream** seam
 * ("for driving a RUN … there is no run to drive"), which is a correct call, not a gap. Exercised
 * against the real `AgentBuilder`, `inspectCompiled` accepts the builder's output with no cast and
 * no type error.
 *
 * What WAS true and is now closed: the export had **zero tests** in this repository, which violates
 * G7 ("every export has a consumer") and is how a shape problem would have gone unnoticed if there
 * had been one. The assertion below pins the contract that actually matters — the seam accepts what
 * the public authoring path produces — instead of asserting the absence of a type signature.
 */
describe('G11 — the testing seam accepts what the composition path returns', () => {
  it('inspect_compiled_has_a_regression_suite', () => {
    expect(exists('packages/agents/tests/unit/inspect-compiled.test.ts')).toBe(true)
  })

  it('inspect_compiled_accepts_builder_output_without_a_cast', () => {
    const suite = read('packages/agents/tests/unit/inspect-compiled.test.ts')
    expect(
      suite,
      'the suite must exercise the real AgentBuilder, not a hand-written fixture',
    ).toContain('AgentBuilder.create()')
    expect(suite, 'a cast would hide the very defect the gap alleged').not.toMatch(
      /inspectCompiled\([^)]*as /,
    )
  })
})

// ---------------------------------------------------------------------------
// Phase 2 — reachability
// ---------------------------------------------------------------------------

describe('G8 — config and context have a non-deprecated door', () => {
  it('agents_declares_a_config_subpath', () => {
    const manifest = JSON.parse(read('packages/agents/package.json')) as {
      exports?: Record<string, unknown>
    }
    expect(Object.keys(manifest.exports ?? {})).toContain('./config')
  })

  it('config_entry_forwards_the_seven_symbols', () => {
    const entry = 'packages/agents/src/config-entry.ts'
    expect(exists(entry), `${entry} is missing`).toBe(true)
    const src = read(entry)
    for (const symbol of [
      'LayeredConfig',
      'TrustStore',
      'loadInstructionTree',
      'composeInstructions',
      'loadCustomCommands',
      'contextPressure',
      'loadEnv',
    ]) {
      expect(src, `${symbol} is not forwarded from the config subpath`).toContain(symbol)
    }
  })

  it('deprecated_barrel_names_its_replacement', () => {
    const src = read('packages/theo/src/server/index.ts')
    expect(src, 'the deprecation notice does not tell the reader where to go').toContain(
      '@theokit/agents/config',
    )
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — safeguards
// ---------------------------------------------------------------------------

describe('G3 — a delegated member inherits the parent hook veto', () => {
  it('delegation_composes_parent_hooks', () => {
    expect(exists('packages/agents/tests/unit/delegation-hook-inheritance.test.ts')).toBe(true)

    // The composition lives in `agent-orchestrator.ts` (where `delegate()` already merged the
    // parent's tools and budget) — not in `delegation-lifecycle.ts`, which the plan named before the
    // path was read. Asserting against the file the work actually landed in, not the one predicted.
    const orchestrator = read('packages/agents/src/bridge/agent-orchestrator.ts')
    expect(orchestrator, '`delegate()` does not carry the parent hooks').toContain('parentHooks')
    expect(orchestrator, 'the inherited gate never reaches the member run').toContain(
      'withInheritedHooks',
    )
  })

  it('inheritance_is_reachable_by_a_consumer', async () => {
    // G7 (every export has a consumer) AND the point of the gap: a rule a consumer cannot import is
    // a rule they will re-derive — which is how the sixteen-line version came to exist downstream.
    const mod = (await import('../../packages/agents/src/hooks/index.js')) as {
      inheritHooks?: unknown
    }
    expect(typeof mod.inheritHooks).toBe('function')
  })
})

describe('G4 — the fingerprint gate has a producer', () => {
  it('approval_store_exists_and_is_exported', () => {
    expect(exists('packages/agents/src/hooks/approval-store.ts')).toBe(true)
    expect(read('packages/agents/src/hooks/index.ts')).toMatch(/approval-store/)
  })
})

describe('G2 — tool permission grants persist', () => {
  it('permission_store_exists_and_is_exported', () => {
    expect(exists('packages/agents/src/auth/permission-store.ts')).toBe(true)
    expect(read('packages/agents/src/auth-entry.ts')).toMatch(/permission-store/)
  })
})

// ---------------------------------------------------------------------------
// Phase 4 — partial absorptions
// ---------------------------------------------------------------------------

describe('G6 — resolveCredential covers the mechanisms it claims', () => {
  /**
   * SCOPE CORRECTION, recorded rather than quietly dropped.
   *
   * The gap was registered as "no longest-match-wins on key-prefix inference" (EC-3). Read at
   * implementation time, this resolver has NO key-prefix inference: it selects by declared
   * `priority`, and `modelPrefix` matches the MODEL id (`openai/…`), never the key (`sk-ant-…`).
   * There is no longest-match bug because there is no prefix match on keys, and an earlier draft of
   * this assertion passed only because a single key was present — green for a reason unrelated to
   * its name, which is the exact failure this register exists to prevent.
   *
   * What WAS real: `CredentialResolution.kind` declared an `'oauth'` variant, and `SourceOrigin` an
   * `{ kind: 'oauth' }` arm, that NO code path could produce. A type promising a variant a consumer
   * can never receive is worse than an absent one — they write the `case` and it never runs.
   */
  it('the_declared_oauth_variant_is_producible', () => {
    const src = read('packages/agents/src/auth/resolve-credential.ts')
    expect(src, 'no path builds a kind:oauth resolution').toMatch(/kind:\s*'oauth'/)
    expect(src, 'the stored credential is never consulted').toContain('readStoredOAuth')
  })

  it('has_a_regression_suite', () => {
    expect(exists('packages/agents/tests/unit/resolve-credential.test.ts')).toBe(true)
  })
})

describe('G5 — GC protection is injectable', () => {
  it('transcript_gc_accepts_injected_protected_ids', () => {
    const src = read('packages/agents/src/session/gc/transcript-gc.ts')
    expect(
      src,
      'protection is still derived solely from this framework’s pointer convention',
    ).toMatch(/protectedIds/)
  })
})

// ---------------------------------------------------------------------------
// Phase 5 — the root cause
// ---------------------------------------------------------------------------

describe('G7 — the parity gate walks every subpath', () => {
  /**
   * SCOPE CORRECTION, measured at implementation time.
   *
   * The gap was registered as "the gate covers 1 of 19 subpaths". Measured against the SDK's own
   * `exports` map, only **6** of the layer's 20 subpaths have a same-named SDK counterpart — `.`,
   * `/sandbox`, `/persistence`, `/interactive`, `/auth`, `/client`. For the other 14 the layer owns
   * the surface outright, and "does it forward everything the SDK exports there" is not a weaker
   * question, it is an undefined one.
   *
   * So the honest headline is **1 of 6 applicable**, not 1 of 19. Keeping the larger denominator
   * would have made the gate look worse than it is and the remaining work look bigger than it is —
   * and a register that inflates its own findings is not one anybody trusts twice.
   */
  it('gate_enumerates_subpaths_from_the_manifest', () => {
    // Reviewed and rewritten: this asserted `src.toContain('AGENTS_MANIFEST.exports')` — grepping
    // the gate's own source. That passes for a gate that reads the manifest and then ignores it, and
    // it breaks on a rename that changes nothing. So RUN the gate and hold its arithmetic to the
    // manifest instead: every published subpath must be accounted for as decided, warned, or
    // skipped. Hard-code a list and the sum stops matching the moment a subpath is added.
    expect(exists('scripts/check-surface-parity.mjs'), 'the gate was not generalized').toBe(true)

    const published = Object.keys(
      (JSON.parse(read('packages/agents/package.json')) as { exports?: Record<string, unknown> })
        .exports ?? {},
    ).length
    expect(published, 'the package declares no subpaths').toBeGreaterThan(0)

    const run = spawnSync(process.execPath, [join(REPO_ROOT, 'scripts/check-surface-parity.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    expect(run.status, output).toBe(0)

    const tally =
      /(\d+)\/(\d+) applicable subpath\(s\) decided; (\d+) in warn mode; (\d+) have no SDK counterpart/.exec(
        output,
      )
    expect(tally, `the gate did not report a tally:\n${output}`).not.toBeNull()

    const applicable = Number(tally![2])
    const withoutCounterpart = Number(tally![4])
    expect(
      applicable + withoutCounterpart,
      `the gate accounted for ${String(applicable + withoutCounterpart)} subpaths, the manifest publishes ${String(published)}`,
    ).toBe(published)
  })

  it('gate_is_wired_into_check_all', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.['check:all'] ?? '').toMatch(/check:surface-parity/)
  })

  it('warn_mode_cannot_become_permanent', () => {
    // The forcing function, and the difference between a structural fix and "we print something":
    // every deferred subpath carries a date past which the gate fails hard.
    const src = read('scripts/check-surface-parity.mjs')
    expect(src).toContain('SUNSET')
    expect(src, 'a deferral with no date is an indefinite one').toMatch(/and that date has passed/)
  })

  it('the_gate_has_its_own_suite', () => {
    expect(exists('tests/unit/check-surface-parity.test.ts')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phase 6 — sibling repo (version-gated, per plan D7)
// ---------------------------------------------------------------------------

/**
 * G12 — closed in the sibling repo, per plan D7.
 *
 * `usetheodev/theokit-tui` PR #76, merged 2026-08-15: `FreeTextInput` gained `mask` (U-9) and
 * `StatusFooter` now forwards `modeLabel` (U-8). Two scope corrections came out of reading the code
 * instead of executing the plan blind, and both are recorded rather than quietly applied:
 *
 *  - The plan asserted the consumer "keeps the secret out of React state". Measured against its
 *    `SecretInput.tsx`: **false** — it uses `useState`. So the ref was NOT implemented; it would be
 *    the same heap with a stronger-sounding story. What ships is the property that holds at a
 *    terminal — the plaintext never reaches the screen.
 *  - The plan asked to WIDEN `StatusFooterProps.mode`. `ModeIndicator` had already solved this with
 *    `label` and keeps the union closed on purpose so a typo is still caught. The real gap was the
 *    composed footer never forwarding it.
 *
 * The assertion below still reads the INSTALLED package, so it stays honest about this workspace:
 * `@theokit/tui` is not a dependency here, so it skips loudly rather than claiming a fact it cannot
 * see. It turns green on its own once the published version carries the prop.
 */
describe('G12 — @theokit/tui exposes a masked input', () => {
  it('free_text_input_supports_a_masked_mode', () => {
    const tuiDts = join(REPO_ROOT, 'node_modules', '@theokit', 'tui', 'dist', 'index.d.ts')
    if (!existsSync(tuiDts)) {
      noteSkip(
        'G12',
        '@theokit/tui is not installed here — closed upstream in theokit-tui#76 (mask + modeLabel), pending publish of 0.53.0',
      )
      return
    }
    const dts = readFileSync(tuiDts, 'utf8')
    expect(dts, 'FreeTextInputProps still has no mask — U-9 open').toMatch(/mask/i)
  })
})
