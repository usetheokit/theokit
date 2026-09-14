/**
 * B-066 — the environment variables this runtime reads are a CLOSED list, gated both ways.
 *
 * `rules/foreign-config-surfaces.md` settles this for `.claude/` FILE surfaces in one sentence —
 * *a surface is read, or it is refused with a reason about this product; it is never accepted and
 * ignored*. Environment variables are the largest surface that rule does not cover: an operator
 * exports one, nothing happens, and they cannot tell "this runtime does not read it" from "it read
 * it and my value was wrong".
 *
 * The deliverable is a CLOSED list — absent from it means not read — which answers for EVERY
 * variable, including the ones nobody enumerated, while naming nothing foreign. That framing is the
 * reviewer's decision on 2026-09-14 (*"não quero referências no nosso sistema"*), and it is the
 * correct call twice over: `rules/reference-provenance.md` keeps third-party material out of this
 * repository, and `cycle-backlog.md` gate G5 refuses a foreign product's behaviour as our
 * justification.
 *
 * ## Why the scanner resolves a same-file constant
 *
 * Measured 2026-09-14 — three variables are read, not two:
 *
 *   PROGRAMDATA              config/operator-policy.ts:119    process.env.PROGRAMDATA
 *   THEOKIT_DEBUG            debug-log.ts:10                  process.env.THEOKIT_DEBUG
 *   THEOKIT_CODEX_CLIENT_ID  auth/device-provider.ts:97       process.env[CODEX_CLIENT_ID_ENV_VAR]
 *
 * The third is invisible to a literal-only scan. Controls in both directions: grepping for it as a
 * literal `process.env` read returns 0, and the constant at `device-provider.ts:93` is literally
 * `= 'THEOKIT_CODEX_CLIENT_ID'`. A gate matching only `process.env.X` would approve a list that
 * omits it — producing the exact lie FR-005 exists to prevent, from inside the gate meant to
 * prevent it.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  scanEnvReads,
  compareAgainstList,
  readDeclaredList,
} from '../../scripts/env-verdicts-lib.mjs'

function sourceTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'b066-src-'))
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body)
  }
  return root
}

describe('the scanner sees every shape this repository actually writes', () => {
  it('test_a_literal_read_is_found', () => {
    const root = sourceTree({ 'a.ts': 'const x = process.env.FOO\n' })
    expect(scanEnvReads(root).names).toContain('FOO')
  })

  it('test_a_bracket_literal_read_is_found', () => {
    const root = sourceTree({ 'a.ts': "const x = process.env['BAR']\n" })
    expect(scanEnvReads(root).names).toContain('BAR')
  })

  it('test_a_same_file_constant_read_is_resolved', () => {
    // The THEOKIT_CODEX_CLIENT_ID shape. A literal-only scanner returns [] here and the whole
    // closed list becomes a lie that the gate itself signed off on.
    const root = sourceTree({
      'a.ts': "export const K = 'BAZ'\nconst v = process.env[K] ?? 'default'\n",
    })
    expect(scanEnvReads(root).names).toContain('BAZ')
  })

  it('test_an_unresolvable_dynamic_read_fails_naming_the_line', () => {
    // ADR-2: narrow resolution plus silent skip is how a gate rots. The next `process.env[cfg.key]`
    // would pass unnoticed and the list would quietly stop being closed.
    const root = sourceTree({ 'a.ts': 'const v = process.env[cfg.key]\n' })
    const result = scanEnvReads(root)
    expect(result.unresolved).toHaveLength(1)
    expect(result.unresolved[0]).toContain('a.ts:1')
  })

  it('test_an_unreadable_source_file_raises_rather_than_reporting_zero', () => {
    const root = sourceTree({ 'a.ts': 'process.env.FOO\n' })
    chmodSync(join(root, 'a.ts'), 0o000)
    // Reporting "0 reads found" for a file nobody could open is the silent-failure shape
    // `rules/error-handling.md` § 2 refuses: it is indistinguishable from a clean tree.
    expect(() => scanEnvReads(root)).toThrow(/a\.ts/)
    chmodSync(join(root, 'a.ts'), 0o644)
  })
})

describe('the gate fails in BOTH directions', () => {
  it('test_read_but_undeclared_fails', () => {
    const verdict = compareAgainstList(['FOO', 'INVENTED_ONE'], ['FOO'])
    expect(verdict.ok).toBe(false)
    expect(verdict.readButUndeclared).toEqual(['INVENTED_ONE'])
  })

  it('test_declared_but_no_longer_read_fails', () => {
    // The direction a one-way gate misses: a refactor deletes the only read and the README keeps
    // advertising a variable nothing consults.
    const verdict = compareAgainstList(['FOO'], ['FOO', 'GONE'])
    expect(verdict.ok).toBe(false)
    expect(verdict.declaredButUnread).toEqual(['GONE'])
  })

  it('test_agreement_passes', () => {
    expect(compareAgainstList(['FOO', 'BAR'], ['BAR', 'FOO']).ok).toBe(true)
  })
})

describe('an absent list is not an empty list', () => {
  it('test_an_absent_section_is_not_an_empty_list', () => {
    const root = mkdtempSync(join(tmpdir(), 'b066-readme-'))
    const readme = join(root, 'README.md')
    writeFileSync(readme, '# a readme with no environment section\n')
    // If absence collapsed into "0 declared", deleting the whole section would be the cheapest way
    // to pass the gate.
    expect(() => readDeclaredList(readme)).toThrow(/section/i)
  })
})

describe('the list reaches the consumer, not just the repository', () => {
  // 30s, not the 5s default: `npm pack --dry-run` reads the whole package tree, and measured
  // 2026-09-14 it took 10 698 ms under parallel suite load against 1 100 ms when this file runs
  // alone. A test that passes alone and times out in the suite is a flaky test, and
  // `rules/testing.md` § 3 calls a flaky test a bug rather than an inconvenience.
  it('test_the_list_reaches_the_packed_tarball', { timeout: 30_000 }, (ctx) => {
    // AC-003 says "in the PUBLISHED tarball, not only in the repository". A README present in git
    // and absent from the tarball satisfies FR-003 not at all, and `files` in package.json is
    // exactly the kind of thing that silently stops including something.
    //
    // `ctx.skip()` and never a bare return: a bare return reports the test as PASSED, so a run
    // without npm would say the published surface was checked when nothing was. `bundle-size.test.ts`
    // carries a comment recording that exact defect in this repository.
    let packed: string
    try {
      // `npm` is resolved from PATH on purpose. This test runs on a developer's machine or a CI
      // runner, where the toolchain that installed the dependencies came from that same PATH:
      // pinning an absolute path adds no guarantee — a hijacked PATH here means the whole build is
      // already compromised, not this one call — and it would break every machine whose npm lives
      // somewhere else.
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- see the paragraph above
      packed = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        cwd: resolve(import.meta.dirname, '../..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      ctx.skip()
      return
    }

    const files: string[] = JSON.parse(packed)[0].files.map((f: { path: string }) => f.path)
    expect(files).toContain('README.md')

    const readme = readFileSync(resolve(import.meta.dirname, '../../README.md'), 'utf8')
    expect(readme).toContain('THEOKIT_DEBUG')
    expect(readme).toContain('This list is CLOSED')
  })

  it('test_every_declared_variable_is_actually_read_by_this_package', () => {
    // The gate's own subject, asserted from the suite so a green CI job is not the only witness.
    const src = resolve(import.meta.dirname, '../../src')
    const readme = resolve(import.meta.dirname, '../../README.md')
    const verdict = compareAgainstList(scanEnvReads(src).names, readDeclaredList(readme))
    expect(verdict.readButUndeclared).toEqual([])
    expect(verdict.declaredButUnread).toEqual([])
  })

  it('test_the_security_column_carries_a_per_entry_decision', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../../README.md'), 'utf8')
    // FR-004: a decision per row. THEOKIT_CODEX_CLIENT_ID selects which OAuth client the device
    // authorisation is issued against — a credential-path decision — while THEOKIT_DEBUG is not,
    // and no keyword rule produces that split from the names alone.
    expect(readme).toMatch(/\|\s*`THEOKIT_CODEX_CLIENT_ID`\s*\|\s*\*\*yes\*\*\s*\|/)
    expect(readme).toMatch(/\|\s*`THEOKIT_DEBUG`\s*\|\s*no\s*\|/)
  })
})
