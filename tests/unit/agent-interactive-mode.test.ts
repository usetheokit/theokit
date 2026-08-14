import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentCommand } from '../../packages/theo/src/cli/commands/agent.js'

/**
 * M83 — `theokit agent <name>` without a message means INTERACTIVE.
 *
 * Refusing an absent message is what left the command-routing primitive with no production consumer
 * in this repo: a router exists to route what a user types over a SESSION, and a command that takes
 * one message and exits never types twice.
 *
 * It also made the first thing a new user runs — `theokit agent chat` — fail with usage text, which
 * reads as "this is broken" rather than "pass an argument".
 */

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'agent-interactive-'))
  mkdirSync(join(projectRoot, 'agents'), { recursive: true })
  writeFileSync(join(projectRoot, 'agents', 'chat.ts'), 'export default {}', 'utf8')
})
afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('an absent message enters the interactive surface', () => {
  it('test_no_message_hands_off_to_startInteractive', async () => {
    const startInteractive = vi.fn(() => Promise.resolve({ sawError: false }))
    const result = await agentCommand('chat', undefined, {
      projectRoot,
      agentsDir: 'agents',
      startInteractive,
    })
    expect(startInteractive).toHaveBeenCalledWith('chat')
    expect(result).toEqual({ sawError: false })
  })

  it('test_a_blank_message_counts_as_absent', async () => {
    // `theokit agent chat ""` from a shell script with an unset variable is the same intent.
    const startInteractive = vi.fn(() => Promise.resolve({ sawError: false }))
    await agentCommand('chat', '   ', { projectRoot, agentsDir: 'agents', startInteractive })
    expect(startInteractive).toHaveBeenCalledTimes(1)
  })

  it('test_a_message_still_runs_ONE_SHOT_and_never_reaches_the_surface', async () => {
    // The counter-proof. Routing everything through the interactive surface would break every
    // script that pipes one message and reads the output.
    const startInteractive = vi.fn(() => Promise.resolve({ sawError: false }))
    const runAgent = vi.fn(() => Promise.resolve({ sawError: false }))
    await agentCommand('chat', 'hello', {
      projectRoot,
      agentsDir: 'agents',
      startInteractive,
      runAgent,
      resolveApiKey: () => 'k',
      loadModule: () => Promise.resolve({ default: {} }),
    })
    expect(startInteractive).not.toHaveBeenCalled()
    expect(runAgent).toHaveBeenCalledTimes(1)
  })
})

describe('the failure modes stay honest', () => {
  it('test_an_unknown_agent_fails_the_SAME_way_in_interactive_mode', async () => {
    // The hand-off happens after the name resolves, so a typo fails with the list of what exists
    // rather than opening a session against nothing.
    const startInteractive = vi.fn(() => Promise.resolve({ sawError: false }))
    await expect(
      agentCommand('chatt', undefined, { projectRoot, agentsDir: 'agents', startInteractive }),
    ).rejects.toThrow(/not found/)
    expect(startInteractive).not.toHaveBeenCalled()
  })

  it('test_no_message_and_NO_surface_wired_says_why_rather_than_reciting_usage', async () => {
    // Honest about the remaining gap: this repo ships no interactive surface, so the CLI still needs
    // one injected. The message names that instead of implying the user typed the command wrong.
    await expect(
      agentCommand('chat', undefined, { projectRoot, agentsDir: 'agents' }),
    ).rejects.toThrow(/no interactive surface is wired/)
  })
})
