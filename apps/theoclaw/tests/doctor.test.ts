import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { cleanScratch, harness, scratchDir } from './support/cli-harness.js'

afterEach(cleanScratch)

const TOKEN = 'abcdef0123456789abcdef0123456789abcdef0123456789'
const modeOf = (path: string): number => statSync(path).mode & 0o777

function setup(): { dir: string; path: string; state: string; content: string } {
  const dir = join(scratchDir(), 'theoclaw')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'theoclaw.env')
  const content = `THEOCLAW_CONTROL_TOKEN="${TOKEN}"\n`
  writeFileSync(path, content)
  chmodSync(path, 0o644)
  chmodSync(dir, 0o755)
  return { dir, path, state: join(scratchDir(), 'state'), content }
}

describe('theoclaw doctor', () => {
  it('reports without changing anything, then --fix repairs the modes and the state directory and keeps the secret', async () => {
    const { dir, path, state, content } = setup()
    const env = { THEOCLAW_CONFIG: path, THEOCLAW_STATE_DIR: state }

    const report = harness()
    Object.assign(report.io.env, env)
    expect(await runCli(['doctor'], report.io)).toBe(3)
    expect(report.stdout()).toContain('SA-001')
    expect(report.stdout()).toContain('SA-002')
    expect(report.stdout()).toContain('DR-001')
    expect(modeOf(path)).toBe(0o644)
    expect(existsSync(state)).toBe(false)

    const fix = harness()
    Object.assign(fix.io.env, env)
    expect(await runCli(['doctor', '--fix'], fix.io)).toBe(0)
    expect(modeOf(path)).toBe(0o600)
    expect(modeOf(dir)).toBe(0o700)
    expect(statSync(state).isDirectory()).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe(content)
    expect(fix.stdout()).not.toContain(TOKEN)

    const again = harness()
    Object.assign(again.io.env, env)
    expect(await runCli(['doctor'], again.io)).toBe(0)
  })

  it('leaves a state path that is a file alone and exits 3', async () => {
    const { path, state } = setup()
    chmodSync(path, 0o600)
    writeFileSync(state, 'data')
    const h = harness()
    Object.assign(h.io.env, { THEOCLAW_CONFIG: path, THEOCLAW_STATE_DIR: state })
    expect(await runCli(['doctor', '--fix'], h.io)).toBe(3)
    expect(readFileSync(state, 'utf8')).toBe('data')
  })

  it('a bad flag exits 2', async () => {
    expect(await runCli(['doctor', '--nope'], harness().io)).toBe(2)
  })
})
