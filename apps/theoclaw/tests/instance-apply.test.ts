import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptRoot } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { applyInstance, resolveInstance } from '../src/instance.js'
import { readSessionSettings } from '../src/sessions/session-settings.js'

const OWNED = ['THEOKIT_HOME', 'THEOKIT_AUTH_HOME', 'THEOCLAW_STATE_DIR', 'HOME'] as const

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

async function applyError(home: string, env: NodeJS.ProcessEnv = {}): Promise<TheoClawConfigError> {
  try {
    await applyInstance(resolveInstance({ THEOCLAW_PROFILE: 'a' }, { homeDir: home }), env)
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('applyInstance did not refuse')
}

/** FR-005, FR-009, NFR-001, NFR-003 (B-514): putting an instance into effect. */
describe('applyInstance', () => {
  let home = ''
  const saved: Partial<Record<(typeof OWNED)[number], string | undefined>> = {}

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'theoclaw-apply-'))
    for (const variable of OWNED) saved[variable] = process.env[variable]
  })

  afterEach(() => {
    for (const variable of OWNED) {
      const value = saved[variable]
      if (value === undefined) delete process.env[variable]
      else process.env[variable] = value
    }
    chmodSync(home, 0o700)
    if (existsSync(join(home, '.theokit'))) chmodSync(join(home, '.theokit'), 0o700)
    rmSync(home, { recursive: true, force: true })
  })

  it('applying a profile leaves its three directories at mode 0700 on a fresh home and over an existing 0755 one', async () => {
    const instance = resolveInstance({ THEOCLAW_PROFILE: 'a' }, { homeDir: home })
    const directories = [instance.directory!, instance.workspace!, instance.stateDirectory!]
    await applyInstance(instance, {})
    for (const directory of directories) expect(mode(directory)).toBe(0o700)

    for (const directory of directories) chmodSync(directory, 0o755)
    await applyInstance(instance, {})
    for (const directory of directories) expect(mode(directory)).toBe(0o700)
  })

  it('a refused profile creates no directory whether or not the profiles root exists', async () => {
    expect(() => resolveInstance({ THEOCLAW_PROFILE: '../x' }, { homeDir: home })).toThrow(
      TheoClawConfigError,
    )
    expect(existsSync(join(home, '.theokit'))).toBe(false)

    const root = join(home, '.theokit', 'profiles')
    mkdirSync(root, { recursive: true })
    const before = readdirSync(root)
    expect(() =>
      resolveInstance({ THEOCLAW_PROFILE: 'a', THEOKIT_HOME: '/x' }, { homeDir: home }),
    ).toThrow(TheoClawConfigError)
    expect(readdirSync(root)).toEqual(before)
  })

  it('applying a profile again keeps what the first run left', async () => {
    const instance = resolveInstance({ THEOCLAW_PROFILE: 'a' }, { homeDir: home })
    await applyInstance(instance, {})
    const file = join(instance.workspace!, 'notes.md')
    writeFileSync(file, 'kept')
    await applyInstance(instance, {})
    expect(readFileSync(file, 'utf8')).toBe('kept')
  })

  it('after applying a profile the SDK resolves its home to the profile directory', async () => {
    process.env.HOME = home
    for (const variable of ['THEOKIT_HOME', 'THEOKIT_AUTH_HOME', 'THEOCLAW_STATE_DIR'])
      delete process.env[variable]
    const instance = resolveInstance(process.env, { homeDir: home })
    expect(instance.label).toBe('theoclaw')
    const profiled = resolveInstance({ ...process.env, THEOCLAW_PROFILE: 'a' }, { homeDir: home })
    await applyInstance(profiled, process.env)
    const dir = profiled.directory!
    // `getTheokitHome` left the public surface with `internal/persistence` (SDK 6): the home-anchored
    // `transcriptRoot` is the public resolver, and it must follow the profile whatever HOME is.
    expect(transcriptRoot()).toBe(dir)
    process.env.HOME = tmpdir()
    expect(transcriptRoot()).toBe(dir)
    expect(process.env.THEOKIT_AUTH_HOME).toBe(dir)
    expect(process.env.THEOCLAW_STATE_DIR).toBe(join(dir, 'state'))
  })

  // F-arch-1: chat transcripts and sessions.json follow the profile, as its other stores do.
  it('two profiles keep their chat sessions in two workspaces, each inside its own profile', async () => {
    const workspaceOf = async (profile: string): Promise<string> => {
      const env: NodeJS.ProcessEnv = { THEOCLAW_PROFILE: profile }
      const instance = resolveInstance(env, { homeDir: home })
      await applyInstance(instance, env)
      const { workspace } = readSessionSettings(env, statSync)
      expect(workspace).toBe(join(instance.directory!, 'workspace'))
      return workspace
    }
    const work = await workspaceOf('work')
    const personal = await workspaceOf('home')

    expect(work).not.toBe(personal)
    expect(mode(work)).toBe(0o700)
  })

  it('applying the no-profile instance changes nothing', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/bin' }
    const envBefore = { ...env }
    await applyInstance(resolveInstance(env, { homeDir: home }), env)
    expect(env).toEqual(envBefore)
    expect(existsSync(join(home, '.theokit'))).toBe(false)
  })

  it('refuses a profile whose directory is a regular file', async () => {
    mkdirSync(join(home, '.theokit', 'profiles'), { recursive: true })
    const path = join(home, '.theokit', 'profiles', 'a')
    writeFileSync(path, 'not a directory')
    const env: NodeJS.ProcessEnv = {}
    const error = await applyError(home, env)
    expect(error.message).toMatch(
      new RegExp(`^THEOCLAW_PROFILE: cannot create ${path}(/\\w+)?: (EEXIST|ENOTDIR)$`),
    )
    expect(env).toEqual({})
  })

  it.skipIf(process.getuid?.() === 0)(
    'refuses an unwritable profiles root, not as root',
    async () => {
      mkdirSync(join(home, '.theokit'))
      chmodSync(join(home, '.theokit'), 0o500)
      const error = await applyError(home)
      expect(error.message).toBe(
        `THEOCLAW_PROFILE: cannot create ${join(home, '.theokit', 'profiles', 'a')}: EACCES`,
      )
      expect(error.variable).toBe('THEOCLAW_PROFILE')
    },
  )
})
