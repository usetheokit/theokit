import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import { AcpRequestTimeoutError, AcpTransportClosedError } from 'theokit/server/agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AcpPermissionOptions } from '../src/tools/acp-permission.js'
import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { notEnforced, tempCwd } from './tool-start-fixtures.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'permission-asking-acp-agent.mjs')
const PROCESS_GONE_MS = 5_000

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0)) cleanup()
})

interface AgentUnderTest {
  readonly tool: CustomTool
  readonly record: string
  readonly pidFile: string
}

/** The ACP tool `buildTools` builds from an external tools file naming one agent. */
function acpTool(agent: { command?: string; args?: string[]; timeoutMs?: number }, permission: AcpPermissionOptions = {}): AgentUnderTest {
  const cwd = tempCwd(cleanups)
  const record = join(cwd, 'permissions.log')
  const pidFile = join(cwd, 'agent.pid')
  const file = join(cwd, 'external-tools.json')
  const args = agent.args ?? [FIXTURE, `--record=${record}`, `--pid-file=${pidFile}`]
  writeFileSync(
    file,
    JSON.stringify({
      acpAgents: [{ name: 'asker', description: 'asks permission', command: agent.command ?? process.execPath, args, ...agent }],
    }),
  )
  const settings = resolveToolSettings({ THEOCLAW_EXTERNAL_TOOLS: file }, cwd, { detect: notEnforced, warn: () => undefined })
  const tool = buildTools(settings, permission).find((candidate) => candidate.name === 'asker')
  if (tool === undefined) throw new Error('buildTools built no ACP tool named asker')
  return { tool, record, pidFile }
}

function call(tool: CustomTool): Promise<unknown> {
  return Promise.resolve(tool.handler({ message: 'write the file' }, undefined as never))
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Wait until the process the pid file names is gone, failing after the deadline. */
async function expectProcessGone(pidFile: string): Promise<void> {
  expect(existsSync(pidFile)).toBe(true)
  const pid = Number(readFileSync(pidFile, 'utf8'))
  const deadline = Date.now() + PROCESS_GONE_MS
  while (alive(pid)) {
    if (Date.now() > deadline) throw new Error(`the ACP agent process ${String(pid)} was still running after ${String(PROCESS_GONE_MS)} ms`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('the owner is asked for an ACP agent permission request (B-684)', () => {
  async function answerOf(permission: AcpPermissionOptions): Promise<string> {
    const { tool, record } = acpTool({}, permission)
    await expect(call(tool)).resolves.toBe('done')
    return readFileSync(record, 'utf8').trim()
  }

  it('grants on the owner yes, naming the agent and the step in the question', async () => {
    const ask = vi.fn(async () => 'once' as const)
    expect(await answerOf({ ask })).toBe('allow-once')
    expect(ask).toHaveBeenCalledWith('ACP agent asker asks permission: write a file (edit)')
  })

  it('grants on an always answer, once', async () => {
    expect(await answerOf({ ask: async () => 'always' })).toBe('allow-once')
  })

  it('refuses on the owner no', async () => {
    expect(await answerOf({ ask: async () => 'deny' })).toBe('reject-once')
  })

  it('refuses when the owner does not answer in time', async () => {
    expect(await answerOf({ ask: () => new Promise(() => undefined), timeoutMs: 50 })).toBe('reject-once')
  })

  it('refuses when the question cannot be asked, or nobody can be asked', async () => {
    expect(
      await answerOf({
        ask: async () => {
          throw new Error('channel down')
        },
      }),
    ).toBe('reject-once')
    expect(await answerOf({})).toBe('reject-once')
  })
})

describe('the ACP tools of the external tools file', () => {
  it('refuses every permission request over 10 calls, leaving no process after each', async () => {
    const { tool, record, pidFile } = acpTool({})
    for (let i = 0; i < 10; i += 1) {
      await expect(call(tool)).resolves.toBe('done')
      await expectProcessGone(pidFile)
    }
    const answers = readFileSync(record, 'utf8').trim().split('\n')
    expect(answers).toHaveLength(10)
    expect(answers.every((answer) => answer === 'reject-once')).toBe(true)
  })

  it('leaves no agent process after a call', async () => {
    const { tool, pidFile } = acpTool({})
    await call(tool)
    await expectProcessGone(pidFile)
  })

  it('starts the agent without the host secrets in its environment (B-681)', async () => {
    vi.stubEnv('THEOCLAW_CONTROL_TOKEN', 'control-token-0123456789')
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-0123456789')
    vi.stubEnv('THEOCLAW_TELEGRAM_TOKEN', 'telegram-0123456789')
    const dir = tempCwd(cleanups)
    const envFile = join(dir, 'env.json')
    const { tool } = acpTool({ args: [FIXTURE, `--record=${join(dir, 'permissions.log')}`, `--env-names=${envFile}`] })
    await expect(call(tool)).resolves.toBe('done')
    const names = JSON.parse(readFileSync(envFile, 'utf8')) as string[]
    expect(names).toContain('PATH')
    if (process.env.HOME !== undefined) expect(names).toContain('HOME')
    expect(names).not.toContain('THEOCLAW_CONTROL_TOKEN')
    expect(names).not.toContain('OPENROUTER_API_KEY')
    expect(names).not.toContain('THEOCLAW_TELEGRAM_TOKEN')
  })

  it('rejects a missing command with an error naming the agent, not env', async () => {
    const { tool } = acpTool({ command: '/nonexistent/theoclaw-acp-agent', args: [] })
    const error: unknown = await call(tool).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AcpTransportClosedError)
    expect((error as AcpTransportClosedError).command).toBe('/nonexistent/theoclaw-acp-agent')
    expect((error as Error).message).toContain('"/nonexistent/theoclaw-acp-agent"')
    expect((error as Error).message).toContain('could not be found or run')
    expect((error as Error).message).not.toContain('/usr/bin/env')
  })

  it('rejects a command that is not executable with an error naming it', async () => {
    const cwd = tempCwd(cleanups)
    const script = join(cwd, 'not-executable-agent')
    writeFileSync(script, '#!/bin/sh\n', { mode: 0o644 })
    const { tool } = acpTool({ command: script, args: [] })
    const error: unknown = await call(tool).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AcpTransportClosedError)
    expect((error as Error).message).toContain(`"${script}" could not be found or run`)
  })

  it('rejects a bare command name found on no PATH directory with an error naming it', async () => {
    const { tool } = acpTool({ command: 'theoclaw-no-such-acp-agent', args: [] })
    const error: unknown = await call(tool).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AcpTransportClosedError)
    expect((error as Error).message).toContain('"theoclaw-no-such-acp-agent" could not be found or run')
  })

  it('rejects with a typed error when the agent exits mid-turn, leaving no process', async () => {
    const cwd = tempCwd(cleanups)
    const pidFile = join(cwd, 'agent.pid')
    const { tool } = acpTool({ args: [FIXTURE, `--pid-file=${pidFile}`, '--exit-on=session/prompt'] })
    const error: unknown = await call(tool).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AcpTransportClosedError)
    expect((error as AcpTransportClosedError).command).toBe(process.execPath)
    expect((error as Error).message).not.toContain('/usr/bin/env')
    await expectProcessGone(pidFile)
  })

  it('rejects with a typed error when the agent is silent past a 500 ms timeoutMs, leaving no process', async () => {
    const cwd = tempCwd(cleanups)
    const pidFile = join(cwd, 'agent.pid')
    const { tool } = acpTool({ args: [FIXTURE, `--pid-file=${pidFile}`, '--silent-on=session/prompt'], timeoutMs: 500 })
    const error: unknown = await call(tool).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AcpRequestTimeoutError)
    expect((error as Error).message).toContain(`"${process.execPath}"`)
    expect((error as Error).message).not.toContain('/usr/bin/env')
    await expectProcessGone(pidFile)
  })
})
