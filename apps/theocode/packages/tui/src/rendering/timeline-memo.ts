import {
  messagesToAgentEvents,
  type AgentEvent,
  type MessagesToEventsOptions,
  type UIMessageLike,
} from '@theokit/tui'

export type TimelineDeps = MessagesToEventsOptions

const CONTINUATION_MARK = '[[theokit:goal-continuation]]'
const COLLAPSED_CONTINUATION = '↻ continuing the goal…'

export function prepareThread(messages: readonly UIMessageLike[]): UIMessageLike[] {
  return messages.map((m) => {
    if (m.role !== 'user') return m
    const text = m.parts
      .filter((pt) => pt.type === 'text')
      .map((pt) => pt.text ?? '')
      .join('')
    if (!text.startsWith(CONTINUATION_MARK)) return m
    return { ...m, parts: [{ type: 'text', text: COLLAPSED_CONTINUATION }] }
  })
}

export function deriveTimeline(
  messages: readonly UIMessageLike[],
  deps: TimelineDeps,
): AgentEvent[] {
  return messagesToAgentEvents(messages, deps).filter(
    (e) => e.kind !== 'tool' || e.status === 'success' || e.status === 'failed',
  )
}
