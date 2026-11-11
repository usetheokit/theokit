import { Agent } from '@theokit/sdk'

import { describeError } from '../control-plane/errors.js'
import { requireModel } from '../control-plane/settings.js'

/** `THEOCLAW_ADVISOR=on` turns the advisor on (OC-118); it is off by default. */
export const ADVISOR_VARIABLE = 'THEOCLAW_ADVISOR'

/** Approved advice is cut to this many words. */
export const ADVICE_MAX_WORDS = 120

/** Exchanges of a session the reviewer is shown. */
const HISTORY_LIMIT = 8

export interface AdvisorExchange {
  readonly user: string
  readonly answer: string
}

/** One model call on the session's model: the instruction, then the text it answers. */
export type AdvisorAsk = (instruction: string, input: string) => Promise<string>

export interface AdvisorSettings {
  /** Advice for the turn about to run on `prompt`, or undefined when no correction is approved. */
  review(history: readonly AdvisorExchange[], prompt: string): Promise<string | undefined>
  readonly write: (line: string) => void
}

const REVIEW = `You review a fork of a conversation between a user and an assistant, before the assistant answers the user's latest message. Say, in at most ${String(ADVICE_MAX_WORDS)} words, what the assistant must know to answer well: for example that the requested work was already done earlier in the conversation, or that an earlier answer was wrong. If the assistant needs no correction, answer exactly NONE.`
const VERIFY = `A draft correction was written for an assistant about to answer the user's latest message. Check it against the conversation. If it is accurate and useful, answer with the correction, at most ${String(ADVICE_MAX_WORDS)} words. Otherwise answer exactly NONE.`

const render = (history: readonly AdvisorExchange[], prompt: string): string =>
  [...history.map((turn) => `User: ${turn.user}\nAssistant: ${turn.answer}`), `User (latest): ${prompt}`].join('\n\n')

/** The advice in `text`, cut to the word limit; undefined for NONE or nothing. */
export function approvedAdvice(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || /^none\b\.?$/i.test(trimmed)) return undefined
  return trimmed.split(/\s+/).slice(0, ADVICE_MAX_WORDS).join(' ')
}

/** Reviews on one fork and verifies the draft on a second; only an approved draft is advice. */
export function createAdvisor(ask: AdvisorAsk, write: (line: string) => void): AdvisorSettings {
  return {
    write,
    async review(history, prompt) {
      const conversation = render(history, prompt)
      const draft = approvedAdvice(await ask(REVIEW, conversation))
      if (draft === undefined) return undefined
      return approvedAdvice(await ask(VERIFY, `${conversation}\n\nDraft correction: ${draft}`))
    },
  }
}

/** `THEOCLAW_ADVISOR=on` and the session's model as the reviewer; undefined while off. `ask` replaces the model in tests. */
export function readAdvisorSettings(
  env: Readonly<Record<string, string | undefined>>,
  write: (line: string) => void,
  ask?: AdvisorAsk,
): AdvisorSettings | undefined {
  if ((env[ADVISOR_VARIABLE] ?? '').trim().toLowerCase() !== 'on') return undefined
  const model =
    ask ??
    (async (instruction, input) => {
      const { model: id, modelKey } = requireModel(env)
      const result = await Agent.prompt(input, { model: id, apiKey: modelKey, systemPrompt: `${instruction} Do not use tools.` })
      return result.result ?? ''
    })
  return createAdvisor(model, write)
}

/** The recent exchanges of each session, for the reviewer. */
export class AdvisorHistory {
  readonly #turns = new Map<string, AdvisorExchange[]>()

  of(key: string): readonly AdvisorExchange[] {
    return this.#turns.get(key) ?? []
  }

  record(key: string, exchange: AdvisorExchange): void {
    this.#turns.set(key, [...this.of(key), exchange].slice(-HISTORY_LIMIT))
  }
}

/** The note that steers the running turn. */
export function steerNote(advice: string): string {
  return `[advisor note] ${advice}`
}

/** A review that fails is one log line, never a failed turn. */
export async function reviewQuietly(settings: AdvisorSettings, history: readonly AdvisorExchange[], prompt: string): Promise<string | undefined> {
  try {
    return await settings.review(history, prompt)
  } catch (error) {
    settings.write(`advisor: review failed: ${describeError(error)}`)
    return undefined
  }
}
