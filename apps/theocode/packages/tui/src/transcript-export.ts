/**
 * B-075 — turning the timeline into text that can leave the terminal.
 *
 * Serialized from the EVENT DATA, never from the rendered frame. The render hard-wraps every line
 * to the width of a bordered box, which re-flows the code an answer usually contains — so an export
 * built from the frame would reproduce the exact damage this exists to avoid.
 *
 * The shape below was MEASURED, not assumed, and the first version of this file got it wrong: it
 * expected `{ role, parts[] }` (the message shape the SDK takes as INPUT) when the timeline holds
 * `AgentEvent` (`{ id, kind, role, text }`, what `deriveTimeline` produces as OUTPUT). Every event
 * was rejected, `/export` reported an empty conversation, and the unit tests passed because they
 * were built from the same wrong assumption. Live validation is what caught it.
 */
import { AGENT } from '@theocode/shared/agent'
import {
  agentEventsToMarkdown,
  lastAssistantText as frameworkLastAssistantText,
  type AgentEvent,
} from '@theokit/tui'

/**
 * The conversation as Markdown. Empty in, empty out — so the caller can say "nothing to export"
 * rather than write a file with a heading and nothing under it. The framework skips every event
 * that is not a message, so the heterogeneous timeline can be passed as it is.
 */
export function conversationToMarkdown(events: readonly unknown[]): string {
  return agentEventsToMarkdown(events as readonly AgentEvent[], {
    roleHeadings: { assistant: AGENT.name },
  })
}

/**
 * The most recent assistant turn, or `undefined` when it has not spoken — not `''`, so the caller
 * can report "nothing to copy" instead of putting a blank on the clipboard and claiming success.
 */
export function lastAssistantText(events: readonly unknown[]): string | undefined {
  return frameworkLastAssistantText(events as readonly AgentEvent[])
}
