import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import { AcpRequestTimeoutError, AcpTransportClosedError } from 'theokit/server/agent'
import { afterEach, describe, expect, it } from 'vitest'

import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { notEnforced, tempCwd } from './tool-start-fixtures.js'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'permission-asking-acp-agent.mjs')
const PROCESS_GONE_MS = 5_000

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

interface AgentUnderTest {
  readonly tool: CustomTool
  readonly record: string
  readonly pidFile: string
}

/** The ACP tool `buildTools` builds from an external tools file naming one agent. */
function acpTool(agent: { command?: string; args?: string[]; timeoutMs?: number }): AgentUnderTest {
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
  const tool = buildTools(settings).find((candidate) => candidate.name === 'asker')
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

describe('the ACP tools of the external tools file', () => {
  it('refuses every permission request over 10 calls', async () => {
    const { tool, record } = acpTool({})
    for (let i = 0; i < 10; i += 1) await expect(call(tool)).resolves.toBe('done')
    const answers = readFileSync(record, 'utf8').trim().split('\n')
    expect(answers).toHaveLength(10)
    expect(answers.every((answer) => answer === 'reject-once')).toBe(true)
  })

  it('leaves no agent process after a call', async () => {
    const { tool, pidFile } = acpTool({})
    await call(tool)
    await expectProcessGone(pidFile)
  })

  it('rejects with a typed error when the command is missing', async () => {
    const { tool } = acpTool({ command: '/nonexistent/theoclaw-acp-agent', args: [] })
    await expect(call(tool)).rejects.toBeInstanceOf(AcpTransportClosedError)
  })

  it('rejects with a typed error when the agent exits mid-turn, leaving no process', async () => {
    const cwd = tempCwd(cleanups)
    const pidFile = join(cwd, 'agent.pid')
    const { tool } = acpTool({ args: [FIXTURE, `--pid-file=${pidFile}`, '--exit-on=session/prompt'] })
    await expect(call(tool)).rejects.toBeInstanceOf(AcpTransportClosedError)
    await expectProcessGone(pidFile)
  })

  it('rejects with a typed error when the agent is silent past a 500 ms timeoutMs, leaving no process', async () => {
    const cwd = tempCwd(cleanups)
    const pidFile = join(cwd, 'agent.pid')
    const { tool } = acpTool({ args: [FIXTURE, `--pid-file=${pidFile}`, '--silent-on=session/prompt'], timeoutMs: 500 })
    await expect(call(tool)).rejects.toBeInstanceOf(AcpRequestTimeoutError)
    await expectProcessGone(pidFile)
  })
})
