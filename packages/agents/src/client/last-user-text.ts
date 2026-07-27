import type { UIMessage } from 'ai'

/**
 * M41/M42 — extract the turn text from the last user message's text parts. Shared by the transports
 * that hand a plain `message` string to an in-process/push runner (`InProcessTransport`,
 * `ChannelTransport`) rather than POSTing the `messages[]` array (`HttpTransport`). One definition (G12).
 */
export function extractLastUserText(messages: readonly UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const text = message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('')
    if (text.length > 0) return text
  }
  return ''
}
