import type { WireMessage as UIMessage, WireMessagePart } from '@theokit/presenter/wire'

export type TranscriptFormat = 'text' | 'jsonl' | 'markdown'

export interface TranscriptToTextOptions {
  /** Defaults to `'text'`. */
  readonly format?: TranscriptFormat
}

const json = (v: unknown): string => JSON.stringify(v)

function textOf(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .join('')
}

function toolLine(part: WireMessagePart): string | undefined {
  if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) return undefined
  const name = typeof part.toolName === 'string' ? part.toolName : part.type.slice(5)
  let result = ''
  if (part.state === 'output-available') result = ` -> ${json(part.output)}`
  else if (part.state === 'output-error') result = ` -> error: ${String(part.errorText)}`
  return `${name}(${json(part.input)})${result}`
}

/**
 * Render UI messages (from `threadToUIMessages` or a `useAgent` thread) as a transcript:
 * `text` is `role: text` lines, `jsonl` is one message object per line, `markdown` is a heading per
 * message. Tool calls are listed after the message's text.
 */
export function transcriptToText(
  messages: readonly UIMessage[],
  options: TranscriptToTextOptions = {},
): string {
  const format = options.format ?? 'text'
  if (format === 'jsonl') return messages.map((m) => JSON.stringify(m)).join('\n')

  const blocks = messages.map((m) => {
    const tools = m.parts.flatMap((p) => toolLine(p) ?? [])
    const text = textOf(m)
    if (format === 'markdown') {
      const body = [
        text,
        ...(tools.length > 0 ? [tools.map((t) => `- \`${t}\``).join('\n')] : []),
      ].filter((s) => s !== '')
      return [`## ${m.role}`, ...body].join('\n\n')
    }
    return [`${m.role}: ${text}`, ...tools.map((t) => `  [tool] ${t}`)].join('\n')
  })
  return blocks.join(format === 'markdown' ? '\n\n' : '\n')
}
