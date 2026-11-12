import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { Agent } from '@theokit/sdk'
import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { startModelStub } from './model-stub.js'
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
    { matcher: 'b', hooks: [{ type: 'command', command: 'echo two', timeout: 5 }] },
    { matcher: 'c', hooks: [{ type: 'command', command: 'echo zero', timeout: 0 }] },
  ],
}
const one = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'echo one', timeoutMs: 30_000 })
const two = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'echo two', timeoutMs: 5000 })
const zero = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'echo zero', timeoutMs: 30_000 })

describe('theoclaw hooks list', () => {
  it('marks the approved hook and the unapproved one', async () => {
    const v = project(hooks)
    const env = { ...v.io.env, THEOCLAW_APPROVED_HOOKS: one }
    expect(await runCli(['hooks', 'list'], { ...v.io, env })).toBe(0)
    expect(v.stdout().trim().split('\n')).toEqual([
      `PreToolUse  ${one}  approved`,
      `PreToolUse  ${two}  not approved`,
      `PreToolUse  ${zero}  not approved`,
    ])
    expect(parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: `${one},${two}` }).size).toBe(2)
    expect(v.stdout()).not.toContain('echo')
  })

  it('says so when there are no hooks', async () => {
    const v = project(undefined)
    expect(await runCli(['hooks', 'list'], v.io)).toBe(0)
    expect(v.stdout()).toBe('no hooks\n')
  })

  it('prints the fingerprints the SDK reports to the approval gate', async () => {
    const v = project({
      Stop: [{ hooks: [{ type: 'command', command: 'true', timeout: 5 }] }],
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'true', timeout: 0 }] }],
    })
    const seen: string[] = []
    const stub = await startModelStub([{ text: 'done' }])
    const options = theoClawAgentOptions({
      model: { id: 'lmstudio/stub', url: stub.url },
      apiKey: 'stub-key',
    })
    const agent = await Agent.create({
      ...options,
      local: {
        ...options.local,
        cwd: v.io.cwd,
        settingSources: ['project'],
        hooks: {
          approve: (request) => {
            seen.push(hookFingerprint(request))
            return false
          },
        },
      },
    })
    try {
      await (await agent.send('say done')).wait()
    } finally {
      await agent[Symbol.asyncDispose]()
      await stub.close()
    }
    expect(await runCli(['hooks', 'list'], v.io)).toBe(0)
    const printed = v
      .stdout()
      .trim()
      .split('\n')
      .map((line) => line.split('  ')[1])
    expect(seen.length).toBeGreaterThan(0)
    for (const fingerprint of seen) expect(printed).toContain(fingerprint)
  })

  it('refuses an invalid THEOCLAW_APPROVED_HOOKS', async () => {
    const v = project(hooks)
    const env = { ...v.io.env, THEOCLAW_APPROVED_HOOKS: 'nope' }
    expect(await runCli(['hooks', 'list'], { ...v.io, env })).not.toBe(0)
    expect(v.stderr()).toContain('THEOCLAW_APPROVED_HOOKS')
  })

  it('refuses invalid settings JSON', async () => {
    const v = project(undefined)
    mkdirSync(join(v.io.cwd, '.theokit'))
    writeFileSync(join(v.io.cwd, '.theokit', 'settings.json'), '{nope')
    expect(await runCli(['hooks', 'list'], v.io)).not.toBe(0)
    expect(v.stderr()).toContain('settings.json')
  })

  it('refuses another verb', async () => {
    const v = project(undefined)
    expect(await runCli(['hooks', 'add'], v.io)).not.toBe(0)
  })
})
