import { useMemo } from 'react'

import {
  type AgentToolCard,
  type FoldAgentToolCardsOptions,
  foldAgentToolCards,
} from './agent-tool-cards.js'
import {
  type UseAgentStreamOptions,
  type UseAgentStreamReturn,
  useAgentStream,
} from './use-agent-stream.js'

/** {@link useAgentToolCards} return — the stream result plus correlated tool cards. */
export interface UseAgentToolCardsReturn<TBody = unknown> extends UseAgentStreamReturn<TBody> {
  /** Correlated tool cards folded from the stream events (M5-2). */
  toolCards: AgentToolCard[]
}

/**
 * `useAgentStream` + correlated tool cards (M5-2). Composes the stream hook with
 * the pure {@link foldAgentToolCards} reducer; pass `resolveEnvelope` to classify
 * tool-result payloads (default flags `{ ok: false }` envelopes as errors).
 */
export function useAgentToolCards<TBody = unknown>(
  path: string,
  options: UseAgentStreamOptions & FoldAgentToolCardsOptions = {},
): UseAgentToolCardsReturn<TBody> {
  const { resolveEnvelope, ...streamOptions } = options
  const stream = useAgentStream<TBody>(path, streamOptions)
  const toolCards = useMemo(
    () => foldAgentToolCards(stream.events, { resolveEnvelope }),
    [stream.events, resolveEnvelope],
  )
  return { ...stream, toolCards }
}
