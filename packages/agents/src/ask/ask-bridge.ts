import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * M77 — the ask channel: the agent asks, a human answers, the turn waits.
 *
 * ## The asymmetry this closes
 *
 * "Pause the turn for a human" existed only for tool APPROVAL. Its sibling — the agent asking a
 * question mid-turn — had a tool and no channel: the SDK's `createQuestionTool` takes an `askUser`
 * callback (preferring `ctx.context.askUser`), and nothing in this layer ever supplied one. A tool
 * that cannot reach a human is a tool that times out, five minutes later, with no diagnosis.
 *
 * ## Why this is framework and not runtime
 *
 * It makes no model call, dispatches no tool and stores no conversation. It is a rendezvous between
 * a paused turn and a surface — the "home the agent lives in" (ADR 0038 / ADR-0040 § D2), the same
 * category as the approval gate this is modelled on.
 *
 * ## Modelled on `ApprovalRegistry`, deliberately
 *
 * That registry already solved this exact problem for approvals: hold the live resolver in memory,
 * settle it from outside, and keep ONE instance per process because the promise being awaited and
 * the promise being settled must be the same object. Inventing a second shape for the same problem
 * would be the duplication G12 forbids. What differs is the key — a thread, not an approval id —
 * because a question belongs to a conversation and a surface renders one at a time.
 *
 * ## What it refuses, and why refusing beats resolving
 *
 * Two questions on one thread have no coherent UI: the answer cannot be attributed to either. Two
 * listeners on one thread means the prompt is rendered twice and answered by whoever wins. Both are
 * refused with a typed error rather than resolved by picking a winner — silently replacing a
 * listener makes the first surface go deaf with no signal at all.
 */

/** Raised when a thread already has a question in flight. */
export class ConcurrentQuestionError extends TheokitAgentError {
  override readonly name = 'ConcurrentQuestionError'
  constructor(threadId: string) {
    super(
      `thread "${threadId}" already has a question awaiting an answer. A surface renders one ` +
        `question at a time, and a second one in flight cannot be attributed to an answer. ` +
        `Answer or abandon the first.`,
    )
  }
}

/** Raised when a thread already has a listener attached. */
export class ConcurrentListenerError extends TheokitAgentError {
  override readonly name = 'ConcurrentListenerError'
  constructor(threadId: string) {
    super(
      `thread "${threadId}" already has a question listener. Two listeners render the prompt ` +
        `twice and race to answer it. Dispose the first (call the function \`setListener\` ` +
        `returned) before attaching another.`,
    )
  }
}

/**
 * Raised when a pending question will never be answered — the run was cancelled, the surface
 * detached, or nobody was listening in the first place.
 */
export class QuestionAbandonedError extends TheokitAgentError {
  override readonly name = 'QuestionAbandonedError'
  constructor(threadId: string, why: string) {
    super(`question on thread "${threadId}" was abandoned: ${why}`)
  }
}

/** A question as it reaches the surface. */
export interface PendingQuestion {
  /** Correlates {@link AskBridge.answer} with the promise the tool is awaiting. */
  readonly id: string
  /** The thread the question belongs to. */
  readonly threadId: string
  /** What to show the human. */
  readonly question: string
}

/** Extra hooks a surface may attach alongside its listener. */
export interface ListenerOptions {
  /**
   * Called when a pending question is abandoned, so the surface can release its slot.
   *
   * Without it, cancelling a run leaves the prompt on screen waiting for an answer nobody awaits —
   * and the next question fails with "one already pending" against a question that is gone.
   */
  readonly onAbandon?: (threadId: string) => void
}

/** Detaches a listener. Calling it twice is harmless. */
export type DisposeListener = () => void

export interface AskBridge {
  /**
   * Ask, and resolve when a human answers.
   *
   * Rejects — never hangs — when there is no listener, when the thread is already asking, or when
   * the question is abandoned. Hanging is the failure this module exists to remove.
   */
  ask(threadId: string, question: string): Promise<string>
  /** Settle a pending question. `false` when the id is unknown or already settled. */
  answer(id: string, answer: string): boolean
  /** Reject whatever is pending on a thread. `false` when nothing was pending. */
  abandon(threadId: string): boolean
  /** Attach the surface that renders questions for a thread. */
  setListener(
    threadId: string,
    listener: (question: PendingQuestion) => void,
    options?: ListenerOptions,
  ): DisposeListener
}

interface Pending {
  readonly id: string
  readonly settle: (answer: string) => void
  readonly fail: (error: Error) => void
}

interface Listener {
  readonly notify: (question: PendingQuestion) => void
  readonly onAbandon?: (threadId: string) => void
}

/**
 * Build a bridge.
 *
 * A factory rather than a class with a process singleton baked in: tests get a fresh instance, and
 * the surface that owns the process decides where the shared one lives — exactly the shape
 * `createInProcessApprovalRegistry` established.
 */
export function createAskBridge(): AskBridge {
  const pendingByThread = new Map<string, Pending>()
  const pendingById = new Map<string, Pending & { threadId: string }>()
  const listeners = new Map<string, Listener>()

  const forget = (threadId: string, id: string): void => {
    pendingByThread.delete(threadId)
    pendingById.delete(id)
  }

  return {
    ask(threadId, question) {
      if (pendingByThread.has(threadId)) {
        return Promise.reject(new ConcurrentQuestionError(threadId))
      }
      const listener = listeners.get(threadId)
      if (listener === undefined) {
        // Fail now rather than await a rendezvous that cannot happen. The alternative is the turn
        // sitting until the tool's own timeout — five minutes of silence that says nothing about why.
        return Promise.reject(
          new QuestionAbandonedError(threadId, 'no surface is listening on this thread'),
        )
      }

      const id = crypto.randomUUID()
      const promise = new Promise<string>((resolve, reject) => {
        const entry: Pending = {
          id,
          settle: (answer) => {
            forget(threadId, id)
            resolve(answer)
          },
          fail: (error) => {
            forget(threadId, id)
            reject(error)
          },
        }
        pendingByThread.set(threadId, entry)
        pendingById.set(id, { ...entry, threadId })
      })

      listener.notify({ id, threadId, question })
      return promise
    },

    answer(id, answer) {
      const entry = pendingById.get(id)
      // A late answer — the user clicked after the turn ended — is ordinary, not exceptional.
      // Throwing would make the surface's happy path a try/catch.
      if (entry === undefined) return false
      entry.settle(answer)
      return true
    },

    abandon(threadId) {
      const entry = pendingByThread.get(threadId)
      // Cleanup runs at the end of every turn, and most turns asked nothing.
      if (entry === undefined) return false
      entry.fail(
        new QuestionAbandonedError(threadId, 'the run was cancelled or the surface detached'),
      )
      listeners.get(threadId)?.onAbandon?.(threadId)
      return true
    },

    setListener(threadId, listener, options) {
      if (listeners.has(threadId)) throw new ConcurrentListenerError(threadId)
      const entry: Listener = {
        notify: listener,
        ...(options?.onAbandon !== undefined && { onAbandon: options.onAbandon }),
      }
      listeners.set(threadId, entry)
      return () => {
        // Only remove OUR listener: a disposer called after another surface took the slot must not
        // detach that one. Calling it twice is a no-op by the same check.
        if (listeners.get(threadId) === entry) listeners.delete(threadId)
      }
    },
  }
}
