/**
 * The two wrappers that sit between `toAgentFactory` and the handle it serves.
 *
 * Extracted from `sdk-adapter.ts` when adding `generate` to the handle pushed that file past its
 * 500-line budget. The seam is not arbitrary: both functions answer one question — "what does this
 * handle do that the SDK's own does not?" — and neither knows how the agent was created.
 *
 * They are ordinary exports rather than `_`-prefixed test seams. Reaching them through
 * `toAgentFactory` needs an SDK runtime, an api key and a session, none of which is the thing under
 * test; a module of their own makes the honest import the normal one.
 *
 * @internal
 */
import type { Guardrail } from '../guardrails/index.js'
import { GuardrailViolationError, runInputGuards, runOutputGuards } from '../guardrails/index.js'

import type { AgentStreamEvent } from './agent-stream-events.js'
import { type SdkMessage, translateSdkEvent } from './event-translator.js'
import { doneUsage } from './sdk-adapter-create-options.js'
import type { SdkAgentHandle, SdkSendOptions, SdkTurnHandle } from './sdk-adapter.js'

/**
 * theokit#363 — carry the declared step ceiling onto the handle {@link toAgentFactory} serves.
 *
 * The streaming path owns its own `send`, so `applyStepCeiling` reaches it directly. This path hands
 * the agent to someone else (ACP, the delegation surfaces) and never sees their `send` call, so the
 * ceiling has to travel as a DEFAULT on the handle. Without it, the same definition capped on
 * `mountAgent` ran uncapped over ACP — the shape of bypass theokit#139 fixed for guardrails.
 *
 * The caller's own `maxIterations` WINS (spread last): a host asking for a different ceiling on one
 * turn is the per-run override this layer already honors for `model` and `reasoningEffort`.
 */
export function withStepCeiling(
  handle: SdkAgentHandle<SdkMessage>,
  maxIterations: number | undefined,
): SdkAgentHandle<SdkMessage> {
  // Nothing declared ⇒ the original handle, untouched — no wrapper, no key, the SDK default stands.
  if (maxIterations === undefined) return handle
  return {
    get agentId() {
      return handle.agentId
    },
    dispose: () => handle.dispose(),
    ...forwardedMembers(handle),
    send: (msg: string, sendOpts?: SdkSendOptions) =>
      handle.send(msg, { maxIterations, ...sendOpts }),
  }
}

export function withGuardrails(
  handle: SdkAgentHandle<SdkMessage>,
  guardrails: readonly Guardrail[] | undefined,
): SdkAgentHandle<SdkMessage> {
  // No guards ⇒ the original handle, untouched. Wrapping unconditionally would put an await on the
  // hot path of every served agent to enforce an empty list.
  if (guardrails === undefined || guardrails.length === 0) return handle
  return {
    get agentId() {
      return handle.agentId
    },
    dispose: () => handle.dispose(),
    ...forwardedMembers(handle),
    send: async (msg: string, sendOpts?: SdkSendOptions): Promise<SdkTurnHandle<SdkMessage>> => {
      // BEFORE the SDK sees it: a guard that blocks must stop the prompt from reaching the model,
      // not merely annotate it afterwards.
      const guarded = await runInputGuards(msg, guardrails)
      return guardTurn(await handle.send(guarded, sendOpts), guardrails)
    },
  }
}

/**
 * The optional members both wrappers carry over unchanged, each bound to the wrapped handle.
 *
 * A wrapper that rebuilds the handle silently drops every member it does not name. `generate`: see
 * {@link SdkAgentHandle.generate} for why it is forwarded and not guarded. `pluginManager` (B-414):
 * the ACP server installs its permission plugin through it and fails closed without it, so a
 * wrapped agent could not be served in the server's default `ask` mode. It is bound because the
 * SDK's LocalAgent reads `this` in it.
 */
function forwardedMembers(
  handle: SdkAgentHandle<SdkMessage>,
): Pick<SdkAgentHandle, 'generate' | 'pluginManager'> {
  return {
    ...(handle.generate === undefined ? {} : { generate: handle.generate.bind(handle) }),
    ...(handle.pluginManager === undefined
      ? {}
      : { pluginManager: handle.pluginManager.bind(handle) }),
  }
}

/**
 * B-414 — the guarded turn, readable through `wait()` and through `stream()`.
 *
 * The ACP server reads `run.stream()` after `send()`, then `run.wait()`. Output guards moderate
 * whole text, so `stream()` cannot forward the inner turn's deltas without leaking what a guard
 * exists to redact: it yields ONE assistant message with the guarded text, once the guards ran. An
 * editor sees no token streaming and no tool activity for a guarded agent; that is the price.
 *
 * Both readers share one promise, so the guards run once per turn. It is created by whichever
 * reader comes first, never here: a run that fails, or a guard that blocks, before anybody reads
 * the turn would otherwise reject a promise nobody handles.
 *
 * A turn that fails never ends its stream empty, which a reader of `stream()` alone would take for a
 * finished turn with no text (loop-code-review LCR0104). A run resolved with `status: 'error'`, and
 * a guard that refuses (`GuardrailViolationError`), end it with the terminal message the SDK's own
 * stream emits for a failed run, `{ type: 'status', status: 'ERROR', message }`. Only `'error'` is
 * mapped, as in the SDK, whose stream ends a cancelled run with no status message. A guard's message
 * names the guard and its reason, which `wait()` already rejects with. Any other rejection is a
 * fault, not an outcome, so `stream()` rethrows it and `wait()` rejects with the same error. That
 * includes a guard defect such as `MalformedGuardrailResultError` (a `redact` with no text): a guard
 * written wrong is not a guard refusing (B-457).
 */
function guardTurn(
  turn: SdkTurnHandle<SdkMessage>,
  guardrails: readonly Guardrail[],
): SdkTurnHandle<SdkMessage> {
  let outcome: ReturnType<SdkTurnHandle['wait']> | undefined
  const guardedOutcome = (): ReturnType<SdkTurnHandle['wait']> =>
    (outcome ??= turn
      .wait()
      .then(async (out) =>
        out.result === undefined
          ? out
          : { ...out, result: await runOutputGuards(out.result, guardrails) },
      ))
  return {
    wait: guardedOutcome,
    async *stream() {
      let out: Awaited<ReturnType<SdkTurnHandle['wait']>>
      try {
        out = await guardedOutcome()
      } catch (err) {
        if (!(err instanceof GuardrailViolationError)) throw err
        yield errorStatus(err.message)
        return
      }
      if (out.result !== undefined) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: out.result }] } }
      }
      // `'run error'` when the run gave no message: the eval runner's own `run <status>` fallback.
      if (out.status === 'error') yield errorStatus(out.error?.message ?? 'run error')
    },
  }
}

/** The SDK's terminal message for a failed run, less the agent and run ids this layer never sees. */
function errorStatus(message: string): SdkMessage {
  return { type: 'status', status: 'ERROR', message }
}

/**
 * The boundary adapter from the served vocabulary to the typed bridge contract.
 *
 * `toAgentFactory` serves handles whose `stream()` yields `SdkMessage` (what ACP reads). This returns
 * the same handle with `stream()` yielding `AgentStreamEvent`, each message passed through
 * {@link translateSdkEvent} (a message may become zero or several events, and the run's `done`
 * arrives as the `FINISHED` status). Everything else is forwarded unchanged, bound to the original.
 */
export function withTypedStream(handle: SdkAgentHandle<SdkMessage>): SdkAgentHandle {
  return {
    get agentId() {
      return handle.agentId
    },
    dispose: () => handle.dispose(),
    ...forwardedMembers(handle),
    send: async (msg: string, sendOpts?: SdkSendOptions): Promise<SdkTurnHandle> => {
      const turn = await handle.send(msg, sendOpts)
      const source = turn.stream
      return {
        wait: () => turn.wait(),
        ...(source === undefined
          ? {}
          : {
              stream: async function* () {
                let terminal = false
                let failed = false
                for await (const message of source.call(turn)) {
                  for (const event of translateSdkEvent(message, message.run_id ?? '')) {
                    if (event.type === 'error') failed = true
                    if (event.type !== 'done') {
                      yield event
                      continue
                    }
                    terminal = true
                    yield doneFromOutcome(event, await turn.wait())
                  }
                }
                // A guarded turn's stream ends after its text without a FINISHED status; the typed
                // contract still owes the reader a terminal event, built from the run outcome.
                if (!terminal && !failed) {
                  const out = await turn.wait()
                  if (out.status === 'error') {
                    yield {
                      type: 'error',
                      code: 'AGENT_ERROR',
                      message: out.error?.message ?? 'run error',
                      retryable: false,
                    }
                  } else {
                    yield doneFromOutcome(
                      {
                        type: 'done',
                        result: '',
                        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                        durationMs: 0,
                      },
                      out,
                    )
                  }
                }
              },
            }),
      }
    },
  }
}

/** A `done` event carrying what the run reported: its result text and token usage. */
function doneFromOutcome(
  done: Extract<AgentStreamEvent, { type: 'done' }>,
  out: Awaited<ReturnType<SdkTurnHandle['wait']>>,
): AgentStreamEvent {
  if (out.usage === undefined) return { ...done, result: out.result ?? done.result }
  const usage = doneUsage(out.usage)
  // A run that reports only a total keeps it.
  if (usage.totalTokens === 0 && out.usage.totalTokens !== undefined) {
    usage.totalTokens = out.usage.totalTokens
  }
  return { ...done, result: out.result ?? done.result, usage }
}
