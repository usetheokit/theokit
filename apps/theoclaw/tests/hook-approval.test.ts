/**
 * B-397 FR-007 (AC-003): every TheoClaw agent carries a hook approval gate that runs only the hook
 * commands whose fingerprint the owner listed in `THEOCLAW_APPROVED_HOOKS`.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { agentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { createHookApprovalGate, hookFingerprint, parseApprovedHooks } from '../src/agent/hook-approval.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { waitFor } from './fakes.js'
import { startModelStub } from './model-stub.js'

const STOP_HOOK = { command: 'touch x', event: 'stop', sourceEvent: 'Stop', timeoutMs: 30_000 } as const

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The refusal `parseApprovedHooks` throws for `value`, which must be a `TheoClawConfigError`. */
function refusal(value: string): TheoClawConfigError {
  try {
    parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: value })
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('parseApprovedHooks accepted the value')
}

describe('hookFingerprint', () => {
  it('is the hex sha256 of the source event, the command and the timeout, one per line', () => {
    expect(hookFingerprint(STOP_HOOK)).toBe(sha256('Stop\ntouch x\n30000'))
  })

  it('changes when the timeout changes', () => {
    expect(hookFingerprint({ ...STOP_HOOK, timeoutMs: 5_000 })).not.toBe(hookFingerprint(STOP_HOOK))
  })

  it('changes when the source event changes', () => {
    expect(hookFingerprint({ ...STOP_HOOK, sourceEvent: 'PreToolUse' })).not.toBe(hookFingerprint(STOP_HOOK))
  })

  it('changes when the command changes', () => {
    expect(hookFingerprint({ ...STOP_HOOK, command: 'touch y' })).not.toBe(hookFingerprint(STOP_HOOK))
  })
})

describe('createHookApprovalGate', () => {
  it('refuses a hook when no fingerprint is listed', async () => {
    expect(await createHookApprovalGate(new Set()).approve?.(STOP_HOOK)).toBe(false)
  })

  it('refuses a hook whose fingerprint is not listed', async () => {
    const other = hookFingerprint({ ...STOP_HOOK, command: 'touch other' })
    expect(await createHookApprovalGate(new Set([other])).approve?.(STOP_HOOK)).toBe(false)
  })

  it('approves a hook whose fingerprint is listed', async () => {
    expect(await createHookApprovalGate(new Set([hookFingerprint(STOP_HOOK)])).approve?.(STOP_HOOK)).toBe(true)
  })
})

describe('parseApprovedHooks', () => {
  it('reads an unset list as no approved hook', () => {
    expect(parseApprovedHooks({})).toEqual(new Set())
  })

  it('reads an empty or blank list as no approved hook', () => {
    expect(parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: '' })).toEqual(new Set())
    expect(parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: '  ' })).toEqual(new Set())
  })

  it('trims and lower-cases each listed fingerprint', () => {
    const fingerprint = hookFingerprint(STOP_HOOK)
    const listed = parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: ` ${fingerprint.toUpperCase()} , ${sha256('other')}` })
    expect(listed).toEqual(new Set([fingerprint, sha256('other')]))
  })

  it('refuses an item that is not 64 hex characters, naming the variable and the position, never the value', () => {
    const error = refusal(`${sha256('a')},not-a-fingerprint`)
    expect(error.variable).toBe('THEOCLAW_APPROVED_HOOKS')
    expect(error.message).toContain('THEOCLAW_APPROVED_HOOKS')
    expect(error.message).toContain('2')
    expect(error.message).not.toContain('not-a-fingerprint')
  })

  it('refuses an empty entry between two fingerprints', () => {
    expect(refusal(`${sha256('a')},,${sha256('b')}`).variable).toBe('THEOCLAW_APPROVED_HOOKS')
  })
})

/** The hook commands of the NFR-004 workspace: one `PreToolUse`, one `Stop`, each touching a marker. */
interface HookWorkspace {
  readonly cwd: string
  readonly preToolMarker: string
  readonly stopMarker: string
  /** The fingerprints the SDK reports for the two commands (the default 30 s timeout). */
  readonly fingerprints: readonly string[]
}

function hookWorkspace(): HookWorkspace {
  const cwd = mkdtempSync(join(tmpdir(), 'theoclaw-hooks-'))
  const preToolMarker = join(cwd, 'pre-tool.marker')
  const stopMarker = join(cwd, 'stop.marker')
  const preTool = `touch ${preToolMarker}`
  const stop = `touch ${stopMarker}`
  mkdirSync(join(cwd, '.theokit'))
  writeFileSync(
    join(cwd, '.theokit', 'settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: preTool }] }],
        Stop: [{ hooks: [{ type: 'command', command: stop }] }],
      },
    }),
  )
  const fingerprints = [
    hookFingerprint({ sourceEvent: 'PreToolUse', command: preTool, timeoutMs: 30_000 }),
    hookFingerprint({ sourceEvent: 'Stop', command: stop, timeoutMs: 30_000 }),
  ]
  return { cwd, preToolMarker, stopMarker, fingerprints }
}

const realCleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of realCleanups.splice(0).reverse()) await cleanup()
})

/**
 * One turn of a real SDK agent built from TheoClaw's own options, in `workspace`. The project
 * setting source is turned on here, because TheoClaw's agents load none (plan D3), and without it
 * the SDK would read no hook at all and the refusal could not fail. `gated: false` drops the gate,
 * which is the control that proves the hooks do run when nothing refuses them.
 */
async function runOneTurn(workspace: HookWorkspace, approvedHooks: ReadonlySet<string>, gated = true): Promise<void> {
  const stub = await startModelStub([{ text: 'done' }])
  realCleanups.push(() => stub.close())
  const options = theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', approvedHooks })
  const local = { ...(gated ? options.local : {}), cwd: workspace.cwd, settingSources: ['project' as const] }
  const agent = await Agent.create({ ...options, local })
  realCleanups.push(() => agent[Symbol.asyncDispose]())
  const run = await agent.send('say done')
  expect((await run.wait()).status).toBe('finished')
}

describe('a real SDK agent with the gate (NFR-004)', () => {
  it('spawns 0 hook commands from .theokit/settings.json with an empty approved list', async () => {
    const workspace = hookWorkspace()
    await runOneTurn(workspace, new Set())
    expect(existsSync(workspace.stopMarker)).toBe(false)
    expect(existsSync(workspace.preToolMarker)).toBe(false)
  })

  it('spawns the Stop hook once its fingerprint is approved', async () => {
    const workspace = hookWorkspace()
    await runOneTurn(workspace, new Set(workspace.fingerprints))
    await waitFor(() => existsSync(workspace.stopMarker), 10_000, 'the approved Stop hook to touch its marker')
  })

  it('spawns the Stop hook when no gate is set, so the refusal above is the gate and not the setup', async () => {
    const workspace = hookWorkspace()
    await runOneTurn(workspace, new Set(), false)
    await waitFor(() => existsSync(workspace.stopMarker), 10_000, 'the ungated Stop hook to touch its marker')
  })
})

describe('the /control agent loads an approved project hook (OC-87)', () => {
  const settings = (cwd: string, command: string): void => {
    mkdirSync(join(cwd, '.theokit'))
    writeFileSync(
      join(cwd, '.theokit', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'list_dir', hooks: [{ type: 'command', command }] }] } }),
    )
  }

  async function listDirTurn(cwd: string, approvedHooks: ReadonlySet<string>): Promise<void> {
    const stub = await startModelStub([{ toolCalls: [{ name: 'list_dir', args: { path: '.' } }] }, { text: 'done' }])
    realCleanups.push(() => stub.close())
    const options = theoClawAgentOptions({ model: { id: 'lmstudio/stub', url: stub.url }, apiKey: 'stub-key', approvedHooks, projectHooks: true, pluginWorkspace: cwd, toolOptions: agentToolOptions(resolveToolSettings({}, cwd)) })
    const agent = await Agent.create(options)
    realCleanups.push(() => agent[Symbol.asyncDispose]())
    const run = await agent.send('list it')
    expect(await run.wait()).toMatchObject({ status: 'finished' })
  }

  it('writes a line for a list_dir turn once the fingerprint is approved, and none when it is not', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'theoclaw-hook-log-'))
    const log = join(cwd, 'tools.log')
    const command = `cat >> ${log}`
    settings(cwd, command)
    await listDirTurn(cwd, new Set())
    expect(existsSync(log)).toBe(false)
    await listDirTurn(cwd, new Set([hookFingerprint({ sourceEvent: 'PreToolUse', command, timeoutMs: 30_000 })]))
    await waitFor(() => existsSync(log), 10_000, 'the approved PreToolUse hook to write its log')
    expect(readFileSync(log, 'utf8')).toContain('list_dir')
  }, 30_000)
})
