import type { AgentOutputEvent } from '../agent-output-event.js'
import { WIRE_ERROR_CODE_PART, type WireChunk } from '../wire/chunk-schema.js'

import { fromWireChunk } from './from-wire-chunk.js'

/** A stateful reader of the wire: carries what `fromWireChunk` asks its caller to thread. */
export interface WireReader {
  /** Translate one frame. Carries tool names and a pending error code across frames. */
  read(chunk: WireChunk): AgentOutputEvent[]
}

function codeOf(chunk: WireChunk): string | undefined {
  const data = (chunk as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const code = (data as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * Create a reader that remembers `callId → toolName` and the `code` of a `data-error-code` frame,
 * attaching that code to the next `error` event and then clearing it.
 */
export function createWireReader(): WireReader {
  const toolNames = new Map<string, string>()
  let pendingCode: string | undefined

  return {
    read(chunk) {
      if (chunk.type === 'tool-input-available') toolNames.set(chunk.toolCallId, chunk.toolName)
      if (chunk.type === WIRE_ERROR_CODE_PART) {
        pendingCode = codeOf(chunk)
        return []
      }
      const events = fromWireChunk(chunk, toolNames)
      if (chunk.type !== 'error') return events
      const code = pendingCode
      pendingCode = undefined
      if (code === undefined) return events
      return events.map((e) => (e.type === 'error' ? { ...e, code } : e))
    },
  }
}
