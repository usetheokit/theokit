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
  // usetheokit/theokit#365 - the scanner refuses an agent file that declares no policy.
  writeFileSync(
    join(root, 'agents', 'ops.ts'),
    "export const policy = 'public'\nexport default {}\n",
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('agentCommand (M5)', () => {
  it('test_missing_message_fails_fast_when_no_interactive_surface_is_wired', async () => {
    // M83 re-pointed this, and the BEHAVIOUR it protects is unchanged: no message and no surface
    // still refuses, fail-fast, for both `undefined` and blank.
    //
    // What changed is the message. It used to recite usage ("a message is required"), which reads
    // as "you typed it wrong" — while the actual reason, once an interactive mode exists, is that
    // nothing was wired to run a session. The assertion follows the reason rather than the wording.
    await expect(agentCommand('ops', undefined, { projectRoot: root })).rejects.toThrow(
      /no interactive surface is wired/,
    )
    await expect(agentCommand('ops', '   ', { projectRoot: root })).rejects.toThrow(
      /no interactive surface is wired/,
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
    const runAgent = vi.fn().mockResolvedValue({ sawError: false })

    const result = await agentCommand('ops', 'deploy billing', {
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
    // The run result (error signal for the CLI exit code) is threaded back.
    expect(result).toEqual({ sawError: false })
  })
})
