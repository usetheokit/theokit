import type { AgentEvent } from '../core/contracts/agent-events.js'

/**
 * A correlated, UI-facing view of one tool invocation (M5-2).
 *
 * `foldAgentToolCards` correlates a `tool_call` with its `tool_result` (by
 * `id`, falling back to FIFO-by-name) into a single card so consumers stop
 * hand-rolling `switch(event.type)`.
 */
export interface AgentToolCard {
  /** Correlation id (the event `id`, or a synthesized `tool-<index>`). */
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'success' | 'error'
  /** The `tool_result.data` payload, once the result arrives. */
  result?: unknown
}

/**
 * Classifies a `tool_result.data` payload as success/error. Injectable so the
 * correlator is decoupled from any specific tool-result envelope shape.
 */
export type ToolEnvelopeResolver = (data: unknown) => { error: boolean }

export interface FoldAgentToolCardsOptions {
  /** Override the default envelope classifier. */
  resolveEnvelope?: ToolEnvelopeResolver
}

/**
 * Default envelope resolver: an object (or a JSON STRING parsing to an object)
 * with `ok === false` is an error; everything else is success (conservative).
 * sdk-tools handlers return a JSON STRING, so string parsing is intentional.
 */
export function defaultResolveEnvelope(data: unknown): { error: boolean } {
  return { error: coerceObject(data)?.ok === false }
}

function coerceObject(data: unknown): { ok?: unknown } | undefined {
  if (typeof data === 'object' && data !== null) return data
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data)
      if (typeof parsed === 'object' && parsed !== null) return parsed
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Fold an `AgentEvent[]` into correlated {@link AgentToolCard}s (M5-2). Pure.
 *
 * Correlation: a `tool_result` matches its `tool_call` by `id` when both carry
 * one; otherwise it matches the oldest still-`running` card with the same
 * `name` (FIFO). An unmatched `tool_result` becomes its own finished card.
 * A `tool_call` with no result stays `running`. The error status comes from
 * `options.resolveEnvelope` (default {@link defaultResolveEnvelope}).
 */
export function foldAgentToolCards(
  events: readonly AgentEvent[],
  options: FoldAgentToolCardsOptions = {},
): AgentToolCard[] {
  const resolve = options.resolveEnvelope ?? defaultResolveEnvelope
  const cards: AgentToolCard[] = []
  const byId = new Map<string, AgentToolCard>()
  const runningByName = new Map<string, AgentToolCard[]>()

  events.forEach((event, index) => {
    if (event.type === 'tool_call') {
      const card: AgentToolCard = {
        id: event.id ?? `tool-${index}`,
        name: event.name,
        args: event.args,
        status: 'running',
      }
      cards.push(card)
      if (event.id !== undefined) byId.set(event.id, card)
      else pushRunning(runningByName, event.name, card)
    } else if (event.type === 'tool_result') {
      const card = matchResultCard(event, index, byId, runningByName, cards)
      card.result = event.data
      card.status = resolve(event.data).error ? 'error' : 'success'
    }
  })

  return cards
}

function pushRunning(
  runningByName: Map<string, AgentToolCard[]>,
  name: string,
  card: AgentToolCard,
): void {
  const queue = runningByName.get(name)
  if (queue) queue.push(card)
  else runningByName.set(name, [card])
}

function matchResultCard(
  event: Extract<AgentEvent, { type: 'tool_result' }>,
  index: number,
  byId: Map<string, AgentToolCard>,
  runningByName: Map<string, AgentToolCard[]>,
  cards: AgentToolCard[],
): AgentToolCard {
  if (event.id !== undefined) {
    const byIdCard = byId.get(event.id)
    if (byIdCard) return byIdCard
  }
  const queue = runningByName.get(event.name)
  const fifo = queue?.shift()
  if (fifo) return fifo
  // Orphan result — surface it as its own finished card (never drop a result).
  const orphan: AgentToolCard = {
    id: event.id ?? `tool-${index}`,
    name: event.name,
    args: {},
    status: 'running',
  }
  cards.push(orphan)
  return orphan
}
