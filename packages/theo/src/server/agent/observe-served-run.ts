/**
 * The single place a SERVED agent run becomes spans (usetheokit/theokit#381).
 *
 * ## Why this exists rather than two call sites
 *
 * Two endpoints start a run the framework serves: the plain
 * `POST /api/agents/<name>` (`mount-agent.ts`) and the thread message route
 * (`build-agent-streamer.ts`). Both resolved the adapter and both called
 * `observeAgentRun` — separately. When the run learned to continue an incoming
 * `traceparent`, exactly one of them was taught, and a run's trace became a
 * function of which endpoint reached it: the same header produced the caller's
 * trace on one route and a freshly minted one on the other.
 *
 * `build-agent-streamer.ts`'s own comment had already stated the principle the
 * split violated — *"the thread route runs the same agent and must produce the
 * same spans"* — and the code still drifted, because nothing made the two paths
 * one thing. This function is that one thing: both routes hand it a `Request`
 * and get identical telemetry, and a third route added later inherits it by
 * calling the same function rather than by remembering to.
 *
 * ## The honest wrinkle about a thread run
 *
 * A thread follow-up is HEADLESS: `postThreadFollowUp` answers `202` and the run
 * streams into the durable cache after the request that queued it is gone. A
 * queued follow-up may even start minutes later, when the run ahead of it ends.
 *
 * So the trace continued here is the trace of **the request that started the
 * run**, not of a request that was open while it ran. That is the right answer —
 * it is what lets an operator get from "the client posted this message" to "here
 * is what the agent did about it" — and it is said out loud because the
 * alternative reading ("the trace of the live request") is wrong and would look
 * identical in the payload.
 */
import { extractW3CTraceContext } from '../http/trace-context.js'
import { getObservabilityAdapter } from '../observability-bootstrap.js'

import { observeAgentRun, type AgentRunSpanContext } from './observe-agent-run.js'

export interface ServedRunObservation {
  /** The agent being run, as the attribute an operator will group by. */
  readonly agent: string
  /** The thread/session id, when the route has one. */
  readonly sessionId?: string
  /**
   * The request that started the run. Its `traceparent`, when it carries a valid
   * one, is what the run's spans join.
   */
  readonly request: Request
}

/**
 * Wrap a served run's chunk stream in spans, when telemetry is configured.
 *
 * No adapter ⇒ the stream is returned untouched, so an application that
 * configured no observability pays nothing — the zero-cost path this framework
 * promises, kept at the one place both routes now go through.
 */
export function observeServedRun<T>(
  stream: AsyncIterable<T>,
  options: ServedRunObservation,
): AsyncIterable<T> {
  const adapter = getObservabilityAdapter()
  if (adapter === undefined) return stream

  const inbound = extractW3CTraceContext(options.request)
  const context: AgentRunSpanContext = { agent: options.agent }
  if (options.sessionId !== undefined) context.sessionId = options.sessionId
  if (inbound !== undefined) {
    context.traceId = inbound.traceId
    if (inbound.parentSpanId !== undefined) context.parentSpanId = inbound.parentSpanId
  }

  return observeAgentRun(stream, adapter, context)
}
