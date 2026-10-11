import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createACPTool } from '../../src/server/agent/acp-tool.js'

/**
 * B-408, review findings 78 and 88: a coding agent is often started through a launcher (`npx`, a
 * shell script), so the process the tool spawns is the wrapper and the agent is its child. Ending
 * only the wrapper leaves the agent running, orphaned, after the call returned. The call must end
 * every process it started, the agent behind the wrapper included.
 *
 * The wrapper is a shell script that runs the fixture agent as a child and does not `exec` it, the
 * shape of a launcher. The pid checked is the one the agent writes for itself: the grandchild.
 * POSIX only: a process group is what the transport signals, and Windows has none.
 */
const AGENT = fileURLToPath(
  new URL('./fixtures/handshake-enforcing-acp-agent.mjs', import.meta.url),
)

let scratch: string
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'theokit-acp-wrapper-'))
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A launcher script: it runs its arguments as a child process and waits for it, never `exec`. */
function wrapperScript(): string {
  const path = join(scratch, 'launch-agent.sh')
  writeFileSync(path, '#!/bin/sh\n"$@"\nstatus=$?\nexit "$status"\n')
  chmodSync(path, 0o755)
  return path
}

async function callThroughWrapper(agentArgs: string[]) {
  const pidFile = join(scratch, 'agent.pid')
  const tool = createACPTool({
    command: wrapperScript(),
    args: [process.execPath, AGENT, ...agentArgs, `--pid-file=${pidFile}`],
    name: 'code_agent',
    description: 'A coding agent',
    onPermissionRequest: () => ({ granted: false }),
  })
  const result = await tool.handler({ message: 'hi' })
  return { result, pid: Number(readFileSync(pidFile, 'utf8')) }
}

describe.skipIf(process.platform === 'win32')(
  'an ACP agent started through a wrapper is gone after the call',
  { timeout: 25_000 },
  () => {
    it('test_an_agent_behind_a_wrapper_is_gone_after_the_call', async () => {
      const { result, pid } = await callThroughWrapper([])

      expect(result).toBe('echo:hi')
      // No polling: the call itself must not return while the agent behind the wrapper runs.
      expect(isAlive(pid), `agent process ${pid} outlived the call through its wrapper`).toBe(false)
    })

    it('test_an_agent_behind_a_wrapper_that_ignores_sigterm_is_gone_after_the_call', async () => {
      const { result, pid } = await callThroughWrapper(['--ignore-sigterm'])

      expect(result).toBe('echo:hi')
      expect(isAlive(pid), `agent process ${pid} outlived the call through its wrapper`).toBe(false)
    })
  },
)
