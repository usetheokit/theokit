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

/** The timeline events that carry conversation text. */
export interface ExportableMessage {
  readonly kind: 'message'
  readonly role: string
  readonly text: string
}

/**
 * The timeline is heterogeneous — thinking, tool and explored events sit alongside messages, and
 * only messages carry a role. Narrowing here lets callers pass the real `AgentEvent[]`.
 */
function isExportableMessage(event: unknown): event is ExportableMessage {
  if (typeof event !== 'object' || event === null) return false
  const candidate = event as { kind?: unknown; role?: unknown; text?: unknown }
  return (
    candidate.kind === 'message' &&
    typeof candidate.role === 'string' &&
    typeof candidate.text === 'string'
  )
}

const ROLE_HEADINGS: Readonly<Record<string, string>> = {
  user: 'You',
  assistant: AGENT.name,
  system: 'System',
}

/** The heading for a role, falling back to the role itself rather than dropping an unknown one. */
function headingFor(role: string): string {
  return ROLE_HEADINGS[role] ?? role
}

/**
 * The conversation as Markdown. Empty in, empty out — so the caller can say "nothing to export"
 * rather than write a file with a heading and nothing under it.
 */
export function conversationToMarkdown(events: readonly unknown[]): string {
  const blocks: string[] = []
  for (const message of events.filter(isExportableMessage)) {
    if (message.text.length === 0) continue
    blocks.push(`## ${headingFor(message.role)}\n\n${message.text}`)
  }
  return blocks.join('\n\n')
}

/**
 * The most recent assistant turn, or `undefined` when it has not spoken — not `''`, so the caller
 * can report "nothing to copy" instead of putting a blank on the clipboard and claiming success.
 */
export function lastAssistantText(events: readonly unknown[]): string | undefined {
  const messages = events.filter(isExportableMessage)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message === undefined || message.role !== 'assistant') continue
    if (message.text.length > 0) return message.text
  }
  return undefined
}
