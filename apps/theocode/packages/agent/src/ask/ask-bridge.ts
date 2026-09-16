import { ConcurrentListenerError, createAskBridge, type PendingQuestion } from '@theokit/agents/ask'

/**
 * The ask channel, reduced to the translation that is genuinely this product's.
 *
 * The rendezvous — pending questions, the promise a paused turn awaits, the refusal to attach a
 * second listener to a thread, the settle-before-notify ordering B-004 was about — moved to
 * `@theokit/agents/ask` and was deleted here. So did `ConcurrentQuestionError`,
 * `ConcurrentListenerError` and `QuestionAbandonedError`, which now come from there: the framework
 * is what raises them, so keeping local classes of the same name would leave a typed error nobody
 * could catch by `instanceof` — the exact defect B-004 recorded, reintroduced from the other side.
 *
 * ## What could not move, and why this file still exists
 *
 * The two surfaces address a question differently, and each is right for its own side:
 *
 * - The framework answers by **question id**. That is what lets it refuse a late answer — the user
 *   submitted after the turn moved on — instead of applying it to whatever is pending now.
 * - This product's surface answers by **thread**. The TUI knows which session it renders; it does
 *   not carry a question id through ten call sites, and threading one through would be a wide
 *   mechanical change to a path with no snapshot coverage.
 *
 * So this module keeps a thread → id map and nothing else. It is an address translation, not a
 * second rendezvous: no promise is created here, no listener slot is arbitrated, nothing is settled.
 */

const DEFAULT_THREAD = '__default__'

const bridge = createAskBridge()

/** thread → id of the question pending on it. Half of the entire state this adapter holds. */
const idByThread = new Map<string, string>()
/** thread → its text, so `currentQuestion` stays a read instead of becoming a second listener. */
const textByThread = new Map<string, string>()
/** Threads already wired to the framework, so a second `ask` does not attach a second listener. */
const wiredThreads = new Set<string>()
/** The surface's notification, if one is attached. One slot, exactly as before. */
let notify: (() => void) | undefined

function forget(threadId: string): void {
  idByThread.delete(threadId)
  textByThread.delete(threadId)
}

/**
 * Wire a thread to the framework the first time it is asked on.
 *
 * The second half of the address translation, and the reason it is done HERE rather than in the
 * surface. The framework's listeners are per thread; this product's surface attaches ONE, before it
 * knows which threads will exist, and the TUI's effect is keyed on the identity of its session-id
 * getter rather than on the id itself. Making the surface register per thread would mean a session
 * that changes without that function changing leaves the listener on a dead thread — and the
 * question never renders. There is no test in this repository over that path, so the safe shape is
 * the one that cannot express the bug: the surface stays global, and the thread is wired at `ask`.
 */
function wire(threadId: string): void {
  if (wiredThreads.has(threadId)) return
  wiredThreads.add(threadId)
  bridge.setListener(
    threadId,
    (pending: PendingQuestion) => {
      idByThread.set(threadId, pending.id)
      textByThread.set(threadId, pending.question)
      notify?.()
    },
    {
      onAbandon: () => {
        forget(threadId)
        notify?.()
      },
    },
  )
}

export const ask = (question: string, threadId = DEFAULT_THREAD): Promise<string> => {
  // Before the ask, never after: the framework REJECTS a question on a thread with no listener,
  // which is the behaviour that replaced hanging until a five-minute timeout.
  wire(threadId)
  return bridge.ask(threadId, question)
}

export const abandonQuestion = (threadId = DEFAULT_THREAD): void => {
  bridge.abandon(threadId)
}

export const currentQuestion = (threadId = DEFAULT_THREAD): string | undefined =>
  textByThread.get(threadId)

export const answerQuestion = (answer: string, threadId = DEFAULT_THREAD): boolean => {
  const id = idByThread.get(threadId)
  if (id === undefined) return false
  const accepted = bridge.answer(id, answer)
  // Cleared HERE and in `onAbandon`, never on the promise returned by `ask`.
  //
  // The first version cleared in a `.finally` on that promise, and a test caught what that costs: a
  // SECOND `ask` on a busy thread is refused, its promise rejects, and the `finally` then wiped the
  // id of the FIRST question — which was still open. The answer that followed found no id, and the
  // turn hung. A settle handler on a rejected concurrent request is not a settle of the question
  // that thread is actually waiting on.
  if (accepted) forget(threadId)
  return accepted
}

/**
 * B-035 — one slot, named for it, and a second set over a live one FAILS.
 *
 * Preserved verbatim from the deleted class, including the refusal: only the TUI ever subscribes, so
 * a multicast nobody asked for is the wrong fix; the right one is a name that does not lie and a
 * refusal instead of a silent winner. The disposer frees the slot, which is what lets the TUI
 * unmount and remount without a process restart.
 *
 * The error thrown is now the framework's `ConcurrentListenerError`, so `instanceof` still works for
 * any caller that catches it — and there is exactly one class under that name in the process.
 */
export const setListener = (listener: () => void): (() => void) => {
  if (notify !== undefined) throw new ConcurrentListenerError(DEFAULT_THREAD)
  notify = listener
  return () => {
    if (notify === listener) notify = undefined
  }
}
