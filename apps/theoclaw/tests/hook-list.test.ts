/** `theoclaw hooks list` (#1615): the project hooks with their fingerprint and approval state. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { hookFingerprint, parseApprovedHooks } from '../src/agent/hook-approval.js'
import { runCli } from '../src/cli.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)

function settings(cwd: string, body: unknown): void {
  mkdirSync(join(cwd, '.theokit'), { recursive: true })
  writeFileSync(join(cwd, '.theokit', 'settings.json'), JSON.stringify(body))
}

const pre = (command: string, timeout?: number) => ({
  matcher: '*',
  hooks: [{ type: 'command', command, ...(timeout === undefined ? {} : { timeout }) }],
})

describe('theoclaw hooks list', () => {
  it('prints an approved and an unapproved hook with the fingerprints THEOCLAW_APPROVED_HOOKS accepts', async () => {
    const v = harness()
    settings(v.io.cwd, { hooks: { PreToolUse: [pre('touch a'), pre('touch b')] } })
    const a = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'touch a', timeoutMs: 30_000 })
    const b = hookFingerprint({ sourceEvent: 'PreToolUse', command: 'touch b', timeoutMs: 30_000 })
    v.io.env.THEOCLAW_APPROVED_HOOKS = a

    expect(await runCli(['hooks', 'list'], v.io)).toBe(0)

    const lines = v.stdout().trimEnd().split('\n')
    expect(lines).toEqual([`PreToolUse  ${a}  approved`, `PreToolUse  ${b}  not approved`])
    expect(
      parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: lines.map((l) => l.split('  ')[1]).join(',') }),
    ).toEqual(new Set([a, b]))
    expect(v.stdout()).not.toContain('touch')
  })

  it('fingerprints a file timeout in milliseconds', async () => {
    const v = harness()
    settings(v.io.cwd, {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x', timeout: 5 }] }] },
    })
    await runCli(['hooks', 'list'], v.io)
    expect(v.stdout()).toContain(
      hookFingerprint({ sourceEvent: 'Stop', command: 'x', timeoutMs: 5000 }),
    )
  })

  it('says so when there is no settings file', async () => {
    const v = harness()
    expect(await runCli(['hooks', 'list'], v.io)).toBe(0)
    expect(v.stdout()).toBe('no hooks\n')
  })

  it('refuses other arguments with exit 2', async () => {
    const v = harness()
    expect(await runCli(['hooks'], v.io)).toBe(2)
  })
})
