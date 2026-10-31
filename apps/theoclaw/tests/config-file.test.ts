import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { configurationPath, loadConfiguration } from '../src/config-file.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'

const scratch: string[] = []

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-config-'))
  scratch.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the configuration file', () => {
  it('the configuration path follows THEOCLAW_CONFIG, XDG_CONFIG_HOME and the profile', () => {
    const home = '/home/someone'

    expect(configurationPath({}, home)).toBe('/home/someone/.config/theoclaw/theoclaw.env')
    expect(configurationPath({ XDG_CONFIG_HOME: '/xdg' }, home)).toBe('/xdg/theoclaw/theoclaw.env')
    expect(configurationPath({ THEOCLAW_PROFILE: 'work' }, home)).toBe('/home/someone/.config/theoclaw/theoclaw-work.env')
    expect(configurationPath({ THEOCLAW_CONFIG: '/etc/tc.env', XDG_CONFIG_HOME: '/xdg' }, home)).toBe('/etc/tc.env')
    expect(configurationPath({ THEOCLAW_CONFIG: '   ', XDG_CONFIG_HOME: '/xdg' }, home)).toBe('/xdg/theoclaw/theoclaw.env')
  })

  it('a missing default file is no error and a missing THEOCLAW_CONFIG file is refused by name', () => {
    const home = scratchDir()
    const env: NodeJS.ProcessEnv = {}

    expect(loadConfiguration(env, home)).toBeUndefined()
    expect(env).toEqual({})

    const missing = join(home, 'absent.env')
    const named: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: missing }
    expect(() => loadConfiguration(named, home)).toThrow(TheoClawConfigError)
    expect(() => loadConfiguration(named, home)).toThrow(`THEOCLAW_CONFIG: ${missing} does not exist`)
  })

  it('an unreadable configuration file is refused naming the path and the code, never a value', () => {
    const home = scratchDir()
    const path = join(home, 'a-directory.env')
    mkdirSync(path)

    expect(() => loadConfiguration({ THEOCLAW_CONFIG: path }, home)).toThrow(`cannot read ${path}: EISDIR`)
  })

  it('the configuration file is loaded into the env object it is given', () => {
    const home = scratchDir()
    mkdirSync(join(home, '.config', 'theoclaw'), { recursive: true })
    const path = join(home, '.config', 'theoclaw', 'theoclaw.env')
    writeFileSync(path, 'THEOCLAW_MODEL="file-model"\nTHEOCLAW_PORT="9000"\n')
    const env: NodeJS.ProcessEnv = { THEOCLAW_PORT: '8787' }

    expect(loadConfiguration(env, home)).toBe(path)
    expect(env).toEqual({ THEOCLAW_MODEL: 'file-model', THEOCLAW_PORT: '8787' })
  })
})
