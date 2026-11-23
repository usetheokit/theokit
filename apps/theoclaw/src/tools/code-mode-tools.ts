import { DelegationError } from '@theokit/agents'
import type { DelegationPort, DelegationResult } from '@theokit/agents'
import { delegationPortFromAgentFactory } from '@theokit/agents/bridge'
import { createCodeMode } from '@theokit/agents/code-mode'
import { createQuickJsSandbox } from '@theokit/agents/code-mode-quickjs'
import { createDelegateAllTool, createDelegateTool } from '@theokit/agents/tools'
import type { CustomTool } from '@theokit/sdk'

import type { TurnAgent, TurnMessage } from '../agent-port.js'
import { vetoToolCall } from './path-veto.js'
import type { ToolSettings } from './tool-settings.js'

/** The longest script result `run_code` hands back to the model (NFR-004). */
const MAX_RESULT_CHARACTERS = 16_384

/** The only tools a script may call: they read, and change nothing on the host (plan D3). */
const SCRIPT_TOOL_NAMES: ReadonlySet<string> = new Set(['read_file', 'list_dir', 'web_fetch', 'web_search'])

/**
 * The longest `web_fetch` a script may ask for: the sandbox's own deadline. The shipped `web_fetch`
 * ignores the run's abort, so its own timeout is what bounds it once the run has ended (B-697 D3).
 */
const SCRIPT_WEB_FETCH_TIMEOUT_MS = 10_000

/**
 * What the generated instructions do not say: the sandbox runs JavaScript. Measured on a real model
 * (gemini-2.5-flash-lite, 2026-10-31): told only "an async function body", it wrote Python three
 * times in a row and the run ended in error; told the language, it once left a `Promise.all(...).then`
 * chain unreturned and got null.
 */
const SCRIPT_LANGUAGE = [
  'The code is JavaScript (ECMAScript 2023), not Python. It runs as the body of an async function:',
  'call `const file = await api.read_file({ path: "a.txt" })`, read `file.content`, and end with `return <value>`.',
  'Each api call takes one object argument and resolves to the tool\'s answer, parsed when it is JSON.',
  'Await every call and `return` the final value at the top level of the code: a value that is not returned is lost, and the tool answers null.',
].join(' ')

/** Builds one worker: a fresh agent holding only the read-only tools (plan D4). */
export type CreateWorker = () => Promise<TurnAgent>

/** A script's result too long to hand back to the model. */
class CodeModeResultTooLongError extends Error {
  override readonly name = 'CodeModeResultTooLongError'

  constructor(readonly length: number) {
    super(
      `run_code: the script's result is ${String(length)} characters, past the ${String(MAX_RESULT_CHARACTERS)} a tool result may carry; return a smaller value`,
    )
  }
}

/**
 * `run_code`: the agent's script calls the read-only `tools` as `api.<name>(input)` inside QuickJS,
 * and only its return value reaches the model (plan D3). A script's call runs the handler directly,
 * outside the SDK's `pre_tool_call` plugins, so the gate applies the same path veto itself, and
 * grants no tool outside `SCRIPT_TOOL_NAMES`, whatever `tools` holds.
 */
export function codeModeTool(tools: readonly CustomTool[], settings: ToolSettings): CustomTool {
  const { tool, instructions } = createCodeMode({
    tools: cappedScriptTools(tools),
    sandbox: createQuickJsSandbox(),
    onPermissionRequest: ({ tool: name, args }) => {
      if (!SCRIPT_TOOL_NAMES.has(name)) return { granted: false, reason: `${name} is not one of the tools a script may call` }
      const refusal = vetoToolCall(name, args, settings)
      return refusal === undefined ? { granted: true } : { granted: false, reason: refusal }
    },
  })
  return {
    ...tool,
    description: `${SCRIPT_LANGUAGE}\n\n${instructions}`,
    // The run's signal reaches the sandbox, which ends the script and its host calls on abort.
    handler: async (input, ctx) => {
      const result = await tool.handler(input, ctx?.signal === undefined ? undefined : { signal: ctx.signal })
      if (result.length > MAX_RESULT_CHARACTERS) throw new CodeModeResultTooLongError(result.length)
      return result
    },
  }
}

/** The `timeout_ms` a script's `web_fetch` runs with: what it asked for, if positive, up to the cap. */
function scriptFetchTimeout(asked: unknown): number {
  const value = Number(asked)
  return value > 0 ? Math.min(value, SCRIPT_WEB_FETCH_TIMEOUT_MS) : SCRIPT_WEB_FETCH_TIMEOUT_MS
}

/** The script's tools, with `web_fetch`'s `timeout_ms` held at `SCRIPT_WEB_FETCH_TIMEOUT_MS` at most. */
function cappedScriptTools(tools: readonly CustomTool[]): CustomTool[] {
  return tools.map((tool) =>
    tool.name !== 'web_fetch'
      ? tool
      : {
          ...tool,
          handler: (input, ctx) => tool.handler({ ...input, timeout_ms: scriptFetchTimeout(input.timeout_ms) }, ctx),
        },
  )
}

/** The one roster entry of `delegate_all`: each task gets a fresh worker, runs one turn, and is disposed (EC-3). */
function workerPort(createWorker: CreateWorker): DelegationPort {
  return delegationPortFromAgentFactory(createWorker)
}

/**
 * One worker turn: built, run and disposed. A build that fails, a run that does not finish and a
 * disposal that throws all reject: a worker whose disposal failed is in a state nobody knows, as a
 * `/control` turn's is (`runTheoClawTurn`). The framework port wraps an ordinary failure in a
 * `DelegationError`; the caller here reads the underlying error.
 */
export async function runWorker(
  createWorker: CreateWorker,
  task: TurnMessage,
  signal: AbortSignal | undefined,
): Promise<DelegationResult> {
  try {
    return await delegationPortFromAgentFactory(createWorker).run(task, signal === undefined ? {} : { signal })
  } catch (error) {
    throw error instanceof DelegationError && error.agentName === 'worker' ? error.cause : error
  }
}

/** The `worker` entry, and a `coder` entry (a coding task in its own git worktree, OC-83) where one is available. */
function rosterOf(createWorker: CreateWorker, coder: DelegationPort | undefined, cloud?: DelegationPort) {
  return [
    { name: 'worker', target: workerPort(createWorker) },
    ...(coder === undefined ? [] : [{ name: 'coder', target: coder }]),
    ...(cloud === undefined ? [] : [{ name: 'cloud', target: cloud }]),
  ]
}

/** `delegate_all` over one `worker` roster entry: up to four read-only workers at once. */
export function delegateAllTool(createWorker: CreateWorker, coder?: DelegationPort, cloud?: DelegationPort): CustomTool {
  return createDelegateAllTool({ roster: rosterOf(createWorker, coder, cloud) })
}

/** `delegate` over the same `worker` roster entry: one read-only worker, its answer returned to the parent (B-611). */
export function delegateTool(createWorker: CreateWorker, coder?: DelegationPort, cloud?: DelegationPort): CustomTool {
  return createDelegateTool({ roster: rosterOf(createWorker, coder, cloud) })
}
