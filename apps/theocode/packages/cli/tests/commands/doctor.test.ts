/**
 * `credentialState` answers "is the stored credential usable?", and it used to answer "does the
 * file parse?".
 *
 * Measured 2026-08-25: an OAuth credential whose `expires` had passed ten days earlier produced
 * `✓ credential: present`. A diagnostic whose whole job is to say whether the product is ready to
 * run reported a green tick on the one thing that was going to fail first.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Scratch roots, removed when the file finishes.
 *
 * MEASURED 2026-09-03: /tmp held 2 773 leaked `theocode-*` directories from suites that create one
 * per case and never remove it. Sixteen other test files here already clean up, so this follows the
 * convention rather than inventing one, and the cost of skipping it is paid once per test on every
 * machine that ever runs the suite.
 */
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

import { parseExecArgs } from '../../src/runtime/args.js'
import {
  credentialState,
  doctorCommand,
  resolveDoctorTarget,
  runtimeCredentialState,
} from '../../src/commands/doctor.js'

const NOW = 1_700_000_000_000

function credentialFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'theocode-doctor-'))
  roots.push(dir)
  const path = join(dir, 'auth.json')
  writeFileSync(path, contents)
  return path
}

describe('credentialState', () => {
  it('test_a_missing_file_is_absent', () => {
    expect(credentialState(join(tmpdir(), 'theocode-does-not-exist', 'auth.json'), NOW)).toBe(
      'absent',
    )
  })

  it('test_a_file_that_does_not_parse_is_unreadable', () => {
    expect(credentialState(credentialFile('{ not json'), NOW)).toBe('unreadable')
  })

  it('test_a_credential_with_no_expiry_is_present', () => {
    // An API key has no expiry at all. Treating a missing field as expired would warn every key
    // user about a problem they cannot have.
    expect(credentialState(credentialFile('{"type":"api","provider":"openai"}'), NOW)).toBe(
      'present',
    )
  })

  // The three fixtures below gained `provider` when #823 landed. They describe credentials, and a
  // credential carries that field in both of the forms this product declares — `StoredOAuthCredential`
  // and the `{"provider": ..., "api_key": ...}` the no-credential message tells the operator to write.
  // Without it they were objects that merely happened to parse, which is exactly what `unreadable`
  // now catches. The properties they protect are unchanged; the fixtures are what got closer to real.
  it('test_a_credential_whose_expiry_has_passed_is_expired', () => {
    const path = credentialFile(`{"type":"oauth","provider":"openai","expires":${NOW - 1}}`)

    expect(credentialState(path, NOW), 'an expired token still reported as present').toBe('expired')
  })

  it('test_a_credential_that_expires_in_the_future_is_present', () => {
    expect(
      credentialState(
        credentialFile(`{"type":"oauth","provider":"openai","expires":${NOW + 60_000}}`),
        NOW,
      ),
    ).toBe('present')
  })

  it('test_valid_json_that_is_not_a_credential_is_unreadable', () => {
    // #823 — the file parsed, so it was called `present`, while the TUI showed `none` for the same
    // file at the same moment. Two surfaces of one product disagreeing about one fact, and `doctor`
    // is the one an operator opens when a session will not authenticate.
    //
    // Measured 2026-09-17 with a decoy left behind after an unrelated run. `unreadable` already
    // existed and already says "exists and could not be parsed" — nothing here is a new state, only
    // a state that was never produced.
    expect(credentialState(credentialFile('{"not":"a-credential"}'), NOW)).toBe('unreadable')
  })

  it('test_an_empty_object_is_unreadable', () => {
    // The boundary: `{}` parses and carries nothing. Reporting it present is the same claim as above
    // with less to argue about.
    expect(credentialState(credentialFile('{}'), NOW)).toBe('unreadable')
  })

  it('test_a_json_array_is_unreadable', () => {
    // `JSON.parse` accepts arrays, and `(parsed as {expires?}).expires` on one is `undefined` —
    // which read as "no expiry, therefore present".
    expect(credentialState(credentialFile('["not","a","credential"]'), NOW)).toBe('unreadable')
  })

  it('test_a_non_numeric_expiry_is_not_read_as_expired', () => {
    // A string date would be `<= now` under no comparison that means anything. Refusing to guess
    // is the difference between a diagnostic and a rumour.
    expect(
      credentialState(credentialFile('{"provider":"openai","expires":"2020-01-01"}'), NOW),
    ).toBe('present')
  })
})

describe('runtimeCredentialState', () => {
  // #938 — `doctor` read only the stored file, so with `OPENROUTER_API_KEY` exported and no file it
  // printed `✗ credential: absent` and exited 1, while a turn in the same shell authenticated from
  // that variable and spent tokens. The row has to describe the credential a turn will use.
  const absentFile = (): string =>
    join(mkdtempSync(join(tmpdir(), 'theocode-doctor-')), 'auth.json')

  it('test_a_provider_key_in_the_environment_is_present_without_a_file', () => {
    const path = absentFile()
    roots.push(join(path, '..'))

    const state = runtimeCredentialState(
      path,
      { OPENROUTER_API_KEY: 'sk-or-v1-' + 'x'.repeat(32) },
      NOW,
    )

    expect(state).toBe('present')
  })

  it('test_no_key_and_no_file_is_still_absent', () => {
    const path = absentFile()
    roots.push(join(path, '..'))

    expect(runtimeCredentialState(path, {}, NOW)).toBe('absent')
  })

  it('test_an_expired_file_is_reported_when_the_environment_has_no_key', () => {
    const path = credentialFile('{"provider":"openai","expires":1}')

    expect(runtimeCredentialState(path, {}, NOW)).toBe('expired')
  })
})

describe('#1895 — doctor honours -c/--sandbox and applies -C once', () => {
  it('test_sandbox_override_beats_the_user_file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'theocode-doctor-home-'))
    roots.push(home)
    mkdirSync(join(home, '.theocode'))
    writeFileSync(join(home, '.theocode', 'settings.json'), '{"sandbox_mode":"workspace-write"}')
    const base = { userDir: home, env: { HOME: home } }

    expect((await resolveDoctorTarget(base)).cfg.sandbox_mode).toBe('workspace-write')

    const args = parseExecArgs(['doctor', '--sandbox', 'read-only'], false)
    if (args.mode !== 'doctor') throw new Error('expected doctor')
    expect((await resolveDoctorTarget({ ...base, ...args })).cfg.sandbox_mode).toBe('read-only')
  })

  it('test_a_relative_cd_is_inspected_once', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'theocode-doctor-cd-'))
    roots.push(parent)
    mkdirSync(join(parent, 'sub'))
    const before = process.cwd()
    try {
      // What main.ts does for `-C sub` before dispatching the command.
      process.chdir(parent)
      const args = parseExecArgs(['doctor', '-C', 'sub'], false)
      if (args.mode !== 'doctor') throw new Error('expected doctor')
      process.chdir(args.cd!)
      const { cwd } = await resolveDoctorTarget(args)
      expect(cwd).toBe(realpathSync(join(parent, 'sub')))
    } finally {
      process.chdir(before)
    }
  })
})

describe('#1894 — doctor reports the wiring buildChatAgent publishes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('@theocode/agent')
    vi.resetModules()
  })

  async function runDoctor(project: string): Promise<{ out: string; code: number | undefined }> {
    const before = process.cwd()
    const home = mkdtempSync(join(tmpdir(), 'theocode-doctor-home-'))
    roots.push(home)
    vi.stubEnv('HOME', home)
    vi.stubEnv('THEOCODE_TRUST_ALL_DIRS', '1')
    let out = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => ((out += String(c)), true))
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    let code: number | undefined
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c
      throw new Error('exit')
    }) as never)
    try {
      process.chdir(project)
      await doctorCommand({ json: true })
    } catch (e) {
      if ((e as Error).message !== 'exit') throw e
    } finally {
      process.chdir(before)
      vi.unstubAllEnvs()
    }
    return { out, code }
  }

  it('test_the_mcp_row_names_a_mcp_json_server', async () => {
    const project = mkdtempSync(join(tmpdir(), 'theocode-doctor-mcp-'))
    roots.push(project)
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { zebra1894: { command: 'node', args: ['-e', ''] } } }),
    )
    const { out } = await runDoctor(project)
    const mcp = JSON.parse(out).checks.find((c: { name: string }) => c.name === 'mcp')
    expect(mcp.detail).toContain('zebra1894')
  })

  it('test_a_build_failure_is_a_failed_check_not_an_unhandled_rejection', async () => {
    const actual = await vi.importActual<typeof import('@theocode/agent')>('@theocode/agent')
    vi.resetModules()
    vi.doMock('@theocode/agent', () => ({
      ...actual,
      buildChatAgent: () => Promise.reject(new Error('boom1894')),
    }))
    const { doctorCommand: doctor } = await import('../../src/commands/doctor.js')
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const project = mkdtempSync(join(tmpdir(), 'theocode-doctor-fail-'))
    roots.push(project)
    const before = process.cwd()
    let out = ''
    let code: number | undefined
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => ((out += String(c)), true))
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c
      throw new Error('exit')
    }) as never)
    try {
      process.chdir(project)
      await doctor({ json: true })
    } catch (e) {
      if ((e as Error).message !== 'exit') throw e
    } finally {
      process.chdir(before)
      await new Promise((r) => setTimeout(r, 10))
      process.off('unhandledRejection', unhandled)
    }
    expect(code).not.toBe(0)
    expect(code).toBeDefined()
    expect(out).toContain('boom1894')
    expect(unhandled).not.toHaveBeenCalled()
  })
})
