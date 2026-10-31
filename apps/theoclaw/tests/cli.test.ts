import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfiguration } from '../src/config-file.js'

const scratch: string[] = []

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-cli-'))
  scratch.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the theoclaw command line', () => {
  it('start loads the configuration file without overwriting the environment', () => {
    const dir = scratchDir()
    const path = join(dir, 'theoclaw.env')
    const unset = `THEOCLAW_CLI_TEST_${process.pid}`
    writeFileSync(path, `THEOCLAW_MODEL="from-file"\n${unset}="loaded"\n`)
    const env: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: path, THEOCLAW_MODEL: 'from-env' }

    loadConfiguration(env, dir)

    expect(env.THEOCLAW_MODEL).toBe('from-env')
    expect(env[unset]).toBe('loaded')
    expect(process.env[unset]).toBeUndefined()
  })
})
