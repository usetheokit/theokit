import { DelegationError } from '@theokit/agents'
import type { DelegationPort, DelegationResult } from '@theokit/agents'
import { createCodeMode } from '@theokit/agents/code-mode'
import { createQuickJsSandbox } from '@theokit/agents/code-mode-quickjs'
import { createDelegateAllTool } from '@theokit/agents/tools'
import type { CustomTool } from '@theokit/sdk'

import type { TurnAgent } from '../agent-port.js'
import { describeError } from '../control-plane/errors.js'
import { vetoToolCall } from './path-veto.js'
import type { ToolSettings } from './tool-settings.js'

/** The longest script result `run_code` hands back to the model (NFR-004). */
const MAX_RESULT_CHARACTERS = 16_384

/** The only tools a script may call: they read, and change nothing on the host (plan D3). */
const SCRIPT_TOOL_NAMES: ReadonlySet<string> = new Set(['read_file', 'list_dir', 'web_fetch', 'web_search'])

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
    tools: [...tools],
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
    handler: async (input) => {
      const result = await tool.handler(input)
      if (result.length > MAX_RESULT_CHARACTERS) throw new CodeModeResultTooLongError(result.length)
      return result
    },
  }
}

/** Drain the run's stream and return the code of the first error event, if any. */
async function streamedErrorOf(run: Awaited<ReturnType<TurnAgent['send']>>): Promise<string | undefined> {
  let streamed: string | undefined
  for await (const message of run.stream()) {
    if (message.type === 'error') streamed ??= String((message as { code?: unknown }).code ?? 'error')
  }
  return streamed
}

async function disposeWorker(agent: TurnAgent): Promise<void> {
  const dispose = (agent as Partial<AsyncDisposable>)[Symbol.asyncDispose]
  if (typeof dispose === 'function') await dispose.call(agent)
}

/**
 * The one roster entry of `delegate_all`: each task gets a fresh worker, runs one turn, and is
 * disposed. Every way a worker can fail, its build and its disposal included, is a
 * `DelegationError`, so `delegate_all` reports it beside the other tasks instead of ending the
 * parent's turn (EC-3).
 */
function workerPort(createWorker: CreateWorker): DelegationPort {
  return {
    run: async (task): Promise<DelegationResult> => {
      try {
        return await runWorker(createWorker, task)
      } catch (error) {
        throw error instanceof DelegationError ? error : new DelegationError('worker', error)
      }
    },
  }
}

/**
 * One worker turn: built, run and disposed. A build that fails, a run that does not finish and a
 * disposal that throws all reject: a worker whose disposal failed is in a state nobody knows, as a
 * `/control` turn's is (`runTheoClawTurn`).
 */
async function runWorker(createWorker: CreateWorker, task: string): Promise<DelegationResult> {
  const agent = await createWorker()
  let outcome: DelegationResult
  try {
    const run = await agent.send(task)
    const streamed = await streamedErrorOf(run)
    const result = await run.wait()
    if (streamed !== undefined) throw new Error(`the worker's run streamed an error (${streamed})`)
    if (result.status !== 'finished') throw new Error(`the worker's run ended with status ${result.status}`)
    // The SDK accounts the worker's cost; this port reports none it measured (plan D4).
    outcome = { response: result.result ?? '', toolCalls: [], cost: 0, costUnknown: true, tokens: 0 }
  } catch (error) {
    // The disposal still runs; if it fails too, both failures are reported, the run's first.
    try {
      await disposeWorker(agent)
    } catch (disposal) {
      throw new AggregateError(
        [error, disposal],
        `${describeError(error)}; disposing the worker then failed: ${describeError(disposal)}`,
      )
    }
    throw error
  }
  await disposeWorker(agent)
  return outcome
}

/** `delegate_all` over one `worker` roster entry: up to four read-only workers at once. */
export function delegateAllTool(createWorker: CreateWorker): CustomTool {
  return createDelegateAllTool({ roster: [{ name: 'worker', target: workerPort(createWorker) }] })
}
