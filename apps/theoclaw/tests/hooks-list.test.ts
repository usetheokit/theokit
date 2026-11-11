import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { hookFingerprint, parseApprovedHooks } from '../src/agent/hook-approval.js'
import { runCli } from '../src/cli.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)

function project(hooks: unknown) {
  const v = harness()
  if (hooks !== undefined) {
    mkdirSync(join(v.io.cwd, '.theokit'))
    writeFileSync(join(v.io.cwd, '.theokit', 'settings.json'), JSON.stringify({ hooks }))
  }
  return v
}

const hooks = {
  PreToolUse: [
    { matcher: 'a', hooks: [{ type: 'command', command: 'echo one' }] },
    { matcher: 'b', hooks: [{ type: 'command', command: 'echo two', timeout: 5000 }] },
  ],
}
const one = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'echo one', timeoutMs: 30_000 })
const two = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'echo two', timeoutMs: 5000 })

describe('theoclaw hooks list', () => {
  it('marks the approved hook and the unapproved one', async () => {
    const v = project(hooks)
    const env = { ...v.io.env, THEOCLAW_APPROVED_HOOKS: one }
    expect(await runCli(['hooks', 'list'], { ...v.io, env })).toBe(0)
    expect(v.stdout().trim().split('\n')).toEqual([
      `PreToolUse  ${one}  approved`,
      `PreToolUse  ${two}  not approved`,
    ])
    expect(parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: `${one},${two}` }).size).toBe(2)
    expect(v.stdout()).not.toContain('echo')
  })

  it('says so when there are no hooks', async () => {
    const v = project(undefined)
    expect(await runCli(['hooks', 'list'], v.io)).toBe(0)
    expect(v.stdout()).toBe('no hooks\n')
  })

  it('refuses another verb', async () => {
    const v = project(undefined)
    expect(await runCli(['hooks', 'add'], v.io)).not.toBe(0)
  })
})
