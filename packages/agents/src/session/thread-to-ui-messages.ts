import type { WireMessage as UIMessage, WireMessagePart } from '@theokit/presenter/wire'

type Row = Record<string, unknown>
type Block = Record<string, unknown>
type MutablePart = { -readonly [K in keyof WireMessagePart]: WireMessagePart[K] }

const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null

/** The text of a tool result's `content`: a string, or the text blocks of an array, else JSON. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts = content.flatMap((b) =>
      isRecord(b) && b.type === 'text' && typeof b.text === 'string' ? [b.text] : [],
    )
    if (texts.length === content.length) return texts.join('')
  }
  return JSON.stringify(content)
}

function blocksOf(content: unknown): Block[] {
  if (Array.isArray(content)) return (content as unknown[]).filter(isRecord)
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return []
}

function settle(part: MutablePart, block: Block): void {
  if (block.is_error === true) {
    part.state = 'output-error'
    part.errorText = resultText(block.content)
  } else {
    part.state = 'output-available'
    part.output = block.content
  }
}

/** One block to a part; a `tool_result` settles its call's part instead and yields nothing. */
function blockToPart(block: Block, tools: Map<string, MutablePart>): WireMessagePart | undefined {
  if (block.type === 'text' && typeof block.text === 'string') {
    return { type: 'text', text: block.text }
  }
  if (block.type === 'thinking' && typeof block.thinking === 'string') {
    return { type: 'reasoning', text: block.thinking }
  }
  if (block.type === 'tool_use' && typeof block.id === 'string') {
    const part: MutablePart = {
      type: 'dynamic-tool',
      toolName: block.name,
      toolCallId: block.id,
      state: 'input-available',
      input: block.input,
    }
    tools.set(block.id, part)
    return part
  }
  if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
    const part = tools.get(block.tool_use_id)
    if (part !== undefined) settle(part, block)
  }
  return undefined
}

function idOf(row: Row, message: Row, index: number): string {
  if (typeof message.id === 'string') return message.id
  if (typeof row.uuid === 'string') return row.uuid
  return `row-${String(index)}`
}

/**
 * Convert raw transcript rows (what `readThreadHistory` returns) into the UI messages the web and
 * terminal kits render, in the order given.
 *
 * - `tool_use` becomes a `dynamic-tool` part in `input-available`; the `tool_result` that answers it
 *   (found in a later row) moves it to `output-available`, or `output-error` when `is_error` is set.
 *   A call with no result stays `input-available`.
 * - A user row that only carries tool results is not a message: it settles parts of the assistant
 *   message before it. Assistant rows separated only by such rows merge into ONE assistant message.
 * - Rows without a message (compaction boundaries, other system records) are skipped. The rows are
 *   taken as given: no branch is selected and nothing compacted is recovered.
 */
export function threadToUIMessages(rows: readonly Record<string, unknown>[]): UIMessage[] {
  const messages: UIMessage[] = []
  const tools = new Map<string, MutablePart>()

  for (const row of rows) {
    const message = row.message
    if (!isRecord(message) || (row.type !== 'user' && row.type !== 'assistant')) continue
    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const parts = blocksOf(message.content).flatMap((b) => blockToPart(b, tools) ?? [])
    if (parts.length === 0) continue

    const last = messages.at(-1)
    if (role === 'assistant' && last?.role === 'assistant') last.parts.push(...parts)
    else messages.push({ id: idOf(row, message, messages.length), role, parts })
  }
  return messages
}
