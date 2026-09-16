export { abandonQuestion, answerQuestion, ask, currentQuestion, setListener } from './ask-bridge.js'
/**
 * B-004 — surfaces import from `@theocode/agent/ask`, never from a module directly, so the error a
 * caller must catch by type has to be reachable from HERE. It is the framework's class, re-exported
 * unchanged: one class under one name in the process, which is what makes `instanceof` mean
 * anything. `ask-bridge.ts` used to be the middle hop and no longer is — the hop had no consumer of
 * its own and the gate flagged it.
 *
 * `ask-bridge.test.ts` pins this by importing the name from this entrypoint and asserting it is the
 * same object as the framework's. Its two siblings, `ConcurrentListenerError` and
 * `QuestionAbandonedError`, were removed in the same pass: nothing imports them and nothing tests
 * them, and an entrypoint should expose what something consumes. Add one back the day a consumer
 * needs it, with the test that proves it.
 */
export { ConcurrentQuestionError } from '@theokit/agents/ask'
export { createInteractiveShellTool } from './interactive-shell-tool.js'
