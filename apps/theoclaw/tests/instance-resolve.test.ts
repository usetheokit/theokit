import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { getProfilesRoot } from '@theokit/sdk/internal/persistence'
import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { resolveInstance } from '../src/instance.js'

const HOME = '/h'

function refusal(env: Record<string, string>): TheoClawConfigError {
  try {
    resolveInstance(env, { homeDir: HOME })
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error(`resolveInstance accepted ${JSON.stringify(env)}`)
}

/** FR-001 to FR-004 (B-514): which instance THEOCLAW_PROFILE names, and what it refuses. */
describe('resolveInstance', () => {
  const savedHome = process.env.HOME
  let scratch = ''

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME
    else process.env.HOME = savedHome
    if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
    scratch = ''
  })

  it('an unset profile is the instance theoclaw with no overrides', () => {
    for (const env of [{}, { THEOCLAW_PROFILE: '' }, { THEOCLAW_PROFILE: '  ' }]) {
      expect(resolveInstance(env, { homeDir: HOME })).toEqual({ label: 'theoclaw', overrides: {} })
    }
  })

  it('a profile selects its directory, workspace, state directory, overrides and label', () => {
    const directory = '/h/.theokit/profiles/a'
    expect(resolveInstance({ THEOCLAW_PROFILE: 'a' }, { homeDir: HOME })).toEqual({
      label: 'theoclaw-a',
      profile: 'a',
      directory,
      workspace: `${directory}/workspace`,
      stateDirectory: `${directory}/state`,
      overrides: { THEOKIT_HOME: directory, THEOKIT_AUTH_HOME: directory, THEOCLAW_STATE_DIR: `${directory}/state` },
    })
  })

  it('the profile directory sits under the SDK profiles root', () => {
    scratch = mkdtempSync(join(tmpdir(), 'theoclaw-resolve-'))
    process.env.HOME = scratch
    const instance = resolveInstance({ THEOCLAW_PROFILE: 'work' }, { homeDir: scratch })
    expect(dirname(instance.directory ?? '')).toBe(getProfilesRoot())
  })

  it('refuses a profile name outside the pattern without printing it', () => {
    for (const name of ['../x', '/abs', 'A', 'a_b', '-a', 'a'.repeat(17)]) {
      const error = refusal({ THEOCLAW_PROFILE: name })
      expect(error.message).toBe('THEOCLAW_PROFILE must match ^[a-z0-9][a-z0-9-]{0,15}$')
      expect(error.variable).toBe('THEOCLAW_PROFILE')
    }
    expect(resolveInstance({ THEOCLAW_PROFILE: 'a'.repeat(16) }, { homeDir: HOME }).label).toBe(`theoclaw-${'a'.repeat(16)}`)
  })

  it('refuses a profile combined with THEOKIT_HOME, THEOKIT_AUTH_HOME or THEOCLAW_STATE_DIR', () => {
    for (const variable of ['THEOKIT_HOME', 'THEOKIT_AUTH_HOME', 'THEOCLAW_STATE_DIR']) {
      const error = refusal({ THEOCLAW_PROFILE: 'a', [variable]: '/secret-path' })
      expect(error.message).toBe(`THEOCLAW_PROFILE cannot be combined with ${variable}: unset them or the profile`)
      expect(error.message).not.toContain('/secret-path')
    }
    const both = refusal({ THEOCLAW_PROFILE: 'a', THEOKIT_HOME: '/x', THEOCLAW_STATE_DIR: '/y' })
    expect(both.message).toBe('THEOCLAW_PROFILE cannot be combined with THEOKIT_HOME, THEOCLAW_STATE_DIR: unset them or the profile')
  })

  it('reports the name before a conflict', () => {
    expect(refusal({ THEOCLAW_PROFILE: '../x', THEOKIT_HOME: '/x' }).message).toContain('must match')
  })

  it('resolves a padded profile name to its trimmed form', () => {
    expect(resolveInstance({ THEOCLAW_PROFILE: '  a  ' }, { homeDir: HOME }).label).toBe('theoclaw-a')
    expect(resolveInstance({ THEOCLAW_PROFILE: '0' }, { homeDir: HOME }).label).toBe('theoclaw-0')
  })

  it('a blank home variable beside a profile is no conflict', () => {
    expect(resolveInstance({ THEOCLAW_PROFILE: 'a', THEOKIT_HOME: ' ' }, { homeDir: HOME }).label).toBe('theoclaw-a')
  })
})
