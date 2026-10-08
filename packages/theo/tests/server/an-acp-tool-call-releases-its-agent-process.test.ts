import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AcpRequestTimeoutError,
  AcpTransportClosedError,
  createACPTool,
} from '../../src/server/agent/acp-tool.js'

/**
 * B-408, B-426, B-427: an ACP tool call owns the agent process it spawns. It ends that process
 * when the call ends, however the call ends, and a process that cannot start, dies mid-turn or
 * never answers rejects the call with a typed error instead of crashing the host or hanging.
 *
 * Every test here uses the default transport, the one a consumer gets, against the real fixture
 * agent (`fixtures/handshake-enforcing-acp-agent.mjs`). Each call is raced against a 10s deadline
 * so a hang reads as a failure naming the hang, not as a test-runner timeout.
 */
const AGENT = fileURLToPath(
  new URL('./fixtures/handshake-enforcing-acp-agent.mjs', import.meta.url),
)

let scratch: string
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'theokit-acp-lifecycle-'))
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const HANG = Symbol('no answer within the deadline')

/** Settle `work` within `ms`: its value, its rejection, or {@link HANG}. */
async function outcome(work: Promise<unknown>, ms = 10_000): Promise<unknown> {
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

/** Poll for the process to be gone; a process that outlives the deadline is the leak. */
async function goneWithin(pid: number, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20))
  }
  return !isAlive(pid)
}

function agentTool(args: string[], extra: { command?: string; timeoutMs?: number } = {}) {
  return createACPTool({
    command: extra.command ?? process.execPath,
    args: [AGENT, ...args],
    name: 'code_agent',
    description: 'A coding agent',
    onPermissionRequest: () => ({ granted: false }),
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  })
}

async function callAndReadPid(args: string[], extra: { timeoutMs?: number } = {}) {
  const pidFile = join(scratch, 'agent.pid')
  const result = await outcome(
    Promise.resolve(
      agentTool([...args, `--pid-file=${pidFile}`], extra).handler({ message: 'hi' }),
    ),
  )
  return { result, pid: Number(readFileSync(pidFile, 'utf8')) }
}

// Above the 10s deadline in `outcome`, so a hang fails with its own message, not the runner's.
const LIMIT = { timeout: 25_000 }

describe('an ACP tool call releases the agent process it spawned', LIMIT, () => {
  it('test_the_agent_process_is_gone_after_a_successful_call', async () => {
    const { result, pid } = await callAndReadPid([])

    expect(result).toBe('echo:hi')
    expect(await goneWithin(pid), `agent process ${pid} still running after the call`).toBe(true)
  })

  it('test_the_agent_process_is_gone_after_a_refused_step', async () => {
    const { result, pid } = await callAndReadPid(['--refuse=session/new'])

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/refused session\/new/)
    expect(await goneWithin(pid), `agent process ${pid} still running after the call`).toBe(true)
  })

  it('test_an_agent_that_never_answers_rejects_with_the_timeout_error', async () => {
    const { result, pid } = await callAndReadPid(['--silent-on=session/prompt'], {
      timeoutMs: 300,
    })

    expect(result).not.toBe(HANG)
    expect(result).toBeInstanceOf(AcpRequestTimeoutError)
    expect((result as AcpRequestTimeoutError).method).toBe('session/prompt')
    expect(await goneWithin(pid), `agent process ${pid} still running after the call`).toBe(true)
  })
})

describe('an ACP tool call against a process that fails', LIMIT, () => {
  it('test_a_missing_command_rejects_with_the_closed_error_and_the_host_keeps_running', async () => {
    const command = join(scratch, 'no-such-coding-agent')
    const uncaught: unknown[] = []
    const onUncaught = (err: unknown) => {
      uncaught.push(err)
    }
    process.on('uncaughtException', onUncaught)
    let result: unknown
    try {
      result = await outcome(Promise.resolve(agentTool([], { command }).handler({ message: 'hi' })))
      // An 'error' event with no listener surfaces after the spawn call returns; give it a turn.
      await new Promise((r) => setTimeout(r, 50))
    } finally {
      process.off('uncaughtException', onUncaught)
    }

    expect(uncaught, `the spawn failure escaped as ${String(uncaught[0])}`).toEqual([])
    expect(result).not.toBe(HANG)
    expect(result).toBeInstanceOf(AcpTransportClosedError)
    expect((result as Error).message).toContain(command)
    expect((result as AcpTransportClosedError).command).toBe(command)
  })

  it('test_an_agent_that_exits_mid_turn_rejects_instead_of_hanging', async () => {
    const result = await outcome(
      Promise.resolve(agentTool(['--exit-on=session/prompt']).handler({ message: 'hi' })),
    )

    expect(result).not.toBe(HANG)
    expect(result).toBeInstanceOf(AcpTransportClosedError)
    expect((result as Error).message).toContain(process.execPath)
    expect((result as Error).message).toMatch(/code 3/)
  })
})

/** Run `work` while recording every uncaught exception, so a crash of the host is an assertion. */
async function recordingUncaught<T>(
  work: () => Promise<T>,
): Promise<{ value: T; uncaught: unknown[] }> {
  const uncaught: unknown[] = []
  const onUncaught = (err: unknown) => {
    uncaught.push(err)
  }
  process.on('uncaughtException', onUncaught)
  try {
    const value = await work()
    // A throw from a stream listener surfaces on a later turn of the event loop; give it one.
    await new Promise((r) => setTimeout(r, 50))
    return { value, uncaught }
  } finally {
    process.off('uncaughtException', onUncaught)
  }
}

describe('an ACP tool call against an agent that misbehaves on its channel', LIMIT, () => {
  it('test_a_non_json_stdout_line_rejects_the_call_typed_and_the_host_keeps_running', async () => {
    const { value, uncaught } = await recordingUncaught(() =>
      callAndReadPid(['--banner=starting agent v1.2']),
    )

    expect(uncaught, `the bad line escaped as ${String(uncaught[0])}`).toEqual([])
    expect(value.result).not.toBe(HANG)
    expect(value.result).toBeInstanceOf(AcpTransportClosedError)
    expect((value.result as Error).message).toContain('starting agent v1.2')
    expect(
      await goneWithin(value.pid),
      `agent process ${value.pid} still running after the call`,
    ).toBe(true)
  })

  it('test_a_multibyte_character_split_across_two_chunks_reaches_the_reply_intact', async () => {
    const pidFile = join(scratch, 'agent.pid')
    const result = await outcome(
      Promise.resolve(
        agentTool(['--split-writes', `--pid-file=${pidFile}`]).handler({ message: 'ação' }),
      ),
    )

    expect(result).toBe('echo:ação')
  })

  it('test_an_agent_that_ignores_sigterm_is_gone_when_the_call_returns', async () => {
    const { result, pid } = await callAndReadPid(['--ignore-sigterm'])

    expect(result).toBe('echo:hi')
    // No polling: the call itself must not return while its agent is still running.
    expect(isAlive(pid), `agent process ${pid} outlived the call that spawned it`).toBe(false)
  })
})
