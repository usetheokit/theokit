import type { AskBridge } from './ask-bridge.js'
import { QuestionAbandonedError } from './ask-bridge.js'

/**
 * M77 — adapt an {@link AskBridge} to the `askUser` shape the question tool expects.
 *
 * ## Why an adapter and not a re-export
 *
 * The two signatures genuinely differ, and not cosmetically:
 *
 * | | question tool | {@link AskBridge} |
 * |---|---|---|
 * | shape | `(question, threadId?) => Promise<string>` | `(threadId, question) => Promise<string>` |
 * | thread | optional | required — it is the routing key |
 *
 * The tool's `threadId` is optional because the tool cannot know whether the surface tracks threads.
 * The bridge's is required because a question with no thread has no listener to reach: the channel
 * routes BY thread, and "ask whoever" is not a destination.
 *
 * That mismatch is the whole reason this function exists. Writing the flip at each call site is how
 * the argument order eventually gets swapped somewhere and a question is asked with the thread id as
 * its text.
 *
 * ## What it does with a missing thread
 *
 * Rejects, naming the cause. The alternative — pick a default thread, or ask the most recent
 * listener — routes a human question to a conversation it does not belong to, which is worse than
 * failing: the answer comes back attributed to the wrong turn.
 *
 * Pass it as `askUser` when building the question tool, or put it on the run context as
 * `ctx.context.askUser`, which the tool prefers.
 */
export function askUserVia(
  bridge: AskBridge,
): (question: string, threadId?: string) => Promise<string> {
  return (question, threadId) => {
    if (threadId === undefined || threadId === '') {
      return Promise.reject(
        new QuestionAbandonedError(
          '(none)',
          'the question tool was invoked without a thread id, and the ask channel routes by ' +
            'thread — there is no surface to reach. Pass the thread id through the run context.',
        ),
      )
    }
    return bridge.ask(threadId, question)
  }
}
