import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { diagnose, renderDiagnosis, secretPresence, type Check } from '../../src/doctor/diagnose.js'

/**
 * M84 — the doctor primitive.
 *
 * ## The absence it closes
 *
 * There was no resolved-state report. `theokit info` answers "does my project parse?"; the question
 * an agent product has is different — **what will this installation actually do?** Which credential,
 * which layers, which trust posture, which sandbox, which MCP servers, which skills, which hooks.
 *
 * ## The hard rule
 *
 * A doctor that prints secrets is a doctor nobody can paste into an issue — which means the one
 * command built for support is the one command you must not share. So a credential is reported as
 * PRESENT, ABSENT or UNREADABLE, and never as a value: not the value, not a prefix, not a
 * truncation. A truncated key is still a key with its most identifying bytes intact, and "sk-ant-…"
 * in a public issue names the account.
 *
 * The LIST of checks stays the product's — only the mechanism is here (the quartet, ~44 LOC).
 */

const ok = (name: string): Check => ({ name, status: 'ok', detail: 'fine' })
const fail = (name: string): Check => ({ name, status: 'fail', detail: 'broken' })
const warn = (name: string): Check => ({ name, status: 'warn', detail: 'suspicious' })

describe('diagnose aggregates checks into a verdict', () => {
  it('test_all_ok_reports_nothing_failed', () => {
    const diagnosis = diagnose([ok('credential'), ok('mcp')])
    expect(diagnosis.failed).toBe(0)
    expect(diagnosis.checks).toHaveLength(2)
  })

  it('test_a_failing_check_is_counted', () => {
    expect(diagnose([ok('a'), fail('b'), fail('c')]).failed).toBe(2)
  })

  it('test_a_WARNING_is_not_a_failure', () => {
    // The distinction that keeps the exit code meaningful: "no MCP servers configured" is worth
    // saying and is not broken. Counting it as failure makes a green install exit non-zero, and CI
    // learns to ignore the command.
    expect(diagnose([warn('mcp')]).failed).toBe(0)
  })

  it('test_an_empty_diagnosis_is_not_a_pass_by_default', () => {
    // Anti-vacuity, and it is not theoretical: a product whose check list failed to load would
    // otherwise report a clean bill of health for an installation nobody examined.
    const diagnosis = diagnose([])
    expect(diagnosis.checks).toEqual([])
    expect(diagnosis.exitCode, 'no checks ran — that is not the same as everything passing').toBe(1)
  })
})

describe('the exit code is a contract', () => {
  it('test_a_clean_diagnosis_exits_zero', () => {
    expect(diagnose([ok('a')]).exitCode).toBe(0)
  })

  it('test_any_failure_exits_non_zero', () => {
    // So `theokit doctor && deploy` means what it reads like.
    expect(diagnose([ok('a'), fail('b')]).exitCode).not.toBe(0)
  })

  it('test_warnings_alone_exit_zero', () => {
    expect(diagnose([warn('a')]).exitCode).toBe(0)
  })
})

describe('renderDiagnosis is readable and pasteable', () => {
  it('test_every_check_appears_with_its_name_and_detail', () => {
    const text = renderDiagnosis(diagnose([ok('credential'), fail('sandbox')]))
    expect(text).toContain('credential')
    expect(text).toContain('sandbox')
    expect(text).toContain('broken')
  })

  it('test_the_summary_states_how_many_failed', () => {
    expect(renderDiagnosis(diagnose([ok('a'), fail('b')]))).toMatch(/1 .*fail/i)
  })
})

describe('secretPresence — the hard rule, in one function', () => {
  it('test_a_present_secret_reports_PRESENT_and_never_its_value', () => {
    const detail = secretPresence('sk-ant-api03-VERYSECRETVALUE')
    expect(detail).toBe('present')
    expect(detail).not.toContain('sk-')
    expect(detail).not.toContain('VERYSECRET')
  })

  it('test_not_even_a_PREFIX_is_reported', () => {
    // The near-miss that looks harmless and is not: a truncated key keeps its most identifying
    // bytes, and `sk-ant-…` in a public issue names the account it belongs to.
    const detail = secretPresence('sk-ant-api03-VERYSECRETVALUE')
    expect(detail).not.toMatch(/sk-ant/)
    expect(detail).not.toMatch(/\.\.\./)
    expect(detail).not.toMatch(/…/)
  })

  it('test_an_absent_secret_reports_ABSENT', () => {
    expect(secretPresence(undefined)).toBe('absent')
  })

  it('test_an_EMPTY_value_is_absent_not_present', () => {
    // `OPENAI_API_KEY=` is how a key gets unset in practice. Reporting it present sends an operator
    // hunting for a network fault behind a 401.
    expect(secretPresence('')).toBe('absent')
  })

  it('test_an_unreadable_secret_is_its_own_state', () => {
    // A file that exists but cannot be read is neither present nor absent, and collapsing it into
    // either sends the operator to the wrong fix — provisioning a key they already have, or
    // debugging permissions they do not have a problem with.
    expect(secretPresence(new Error('EACCES'))).toBe('unreadable')
  })

  it('test_the_length_is_not_reported_either', () => {
    // A length narrows a brute force and identifies the provider. Free to leak, and never useful in
    // a bug report.
    expect(secretPresence('sk-1234567890')).not.toMatch(/\d/)
  })
})

describe('installDiagnosticSink — the seam ships with its only use', () => {
  it('test_an_absent_env_var_leaves_diagnostics_off', async () => {
    const { installDiagnosticSink } = await import('../../src/doctor/diagnostic-sink.js')
    expect(installDiagnosticSink({ env: {} })).toEqual({ kind: 'off' })
  })

  it('test_a_truthy_value_routes_to_STDERR_and_not_stdout', async () => {
    // stdout carries the agent's answer. A diagnostic interleaved with it corrupts the output for
    // anything reading — which is every script that pipes `theokit agent`.
    const { installDiagnosticSink } = await import('../../src/doctor/diagnostic-sink.js')
    expect(installDiagnosticSink({ env: { THEOKIT_DIAGNOSTICS: '1' } })).toEqual({ kind: 'stderr' })
  })

  it('test_any_other_value_is_treated_as_a_file_path', async () => {
    const { installDiagnosticSink } = await import('../../src/doctor/diagnostic-sink.js')
    expect(installDiagnosticSink({ env: { THEOKIT_DIAGNOSTICS: '/tmp/theo.log' } })).toEqual({
      kind: 'file',
      path: '/tmp/theo.log',
    })
  })

  it('test_an_unwritable_path_WARNS_instead_of_taking_down_the_run', async () => {
    // Turning on debugging must not be what breaks the thing you were debugging.
    //
    // The first version of this test asserted the warning list was EMPTY — true only because
    // nothing had ever called the sink, and it would have passed against a sink that swallowed
    // every failure. Capturing the installed sink and DRIVING it is what makes the assertion real.
    const { installDiagnosticSink } = await import('../../src/doctor/diagnostic-sink.js')
    const warnings: string[] = []
    let installed: ((message: string) => void) | undefined

    installDiagnosticSink({
      env: { THEOKIT_DIAGNOSTICS: '/definitely/not/writable/theo.log' },
      onWarn: (m) => warnings.push(m),
      install: (sink) => {
        installed = sink
      },
    })

    expect(installed, 'a file destination must install a sink').toBeTypeOf('function')
    expect(() => installed?.('a diagnostic')).not.toThrow()
    expect(warnings[0]).toMatch(/could not be written/)
  })

  it('test_a_WRITABLE_path_does_not_warn', async () => {
    // The counter-proof. Without it, a sink that warned unconditionally would satisfy the test
    // above while reporting a failure on every successful write.
    const { installDiagnosticSink } = await import('../../src/doctor/diagnostic-sink.js')
    const warnings: string[] = []
    let installed: ((message: string) => void) | undefined
    const path = join(mkdtempSync(join(tmpdir(), 'diag-')), 'theo.log')

    installDiagnosticSink({
      env: { THEOKIT_DIAGNOSTICS: path },
      onWarn: (m) => warnings.push(m),
      install: (sink) => {
        installed = sink
      },
    })
    installed?.('a diagnostic')

    expect(warnings).toEqual([])
    expect(readFileSync(path, 'utf8')).toContain('a diagnostic')
  })
})
