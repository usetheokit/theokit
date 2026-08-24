import type {
  ToolInvocationState,
  UIMessage as RenderableMessage,
  UIMessagePart as RenderablePart,
} from '@theokit/ui'
import type { UIMessage } from 'theokit/client'

/**
 * The seam between what the framework STREAMS and what the component library RENDERS.
 *
 * `useAgent().thread` hands you `UIMessage` from `theokit/client` — the wire shape, whose parts are
 * deliberately open (`{ type: string; [key: string]: unknown }`) so a `data-*` part or a part kind
 * invented after your app was written still arrives intact. `<ChatMessage>` wants `@theokit/ui`'s
 * `UIMessage`, whose parts are a closed discriminated union.
 *
 * Both are right, and neither can be made assignable to the other without one of them giving up
 * what it is for. So the APP owns the conversion — which is where it belongs: your app chose the
 * renderer, and the framework does not know about it. Two prior versions of this template typed the
 * transcript as the renderer's type and let TypeScript discover the mismatch on the first
 * `tsc --noEmit` of a fresh scaffold (usetheokit/theokit#80, #396).
 *
 * Nothing here is a cast. Each branch checks the fields that branch needs and builds a value the
 * renderer's type accepts; a part it cannot vouch for is DROPPED rather than forced through, which
 * is the honest outcome for a part this version of the library has no renderer for.
 */

/** The tool states `@theokit/ui` knows how to render. Anything else is not renderable here. */
const TOOL_STATES = [
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
] as const

function isToolState(value: unknown): value is ToolInvocationState {
  return typeof value === 'string' && (TOOL_STATES as readonly string[]).includes(value)
}

function toRenderablePart(part: UIMessage['parts'][number]): RenderablePart | null {
  const { type } = part

  if (type === 'text' || type === 'reasoning') {
    return typeof part.text === 'string' ? { type, text: part.text } : null
  }

  if (type === 'dynamic-tool' || type.startsWith('tool-')) {
    // A tool part the renderer can draw needs both of these; a half-built one is skipped rather
    // than drawn with holes.
    if (typeof part.toolCallId !== 'string' || !isToolState(part.state)) return null
    return {
      ...part,
      type: type === 'dynamic-tool' ? 'dynamic-tool' : `tool-${type.slice('tool-'.length)}`,
      toolCallId: part.toolCallId,
      state: part.state,
    }
  }

  if (type.startsWith('data-')) {
    return { ...part, type: `data-${type.slice('data-'.length)}`, data: part.data }
  }

  // A kind this version of `@theokit/ui` has no renderer for. Dropping it keeps the rest of the
  // message readable; forcing it through would render nothing and hide the reason.
  return null
}

/** Project one streamed message into the shape `<ChatMessage>` renders. */
export function toRenderable(message: UIMessage): RenderableMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts.map(toRenderablePart).filter((part) => part !== null),
    ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
  }
}
