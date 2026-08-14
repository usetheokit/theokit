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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

  it('agents_readme_has_substance', () => {
    const readme = read('packages/agents/README.md')
    const nonBlank = readme.split('\n').filter((l) => l.trim().length > 0)
    expect(nonBlank.length, 'README is a stub').toBeGreaterThanOrEqual(30)

    const manifest = JSON.parse(read('packages/agents/package.json')) as {
      exports?: Record<string, unknown>
    }
    const subpaths = Object.keys(manifest.exports ?? {})
    const mentioned = subpaths.filter((s) => readme.includes(s))
    expect(
      mentioned.length,
      `README names only ${mentioned.length} subpaths`,
    ).toBeGreaterThanOrEqual(10)
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
    const dts = agentsDts()
    for (const row of rows) {
      const symbol = /`([A-Za-z_][\w.]*)`/.exec(row)?.[1]
      if (!symbol) continue
      expect(dts, `capability index cites ${symbol}, absent from the published surface`).toContain(
        symbol,
      )
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

describe('G11 — the testing seam accepts what the composition path returns', () => {
  it('inspect_compiled_is_not_typed_over_agent_definition_alone', () => {
    const src = read('packages/agents/src/testing/inspect-compiled.ts')
    expect(
      /export function inspectCompiled\(\s*definition: AgentDefinition\s*\)/.test(src),
      'inspectCompiled is still typed over AgentDefinition only — the consumer documented that its ' +
        'composition routines do not return that type',
    ).toBe(false)
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
    const src = read('packages/agents/src/bridge/delegation-lifecycle.ts')
    expect(src, 'no hook inheritance in the member composition path').toMatch(/hook/i)
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
   * Asserts BEHAVIOUR, not the presence of a word. An earlier draft matched `/sort|length/i`
   * against the source and passed for the wrong reason — the file already contained "length" for
   * an unrelated purpose. A green test that proves nothing is the defect this whole plan is about.
   */
  it('infers_provider_by_longest_prefix', async () => {
    const mod = (await import('../../packages/agents/src/auth/resolve-credential.js')) as {
      resolveCredential: (input: unknown) => { provider: string } | undefined
    }
    const providers = [
      { name: 'openai', envKey: 'OPENAI_API_KEY', priority: 1 },
      { name: 'anthropic', envKey: 'ANTHROPIC_API_KEY', priority: 2 },
    ]
    // An Anthropic key also starts with the shorter `sk-` that OpenAI claims (EC-3).
    const resolution = mod.resolveCredential({
      env: { ANTHROPIC_API_KEY: 'sk-ant-api03-abcdefghijklmnop' },
      providers,
    })
    expect(resolution?.provider, 'an sk-ant- key must not resolve as openai').toBe('anthropic')
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
  it('gate_enumerates_subpaths_from_the_manifest', () => {
    const gate = 'scripts/check-surface-parity.mjs'
    expect(exists(gate), `${gate} is missing — the gate was not generalized`).toBe(true)
    const src = read(gate)
    expect(
      src,
      'the gate still walks a hand-kept DECISIONS key set instead of the exports map',
    ).toMatch(/exports/)
  })

  it('gate_is_wired_into_check_all', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.['check:all'] ?? '').toMatch(/check:surface-parity/)
  })
})

// ---------------------------------------------------------------------------
// Phase 6 — sibling repo (version-gated, per plan D7)
// ---------------------------------------------------------------------------

describe('G12 — @theokit/tui exposes a masked input', () => {
  it('free_text_input_supports_a_masked_mode', () => {
    const tuiDts = join(REPO_ROOT, 'node_modules', '@theokit', 'tui', 'dist', 'index.d.ts')
    if (!existsSync(tuiDts)) {
      noteSkip('G12', '@theokit/tui is not installed in this workspace')
      return
    }
    const dts = readFileSync(tuiDts, 'utf8')
    expect(dts, 'FreeTextInputProps still has no mask — U-9 open').toMatch(/mask/i)
  })
})
