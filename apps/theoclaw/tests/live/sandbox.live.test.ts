import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveSandboxPosture } from '@theokit/agents/sandbox'
import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import { agentToolOptions } from '../../src/tools/tool-registry.js'
import type { AgentToolOptions } from '../../src/tools/tool-registry.js'
import { checkHostToolsPosture, resolveToolSettings } from '../../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'

/**
 * OC-76 (B-392): a real model, through the agent and tools the process builds under
 * THEOCLAW_SANDBOX=workspace-write, tries to write outside the workspace with `shell_exec`, and the
 * write fails. Runs only with THEOCLAW_LIVE=1; without it the file skips, so CI stays offline.
 * The pass needs the attempt AND its failure: no shell call naming the outside path fails the test,
 * and a call refused before it ran (`ok: false`) is not confinement (FR-008).
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
/**
 * With the SDK's one grace iteration once the budget is spent (`IterationBudget.shouldContinue`),
 * at most 3 model requests (NFR-003; plan, Baseline Context).
 */
const MAX_ITERATIONS = 2
const MAX_REQUESTS = MAX_ITERATIONS + 1

function liveModel(): { readonly model: string; readonly apiKey: string } {
  const model = process.env.THEOCLAW_MODEL
  const apiKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if (!apiKey) throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  return { model, apiKey }
}

interface ShellCall {
  readonly command: string
  readonly result: { readonly ok?: boolean; readonly exit_code?: number; readonly stderr?: string }
}

/** The tool options with `shell_exec` wrapped to keep each call's command and result. */
function recordingShell(options: AgentToolOptions, calls: ShellCall[]): AgentToolOptions {
  const tools = options.tools.map((tool): CustomTool => {
    if (tool.name !== 'shell_exec') return tool
    return {
      ...tool,
      handler: async (input, context) => {
        const output = await tool.handler(input, context)
        const command = String((input as { command?: unknown }).command ?? '')
        calls.push({ command, result: typeof output === 'string' ? JSON.parse(output) : (output as ShellCall['result']) })
        return output
      },
    }
  })
  return { ...options, tools }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** `apps/theoclaw/files`: a tool root in the checkout would mean the run wrote into it (EC-11). */
const CHECKOUT_TOOL_ROOT = fileURLToPath(new URL('../../files', import.meta.url))

describe.skipIf(!LIVE)('the sandbox against a real model', () => {
  it("a real model's shell write outside the workspace fails under workspace-write", { timeout: 120_000 }, async () => {
    expect(resolveSandboxPosture({ mode: 'workspace-write' }).enforced, 'this check needs an enforced sandbox (bwrap)').toBe(true)
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const outside = mkdtempSync(join(dirname(workspace.path), 'outside-'))
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
    // The test process itself can write there: only the sandbox stands between the shell and it.
    writeFileSync(join(outside, 'probe'), 'probe')
    unlinkSync(join(outside, 'probe'))
    const target = join(outside, 'x')
    // Read before and after the run, not once per file: other offline suites running in parallel
    // create `files/` in the checkout, and this check is about what this run did.
    const checkoutToolRootBefore = existsSync(CHECKOUT_TOOL_ROOT)

    const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'workspace-write' }, workspace.path)
    checkHostToolsPosture(settings, [])
    expect(settings.sandboxMode).toBe('workspace-write')
    const calls: ShellCall[] = []
    const { model, apiKey } = liveModel()
    const agent = await createTheoClawAgent(
      theoClawAgentOptions({ model, apiKey, toolOptions: recordingShell(agentToolOptions(settings), calls) }),
    )
    let outcome: { readonly status: string; readonly usage?: { readonly requests?: readonly unknown[] } }
    try {
      const run = await agent.send(
        `Use the shell_exec tool to run exactly this command: echo x > ${target}\nThen reply with the exit code it reported and nothing else.`,
        { maxIterations: MAX_ITERATIONS },
      )
      outcome = await run.wait()
    } catch (error) {
      throw new Error(`the run failed after ${calls.length} recorded shell calls: ${JSON.stringify(calls)}`, { cause: error })
    } finally {
      await agent[Symbol.asyncDispose]()
    }

    const attempts = calls.filter((call) => call.command.includes(outside))
    expect(attempts.length, `no shell_exec call named ${outside}: ${JSON.stringify(calls)}`).toBeGreaterThan(0)
    for (const attempt of attempts) {
      expect(attempt.result.ok, JSON.stringify(attempt)).toBe(true)
      expect(attempt.result.exit_code, JSON.stringify(attempt)).not.toBe(0)
      expect(attempt.result.stderr, JSON.stringify(attempt)).toMatch(/Read-only file system/)
    }
    expect(existsSync(target)).toBe(false)
    expect(existsSync(CHECKOUT_TOOL_ROOT), 'the run made a tool root in the checkout').toBe(checkoutToolRootBefore)
    expect(outcome.usage, 'the run reported no usage').toBeDefined()
    expect(outcome.usage?.requests?.length ?? 1).toBeLessThanOrEqual(MAX_REQUESTS)
  })
})
