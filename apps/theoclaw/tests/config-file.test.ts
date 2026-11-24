import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { configurationPath, loadConfiguration, writeConfiguration } from '../src/config-file.js'
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

  // Audit finding (post-GREEN): THEOCLAW_CONFIG=~/x.env, or /data/theoclaw.env in the image, must
  // not narrow a directory the code did not create.
  it('writing the file leaves an existing directory mode alone and makes a new one 0700', async () => {
    const existing = scratchDir()
    chmodSync(existing, 0o755)
    await writeConfiguration(join(existing, 'theoclaw.env'), { THEOCLAW_MODEL: 'm' }, { force: false })
    expect(statSync(existing).mode & 0o777).toBe(0o755)
    expect(statSync(join(existing, 'theoclaw.env')).mode & 0o777).toBe(0o600)

    const fresh = join(scratchDir(), 'nested', 'theoclaw')
    await writeConfiguration(join(fresh, 'theoclaw.env'), { THEOCLAW_MODEL: 'm' }, { force: false })
    expect(statSync(fresh).mode & 0o777).toBe(0o700)
  })

  it('concurrent writes in one process do not collide and leave no temporary file', async () => {
    const dir = scratchDir()
    const path = join(dir, 'theoclaw.env')
    await Promise.all([1, 2, 3, 4].map((n) => writeConfiguration(path, { THEOCLAW_MODEL: `m${n}` }, { force: true })))
    expect(readFileSync(path, 'utf8')).toMatch(/^THEOCLAW_MODEL="m\d"\n$/)
    expect(readdirSync(dir)).toEqual(['theoclaw.env'])
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('refuses the second of two concurrent writes without force', async () => {
    const path = join(scratchDir(), 'theoclaw.env')
    const results = await Promise.allSettled([
      writeConfiguration(path, { THEOCLAW_MODEL: 'first' }, { force: false }),
      writeConfiguration(path, { THEOCLAW_MODEL: 'second' }, { force: false }),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(readFileSync(path, 'utf8')).toBe('THEOCLAW_MODEL="first"\n')
  })

  it('queues equivalent spellings of one path together', async () => {
    const dir = scratchDir()
    const results = await Promise.allSettled([
      writeConfiguration(join(dir, 'theoclaw.env'), { THEOCLAW_MODEL: 'first' }, { force: false }),
      writeConfiguration(`${dir}/./theoclaw.env`, { THEOCLAW_MODEL: 'second' }, { force: false }),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(readFileSync(join(dir, 'theoclaw.env'), 'utf8')).toBe('THEOCLAW_MODEL="first"\n')
  })

  it('treats /a/./b and /a/b as one file, so only the first write without force succeeds', async () => {
    const dir = scratchDir()
    const results = await Promise.allSettled([
      writeConfiguration(join(dir, 'theoclaw.env'), { THEOCLAW_MODEL: 'one' }, { force: false }),
      writeConfiguration(join(dir, '.', 'theoclaw.env'), { THEOCLAW_MODEL: 'two' }, { force: false }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((r) => r.status === 'rejected')
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(TheoClawConfigError)
  })

  it('a parent that is a file fails inside the write, leaving no lock file behind', async () => {
    const dir = scratchDir()
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'x')
    await expect(writeConfiguration(join(blocker, 'theoclaw.env'), { THEOCLAW_MODEL: 'm' }, { force: false })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['blocker'])
  })
})
