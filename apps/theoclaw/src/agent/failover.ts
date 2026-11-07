import type { TurnAgent, TurnMessage, TurnRun } from '../agent-port.js'

/** The thinking levels `THEOCLAW_THINKING` accepts (OC-48). */
export const THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** The level `THEOCLAW_THINKING` names; unset or blank is `undefined`, anything else is refused. */
export function parseThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  const trimmed = value?.trim().toLowerCase()
  if (trimmed === undefined || trimmed === '') return undefined
  if ((THINKING_LEVELS as readonly string[]).includes(trimmed)) return trimmed as ThinkingLevel
  throw new Error(`THEOCLAW_THINKING must be one of ${THINKING_LEVELS.join(', ')}`)
}

/** The secondary model `THEOCLAW_MODEL_FALLBACK` names (OC-47), or `undefined` when none is set. */
export function parseFallbackModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

type SendOptions = Parameters<TurnAgent['send']>[1]

/**
 * A run on the primary that falls over to the secondary within the same turn: when the primary's
 * send throws, or its run fails before streaming a single message, the same message is sent to the
 * secondary and its stream and result are the turn's. Once the primary has streamed output the
 * turn stays on it, so a reply is never doubled.
 */
function failoverRun(first: TurnRun, message: TurnMessage, options: SendOptions, secondary: () => Promise<TurnAgent>): TurnRun {
  let active = first
  return {
    async *stream() {
      let streamed = false
      let primaryError: unknown
      try {
        for await (const item of first.stream()) {
          streamed = true
          yield item
        }
      } catch (error) {
        if (streamed) throw error
        primaryError = error
      }
      if (streamed) return
      // No output from the primary: a thrown stream or a run that did not finish is a failure.
      const outcome = primaryError !== undefined ? { status: 'failed' } : await first.wait().catch(() => ({ status: 'failed' }))
      if (outcome.status === 'finished') return
      try {
        active = await (await secondary()).send(message, options)
      } catch (error) {
        throw new Error(`the primary model failed and so did the fallback: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
      yield* active.stream()
    },
    wait: () => (active === first ? first.wait() : active.wait()),
    cancel: () => active.cancel(),
  }
}

/** An agent that runs on `primary` and, when a turn cannot start or fails with no output, on `secondary`. */
export function withFailover(primary: TurnAgent, secondary: () => Promise<TurnAgent>): TurnAgent {
  return {
    async send(message, options) {
      let first: TurnRun
      try {
        first = await primary.send(message, options)
      } catch {
        return (await secondary()).send(message, options)
      }
      return failoverRun(first, message, options, secondary)
    },
  }
}
