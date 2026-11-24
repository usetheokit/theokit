import { createAskBridge } from '@theokit/agents/ask'

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
 * So this module resolves a thread to its pending question id through `bridge.pending` and keeps no
 * state of its own about questions. It is an address translation, not a second rendezvous.
 */

const DEFAULT_THREAD = '__default__'

const bridge = createAskBridge()

/** Threads already wired to the framework, so a second `ask` does not attach a second listener. */
const wiredThreads = new Set<string>()

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
  // The framework requires a listener per thread before `ask`; what the surface reads comes from
  // `pending` and `onChange`, so this one has nothing to record.
  bridge.setListener(threadId, () => {})
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
  bridge.pending(threadId)?.question

export const answerQuestion = (answer: string, threadId = DEFAULT_THREAD): boolean => {
  const pending = bridge.pending(threadId)
  return pending !== undefined && bridge.answer(pending.id, answer)
}

/**
 * Observe changes to any thread's pending question. Any number of observers may attach; each
 * disposer removes only its own. The observer is told nothing and reads `currentQuestion`.
 */
export const setListener = (listener: () => void): (() => void) => bridge.onChange(() => listener())
