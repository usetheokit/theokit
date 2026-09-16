/**
 * #132 — a `SessionStart` hook actually runs, through the seam a surface calls.
 *
 * `session-start.test.ts` proves the runner; this proves something calls it with the real gates
 * attached — the trust posture, the approval store, the config on disk. Without this arm both could
 * pass against a product where nothing fires anything, which is exactly the state this replaces.
 */
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { approveHook, parseHooks } from '@theocode/agent/hooks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fireSessionStart } from '../src/runtime/session-start.js'

let cwd: string
let home: string
let marker: string
let previousHome: string | undefined

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-ss-e2e-'))
  home = mkdtempSync(join(tmpdir(), 'theocode-ss-home-'))
  marker = join(cwd, 'fired.txt')
  previousHome = process.env['HOME']
  process.env['HOME'] = home
  process.env['THEOCODE_TRUST_ALL_DIRS'] = '1'
})
afterEach(() => {
  if (previousHome === undefined) delete process.env['HOME']
  else process.env['HOME'] = previousHome
  delete process.env['THEOCODE_TRUST_ALL_DIRS']
  rmSync(cwd, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

/**
 * The NESTED dialect, because that is the only shape a `settings.json` may carry (#144): the SDK
 * reads this same file and rejects any other. Our loader translates it into the flat internal form,
 * which is what `parseHooks` and the approval store see.
 */
function declare(command: string): { event: string; command: string }[] {
  // `.theocode/`, not `.theokit/`: the SDK reads its own filebase and would run these hooks too,
  // ungated and twice over (#151), so a `hooks` key there is refused.
  mkdirSync(join(cwd, '.theocode'), { recursive: true })
  writeFileSync(
    join(cwd, '.theocode', 'settings.json'),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }),
  )
  return [{ event: 'SessionStart', command }]
}

const lines = (): string[] =>
  existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean) : []

describe('the surface seam', () => {
  it('test_an_approved_hook_runs_and_learns_the_session_id', async () => {
    const hooks = declare(`printenv THEOCODE_SESSION_ID >> ${marker}`)
    for (const spec of parseHooks(hooks)) await approveHook(cwd, spec, home)

    await fireSessionStart('exec-e2e', cwd)

    expect(lines()).toEqual(['exec-e2e'])
  })

  it('test_an_unapproved_hook_does_not_run', async () => {
    // The negative arm that makes the one above mean something: without approval nothing runs, so
    // a green above is the approval flowing through rather than the gate being absent.
    declare(`echo FIRED >> ${marker}`)

    await fireSessionStart('exec-e2e', cwd)

    expect(lines()).toEqual([])
  })

  it('test_no_declared_hook_writes_nothing', async () => {
    mkdirSync(join(cwd, '.theocode'), { recursive: true })
    writeFileSync(join(cwd, '.theocode', 'settings.json'), JSON.stringify({ model: 'openai/x' }))

    await fireSessionStart('exec-e2e', cwd)

    expect(lines()).toEqual([])
  })
})
