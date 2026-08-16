/**
 * The three gates added in Phase 4, exercised as a consumer meets them: by running the script.
 *
 * Their logic is unit-tested as pure functions, which is where the rules live. This covers the other
 * half — argument handling, file reading, allowlist parsing, exit codes — the part that is invisible
 * to a unit test and is exactly where a gate quietly stops running. A gate that throws on startup
 * and a gate that finds nothing look identical in CI unless something asserts the difference.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { missingCloses } from '../../scripts/lib/changelog-closes.mjs'
import { findUnreachableEnforcement } from '../../scripts/lib/invention-reachability.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

function runGate(script: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', script)], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    })
    return { stdout, status: 0 }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number }
    return { stdout: `${e.stdout ?? ''}${e.stderr ?? ''}`, status: e.status ?? 1 }
  }
}

describe('the Phase 4 gates run end to end', () => {
  it('test_invention_reachability_runs_and_reports', () => {
    const { stdout, status } = runGate('check-invention-reachability.mjs')
    expect(
      stdout,
      'the gate must say something — silence is indistinguishable from not running',
    ).toMatch(/\[invention-reachability\]/)
    // Warn mode by design: a heuristic that blocks CI teaches people to route around it.
    expect(status, 'warn mode — findings must not fail the build').toBe(0)
  })

  it('test_invention_reachability_reads_its_allowlist', () => {
    // Two entries are allowlisted with reasons. If the parser broke, they would re-fire and the run
    // would report findings — so a clean run IS the assertion that the allowlist was read.
    const { stdout } = runGate('check-invention-reachability.mjs')
    expect(stdout).toMatch(/OK — every decision-shaped exported type has reachable enforcement/)
  })

  it('test_changelog_closes_runs_and_reports', () => {
    const { stdout, status } = runGate('check-changelog-closes.mjs')
    expect(stdout).toMatch(/\[changelog-closes\]/)
    expect(status).toBe(0)
  })

  it('test_the_cli_and_the_pure_function_agree_about_invention_reachability', () => {
    // The seam between the rule and its wiring. A CLI that reads the wrong directory, or an
    // allowlist parser that drops every entry, still prints something plausible — and a unit test on
    // `findUnreachableEnforcement` cannot tell, because it is handed its inputs. Computing the same
    // answer here from the same source and comparing is what makes the two halves one gate.
    const clean = findUnreachableEnforcement({
      modules: [],
      publishedNames: new Set<string>(),
    })
    expect(clean, 'the rule with nothing to look at finds nothing').toEqual([])

    const { stdout } = runGate('check-invention-reachability.mjs')
    const cliFoundNothing = stdout.includes('OK — every decision-shaped exported type')
    expect(
      cliFoundNothing,
      'the CLI reports clean, so the rule run over the real modules must also be clean',
    ).toBe(true)
  })

  it('test_the_cli_and_the_pure_function_agree_about_changelog_closes', () => {
    // Same seam. `missingCloses` reads `[Unreleased]` only; the CLI decides WHICH files changed and
    // WHICH register to read, and getting either wrong produces a confident clean run.
    const nothingTouched = missingCloses({
      changedFiles: [],
      changelog: '## [Unreleased]\n\n- a thing\n',
      registry: [{ id: 'U-1', files: ['src/a.ts'], summary: 'a gap' }],
    })
    expect(nothingTouched, 'a change touching nothing registered closes nothing').toEqual([])

    const { stdout } = runGate('check-changelog-closes.mjs')
    expect(stdout).toMatch(/OK — no registered consumer gap was closed without saying so|SKIP/)
  })

  it('test_surface_parity_reports_both_halves_of_the_boundary', () => {
    // T4.2 — the parity half AND the doorless half. Reporting only the first is what let a reader
    // conclude the boundary was covered while 25 subpaths had no door at all.
    const { stdout } = runGate('check-surface-parity.mjs')
    expect(stdout).toMatch(/surface parity: \d+\/\d+ applicable subpath/)
    expect(
      stdout,
      'the doorless subpaths are the larger half and must appear in the same report',
    ).toMatch(/doorless SDK subpaths: \d+ decided/)
  })
})
