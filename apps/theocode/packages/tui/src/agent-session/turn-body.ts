import type { ReasoningEffort } from '@theocode/agent/config'
import type { AttachedImage } from '@theocode/agent/context'

import type { TurnBody } from './chat-transport.js'

/** What a caller passes to `send`: the text, and at most a model for this one turn. */
export type TurnInput = { message: string; model?: string }

export interface TurnSession {
  effort: () => ReasoningEffort
  sessionModel: () => string | undefined
  /** Pending `/image` attachments. Reading clears them: they belong to the next turn dispatched. */
  takeImages: () => AttachedImage[] | undefined
}

/**
 * The body one turn travels with, built when the turn is dispatched: the persistent session values
 * (effort, pinned model), a model the caller named for this turn only (it wins), and the pending
 * images, consumed here so they apply to this turn alone.
 */
export function buildTurnBody(session: TurnSession, input: TurnInput): TurnBody {
  const images = session.takeImages()
  const model = input.model ?? session.sessionModel()
  return {
    message: input.message,
    effort: session.effort(),
    ...(model === undefined ? {} : { model }),
    ...(images === undefined ? {} : { images }),
  }
}
