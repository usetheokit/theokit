/**
 * M5 (theokit-ai-first) — `theokit agent <name> [message]` (agentCommand).
 *
 * Scans a real `agents/` dir (temp fixture), fails fast on a missing message / unknown agent, and
 * wires the loaded module to `runAgentInTerminal`. The Vite loader + LLM are injected here so the
 * command's control flow is deterministic (the real transpile is exercised only in a live run).
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentCommand } from '../../packages/theo/src/cli/commands/agent.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theo-agent-cmd-'))
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(join(root, 'agents', 'ops.ts'), 'export default {}\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('agentCommand (M5)', () => {
  it('test_missing_message_fails_fast', async () => {
    await expect(agentCommand('ops', undefined, { projectRoot: root })).rejects.toThrow(
      /message is required/,
    )
    await expect(agentCommand('ops', '   ', { projectRoot: root })).rejects.toThrow(
      /message is required/,
    )
  })

  it('test_unknown_agent_fails_fast_and_lists_available', async () => {
    await expect(
      agentCommand('nope', 'hi', { projectRoot: root, resolveApiKey: () => 'k' }),
    ).rejects.toThrow(/'nope' not found/)
    // The available agent (ops) is surfaced to help the developer.
    await expect(
      agentCommand('nope', 'hi', { projectRoot: root, resolveApiKey: () => 'k' }),
    ).rejects.toThrow(/ops/)
  })

  it('test_loads_the_agent_and_runs_it_in_the_terminal', async () => {
    const fakeMod = { default: {} }
    const loadModule = vi.fn().mockResolvedValue(fakeMod)
    const runAgent = vi.fn().mockResolvedValue(undefined)

    await agentCommand('ops', 'deploy billing', {
      projectRoot: root,
      loadModule,
      runAgent,
      resolveApiKey: () => 'sk-test',
    })

    // The scanned agent's file was loaded and handed to the terminal runner with the message + apiKey.
    expect(loadModule).toHaveBeenCalledWith(expect.stringMatching(/agents[/\\]ops\.ts$/))
    expect(runAgent).toHaveBeenCalledWith(
      fakeMod,
      'sk-test',
      expect.objectContaining({ message: 'deploy billing' }),
    )
  })
})
