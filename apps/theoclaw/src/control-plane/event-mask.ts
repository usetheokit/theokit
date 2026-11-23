import { maskSecrets } from '../channels/channel-loop.js'
import { Security } from '@theokit/sdk'
import type { AgentStreamEvent } from '@theokit/agents/bridge'

import type { TurnEvent } from './turn.js'

/** Where one turn's events go, masked; `flush` releases the text still held as a `text_delta`. */
export interface EventMask {
  readonly emit: (event: TurnEvent) => void
  readonly flush: () => void
}

/**
 * Every string in `value`, nested objects and arrays included, masked; the shape is kept. Walked,
 * not round-tripped through JSON, so the escaping of what a client receives does not change.
 */
function maskValue<T>(value: T, secrets: readonly string[]): T
function maskValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return maskSecrets(value, secrets)
  if (Array.isArray(value)) return value.map((item) => maskValue(item, secrets))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskValue(item, secrets)]))
  }
  return value
}

function maskRecord(value: Record<string, unknown>, secrets: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskValue(item, secrets)]))
}

/**
 * The event with every string in it masked, as the same variant: each known field is masked where
 * the variant declares it, the free-form ones (`input`, `data`, `event`, ...) through `maskValue`.
 */
function maskEvent(event: AgentStreamEvent, secrets: readonly string[]): AgentStreamEvent {
  const m = (text: string): string => maskSecrets(text, secrets)
  switch (event.type) {
    case 'run_started':
      return {
        ...event,
        runId: m(event.runId),
        agentName: m(event.agentName),
        ...(event.model === undefined ? {} : { model: m(event.model) }),
      }
    case 'text_delta':
      return { ...event, content: m(event.content) }
    case 'thinking':
      return { ...event, content: m(event.content) }
    case 'tool_call':
    case 'partial_tool_call':
      return { ...event, callId: m(event.callId), toolName: m(event.toolName), input: maskValue(event.input, secrets) }
    case 'tool_result':
      return {
        ...event,
        callId: m(event.callId),
        toolName: m(event.toolName),
        output: m(event.output),
        ...(event.refusal === undefined ? {} : { refusal: maskValue(event.refusal, secrets) }),
      }
    case 'iteration':
    case 'checkpoint_saved':
      return event
    case 'approval_required':
      return {
        ...event,
        callId: m(event.callId),
        toolName: m(event.toolName),
        question: m(event.question),
        callbackUrl: m(event.callbackUrl),
        ...(event.input === undefined ? {} : { input: maskValue(event.input, secrets) }),
        ...(event.payloadSchema === undefined ? {} : { payloadSchema: maskRecord(event.payloadSchema, secrets) }),
      }
    case 'input_requested':
      return { ...event, requestId: m(event.requestId) }
    case 'task_progress':
      return {
        ...event,
        ...(event.status === undefined ? {} : { status: m(event.status) }),
        ...(event.text === undefined ? {} : { text: m(event.text) }),
      }
    case 'shell_output':
      return { ...event, event: maskRecord(event.event, secrets) }
    case 'artifact_start':
      return {
        ...event,
        artifactId: m(event.artifactId),
        mimeType: m(event.mimeType),
        ...(event.filename === undefined ? {} : { filename: m(event.filename) }),
        ...(event.metadata === undefined ? {} : { metadata: maskRecord(event.metadata, secrets) }),
      }
    case 'artifact_chunk':
      return { ...event, artifactId: m(event.artifactId), chunk: m(event.chunk) }
    case 'state_update':
      return { ...event, channel: m(event.channel), data: maskValue(event.data, secrets) }
    case 'file_edit':
      return {
        ...event,
        file: m(event.file),
        ...(event.search === undefined ? {} : { search: m(event.search) }),
        ...(event.replace === undefined ? {} : { replace: m(event.replace) }),
        ...(event.content === undefined ? {} : { content: m(event.content) }),
        ...(event.diff === undefined ? {} : { diff: m(event.diff) }),
      }
    case 'error':
      return { ...event, code: m(event.code), message: m(event.message) }
    case 'done':
      return {
        ...event,
        result: m(event.result),
        ...(event.model === undefined ? {} : { model: m(event.model) }),
      }
  }
}

/**
 * One turn's event mask (B-398 FR-007): a `text_delta` goes through a stream mask, which holds back
 * what could still grow into a configured value; any other event first releases what is held, as
 * a `text_delta` of its own, so the client keeps the model's order (EC-2), and is then emitted with
 * every string in it masked. A value split across a tool event is two releases, each masked alone.
 */
export function createEventMask(secrets: readonly string[], emit: (event: TurnEvent) => void): EventMask {
  const stream = Security.createMask(secrets, { minLength: 1 }).stream()
  const flush = (): void => {
    const held = stream.flush()
    if (held !== '') emit({ type: 'text_delta', content: held })
  }
  return {
    emit: (event) => {
      if (event.type === 'text_delta') {
        const released = stream.push(event.content)
        if (released !== '') emit({ ...event, content: released })
        return
      }
      flush()
      emit(maskEvent(event, secrets))
    },
    flush,
  }
}
