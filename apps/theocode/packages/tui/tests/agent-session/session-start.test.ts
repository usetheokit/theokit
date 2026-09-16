/**
 * #57 — a malformed `settings.json` must not take the terminal down.
 *
 * `fireSessionStart` says "Never throws and never blocks the frame", and both TUI call sites in
 * `composition-root.ts` trust that with a bare `void`. Two statements run BEFORE the `onWarn` that
 * `runSessionStartHooks` catches into: `resolveTrustPosture` and `resolveEffectiveConfig`, and the
 * second throws `ConfigError` on a malformed file. Because the function is `async`, that becomes a
 * rejection with no handler at all, and the declared engine is `node >=22`, where the default is
 * `--unhandled-rejections=throw`.
 *
 * The path is reachable AFTER startup: `/new` re-reads the config at that moment, so an operator
 * who edits `.theocode/settings.json` mid-session and types `/new` loses the terminal to
 * ERR_UNHANDLED_REJECTION instead of getting a diagnostic. The guarantee therefore belongs to the
 * exported function, per the B-031 precedent in `persistence/session-store.ts`: there is no longer
 * a call site that CAN get it wrong.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fireSessionStart } from '../../src/agent-session/session-start.js'

let cwd: string
let home: string
let previousHome: string | undefined

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-tui-ss-'))
  home = mkdtempSync(join(tmpdir(), 'theocode-tui-ss-home-'))
  previousHome = process.env['HOME']
  process.env['HOME'] = home
  process.env['THEOCODE_TRUST_ALL_DIRS'] = '1'
  mkdirSync(join(cwd, '.theocode'), { recursive: true })
})

afterEach(() => {
  if (previousHome === undefined) delete process.env['HOME']
  else process.env['HOME'] = previousHome
  delete process.env['THEOCODE_TRUST_ALL_DIRS']
  rmSync(cwd, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

describe('#57 — the session-start seam degrades instead of crashing', () => {
  it('test_a_malformed_settings_json_is_reported_and_does_not_reject', async () => {
    writeFileSync(join(cwd, '.theocode', 'settings.json'), '{ "hooks": ')
    const reports: string[] = []

    await expect(
      fireSessionStart('tui-1', cwd, (m) => reports.push(m)),
      'the config read rejected, and a bare `void` caller would crash the TUI',
    ).resolves.toBeUndefined()

    expect(reports.join(' '), 'the failure was swallowed with no diagnostic').toMatch(
      /malformed JSON/,
    )
  })

  it('test_a_readable_config_with_no_hooks_reports_nothing', async () => {
    // Anti-vacuity floor: reporting unconditionally would satisfy the assertion above.
    writeFileSync(join(cwd, '.theocode', 'settings.json'), JSON.stringify({ model: 'openai/x' }))
    const reports: string[] = []

    await fireSessionStart('tui-2', cwd, (m) => reports.push(m))

    expect(reports).toEqual([])
  })
})
