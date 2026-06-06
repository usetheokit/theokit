/**
 * T1.3 — `theokit check --upgrade-readiness 0.3` post-success migration URL.
 *
 * Per blueprint R4 + Next.js `bin/upgrade.ts:65` precedent, the scanner
 * emits a friendly migration-guide URL on its success-path output. Anchor
 * canonical = `#rollback` (existing in `docs/migration/0.2-to-0.3.md`,
 * preserved by T1.1 — do NOT use `#rollback--opt-out` per EC-2).
 *
 * Insertion point: after the existing
 * `console.log('  ✓ Upgrade-readiness 0.3: no violations detected.')`
 * at upgrade-readiness.ts:375.
 *
 * Also emits the URL on the violations branch (with the same anchor) so
 * users have one canonical link to follow regardless of scanner verdict.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'

import { upgradeReadinessCommand } from '../../packages/theo/src/cli/commands/upgrade-readiness.js'

const CLEAN_FIXTURE = resolve(__dirname, '../../fixtures/upgrade-readiness-clean')
const DIRTY_FIXTURE = resolve(__dirname, '../../fixtures/upgrade-readiness-dirty')

const MIGRATION_URL = 'https://theokit.dev/migration/0.2-to-0.3'

describe('T1.3 — upgrade-readiness scanner emits migration-guide URL', () => {
  // Loose any-typed spies — exact signature of vi.spyOn(process, 'exit') is
  // intractable to match (mock returns never, callable expects unknown args).
  let logSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never) as ReturnType<typeof vi.spyOn>
  })

  afterEach(() => {
    logSpy.mockRestore()
    exitSpy.mockRestore()
    cwdSpy?.mockRestore()
  })

  function capturedStdout(): string {
    return logSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
  }

  it('on success path (clean fixture), prints the migration-guide URL', async () => {
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(CLEAN_FIXTURE)
    await upgradeReadinessCommand({})
    const out = capturedStdout()
    expect(out).toMatch(/no violations detected/)
    expect(out).toContain(MIGRATION_URL)
  })

  it('on success path, suggests the rollback anchor (#rollback, not #rollback--opt-out)', async () => {
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(CLEAN_FIXTURE)
    await upgradeReadinessCommand({})
    const out = capturedStdout()
    expect(out).toMatch(/#rollback\b/)
    expect(out).not.toMatch(/#rollback--opt-out/)
  })

  it('on violations path (dirty fixture), still prints the migration-guide URL', async () => {
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(DIRTY_FIXTURE)
    await upgradeReadinessCommand({})
    const out = capturedStdout()
    expect(out).toMatch(/violation\(s\)/)
    expect(out).toContain(MIGRATION_URL)
  })

  it('--json mode prints the JSON payload first (URL would terminate via process.exit in real CLI)', async () => {
    // NOTE: with process.exit mocked to no-op, control flows past the json
    // branch into the human-readable branches — so URL DOES appear in
    // capturedStdout under test. In real CLI use, process.exit(report.exitCode)
    // terminates the process immediately after the JSON payload is printed,
    // so the URL never reaches stdout. This test asserts the structural
    // contract: JSON payload IS printed, and it's the FIRST output.
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(CLEAN_FIXTURE)
    await upgradeReadinessCommand({ json: true })
    const firstCall = logSpy.mock.calls[0]?.[0]
    expect(firstCall).toMatch(/^{/)
    expect(firstCall).toMatch(/"status":/)
  })
})
