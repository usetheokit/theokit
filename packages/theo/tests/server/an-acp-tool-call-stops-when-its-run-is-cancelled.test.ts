import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AcpToolConfig,
  createACPTool,
  NodeAcpTransport,
} from '../../src/server/agent/acp-tool.js'

/**
 * B-408, review findings 77 and 87: the SDK passes the run's AbortSignal to a tool handler as
 * `ctx.signal`. A cancelled run must end the ACP call and the agent process it spawned, instead of
 * leaving both running until the request timeout (ten minutes by default).
 *
 * The agent is the real fixture process (`fixtures/handshake-enforcing-acp-agent.mjs`), stuck on
 * `session/prompt` so only the cancellation can end the call before its timeout.
 */
const AGENT = fileURLToPath(
  new URL('./fixtures/handshake-enforcing-acp-agent.mjs', import.meta.url),
)

/** Far above every deadline below, so a call that settles did not settle by timing out. */
const TIMEOUT_MS = 60_000

let scratch: string
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'theokit-acp-cancel-'))
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const HANG = Symbol('no answer within the deadline')

/** Settle `work` within `ms`: its value, its rejection, or {@link HANG}. */
async function outcome(work: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(HANG), ms)
  })
  try {
    return await Promise.race([work.catch((err: unknown) => err), deadline])
  } finally {
    clearTimeout(timer)
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Wait for `path` to be written, so the test aborts only once the agent is running. */
async function readPidWhenWritten(path: string, ms = 10_000): Promise<number> {
  const deadline = Date.now() + ms
  while (!existsSync(path) || readFileSync(path, 'utf8') === '') {
    if (Date.now() > deadline) throw new Error(`the agent never wrote ${path}`)
    await new Promise((r) => setTimeout(r, 20))
  }
  return Number(readFileSync(path, 'utf8'))
}

function stuckAgentTool(pidFile: string) {
  return createACPTool({
    command: process.execPath,
    args: [AGENT, '--silent-on=session/prompt', `--pid-file=${pidFile}`],
    name: 'code_agent',
    description: 'A coding agent',
    onPermissionRequest: () => ({ granted: false }),
    timeoutMs: TIMEOUT_MS,
  })
}

describe('an ACP tool call stops when its run is cancelled', { timeout: 25_000 }, () => {
  it('test_an_aborted_run_ends_the_acp_call_and_its_agent', async () => {
    const pidFile = join(scratch, 'agent.pid')
    const controller = new AbortController()
    const call = Promise.resolve(
      stuckAgentTool(pidFile).handler({ message: 'hi' }, { signal: controller.signal }),
    )
    const pid = await readPidWhenWritten(pidFile)
    const reason = new Error('the run was cancelled')

    controller.abort(reason)
    const result = await outcome(call, 5_000)

    expect(result, 'the call was still pending 5s after its run was cancelled').not.toBe(HANG)
    expect(result).toBe(reason)
    expect(isAlive(pid), `agent process ${pid} outlived the cancelled call`).toBe(false)
  })

  // Review finding F-tests-7: the oracle is the transport factory, not a pid file read after a fixed
  // wait, which an agent slow to start under load would pass while the defect was present.
  it('test_a_run_cancelled_before_the_call_starts_no_agent', async () => {
    const pidFile = join(scratch, 'agent.pid')
    const reason = new Error('cancelled before the tool ran')
    const transportFactory = vi.fn(
      (config: AcpToolConfig) => new NodeAcpTransport(config.command, config.args, config.cwd),
    )
    const tool = createACPTool({
      command: process.execPath,
      args: [AGENT, '--silent-on=session/prompt', `--pid-file=${pidFile}`],
      name: 'code_agent',
      description: 'A coding agent',
      onPermissionRequest: () => ({ granted: false }),
      timeoutMs: TIMEOUT_MS,
      transportFactory,
    })

    const result = await outcome(
      Promise.resolve(tool.handler({ message: 'hi' }, { signal: AbortSignal.abort(reason) })),
      5_000,
    )

    expect(result).toBe(reason)
    expect(
      transportFactory,
      'a transport was opened for a run already cancelled',
    ).not.toHaveBeenCalled()
  })
})
