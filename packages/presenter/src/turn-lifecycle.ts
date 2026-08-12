/**
 * Fold a content-event stream into a product's own lifecycle vocabulary.
 *
 * ADR 0007 records the split this implements. `AgentOutputEvent` is CONTENT-shaped — this chunk is
 * text, this one is a tool call — while every wire contract a CLI actually speaks is
 * LIFECYCLE-shaped: a thread has turns, a turn has items, a turn ends once with usage aggregated
 * across it. The presenter's three surfaces model the first axis and are structurally unable to
 * model the second.
 *
 * The NAMES stay with the product. `thread.started` is one dialect among several — ACP and the
 * OpenAI-style contracts name the same moments differently — and a framework that ships one has
 * picked a side for every consumer. So the vocabulary arrives as a record of constructors and
 * nothing in this file names an event.
 *
 * ## What the fold is for
 *
 * One invariant, and it is not stylistic: **a turn opens exactly once and closes exactly once,
 * never both completed and failed, and never left open.** A turn that never closes leaves a
 * consumer waiting forever; a turn that closes twice makes a failed run look successful to whoever
 * read the second event. Measured in the one existing hand-rolled emitter, the error path and the
 * finish path each close the turn, and only a flag threaded through both keeps them from doing it
 * twice — which is exactly the kind of thing that is right until someone edits one path.
 *
 * @public
 */

/** An item within a turn: a tool call, a message, whatever the product's dialect names. @public */
export interface LifecycleItem {
  readonly id: string
  /** The product's word for what this item is — a tool name, `message`, an error kind. */
  readonly kind: string
}

/** The product's dialect, as constructors. Nothing here is named by the framework. @public */
export interface LifecycleVocabulary<E> {
  readonly threadStarted: (threadId: string) => E
  readonly turnStarted: () => E
  readonly itemStarted: (item: LifecycleItem) => E
  readonly itemCompleted: (item: LifecycleItem) => E
  readonly turnCompleted: (usage: unknown) => E
  readonly turnFailed: (error: { readonly message: string }) => E
}

/** A chunk off the content stream, in the shape this fold needs to see it. @public */
export type ContentChunk =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'tool-call'; readonly id?: string; readonly name: string }
  | { readonly kind: 'tool-result'; readonly id?: string; readonly name: string }
  | { readonly kind: 'error'; readonly message: string }

/** How the stream ended, as the caller understands it. @public */
export interface TurnOutcome {
  readonly status: 'ok' | 'error'
  readonly error?: string
  readonly usage?: unknown
}

/** @public */
export interface TurnLifecycle<E> {
  /** The events emitted when the turn opened, in order. */
  readonly opened: readonly E[]
  /** False once the turn has closed. Lets a caller ASSERT the invariant rather than trust it. */
  readonly isOpen: boolean
  /** Events this chunk produces. Empty is normal — text accumulates and emits nothing until the end. */
  observe(chunk: ContentChunk): readonly E[]
  /** Closes the turn. Idempotent: a second call emits nothing. */
  finish(outcome: TurnOutcome): readonly E[]
}

/**
 * @returns a turn that has already opened — the thread and turn events are in `opened`, because a
 *   turn whose opening is optional is one a caller can forget to open.
 * @public
 */
export function foldTurnLifecycle<E>(
  vocabulary: LifecycleVocabulary<E>,
  threadId: string,
): TurnLifecycle<E> {
  let open = true
  let text = ''
  let failure: string | undefined
  let nextItem = 0

  // Ids fall back to a counter that advances when an item CLOSES, not on every lookup. A call and
  // its result must share an id — that pairing is the whole point of item events — while two calls
  // to the same tool in one turn must not, which rules out using the tool's name.
  //
  // Found by mutation: incrementing on every lookup gave a call and its own result different ids,
  // and the first version of the covering test compared two RESULTS, which differ either way.
  const idOf = (chunk: { id?: string }): string => chunk.id ?? `item_${nextItem}`

  const observe = (chunk: ContentChunk): readonly E[] => {
    // A stream can outlive the decision to stop. An item emitted after the close would sit outside
    // any turn, which no dialect can express.
    if (!open) return []

    switch (chunk.kind) {
      case 'text':
        text += chunk.delta
        return []
      case 'tool-call':
        return [vocabulary.itemStarted({ id: idOf(chunk), kind: chunk.name })]
      case 'tool-result': {
        const closing = vocabulary.itemCompleted({ id: idOf(chunk), kind: chunk.name })
        nextItem += 1
        return [closing]
      }
      case 'error':
        // Recorded rather than emitted: the turn closes as failed later, once, and an error item
        // emitted here plus a failed close is the double-report this fold exists to prevent.
        failure ??= chunk.message
        return []
    }
  }

  const finish = (outcome: TurnOutcome): readonly E[] => {
    if (!open) return []
    open = false

    const events: E[] = []
    const message = text.trim()
    // Whitespace-only text is not an item: a surface renders a blank bubble for it.
    if (message.length > 0) {
      events.push(vocabulary.itemCompleted({ id: 'message', kind: message }))
    }

    const reason = failure ?? (outcome.status === 'error' ? (outcome.error ?? 'turn failed') : undefined)
    events.push(
      reason === undefined
        ? vocabulary.turnCompleted(outcome.usage)
        : vocabulary.turnFailed({ message: reason }),
    )
    return events
  }

  return {
    opened: [vocabulary.threadStarted(threadId), vocabulary.turnStarted()],
    get isOpen() {
      return open
    },
    observe,
    finish,
  }
}
