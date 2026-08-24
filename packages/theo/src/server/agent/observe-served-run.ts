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
 * Unifying the function was not enough by itself, and #406 is the proof: the two
 * routes went on labelling the same agent differently, because the label is a
 * value the caller passes in rather than one derived here. What this function
 * can do about that is refuse an ambiguous one — hence `agentName`, whose
 * documentation below says what a name is and what it is not.
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
import { requestTrace } from '../observability/request-trace.js'
import { getObservabilityAdapter } from '../observability-bootstrap.js'

import { observeAgentRun, type AgentRunSpanContext } from './observe-agent-run.js'

export interface ServedRunObservation {
  /**
   * The agent's NAME — `chat` for `agents/chat.ts`, the same string the URL carries and the same
   * one the access policy is judged under (`params.agent`).
   *
   * It is spelled `agentName` rather than `agent` because the field's whole history is callers
   * handing it something that identifies the agent's *module* instead: the plain route passed the
   * absolute file path it compiles from, the thread route passed the label `agent "chat"` it puts
   * in error messages, and both are values a reviewer reads as "the agent" without noticing that
   * neither is a name (usetheokit/theokit#406). A path identifies a file on one machine — it
   * changes with the deploy, splits one agent into a series per environment, and carries the
   * server's directory layout (on a developer machine, the user's account name) to a telemetry
   * backend nobody decided to export it to.
   *
   * If the module path is ever wanted for debugging it belongs on its own attribute
   * (`code.filepath` is the OpenTelemetry registry spelling), deliberately, and never as the key
   * an operator groups by.
   */
  readonly agentName: string
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

  // The request's trace, resolved once for the whole request rather than re-read from the header
  // here (usetheokit/theokit#404). Reading the header was the same answer only while a header was
  // there; without one, this side minted a trace of its own and the request split in two.
  const trace = requestTrace(options.request)
  const context: AgentRunSpanContext = { agent: options.agentName, traceId: trace.traceId }
  if (options.sessionId !== undefined) context.sessionId = options.sessionId

  // Under the span this process opened for the request when there is one; otherwise under the
  // caller's, which is the pre-existing behaviour for a traced request that reached a route with no
  // HTTP span. With neither, the run is the honest root of its own trace — naming a span nobody
  // emitted would read as a span lost in transit.
  const parentSpanId = trace.outermostSpanId ?? trace.parentSpanId
  if (parentSpanId !== undefined) context.parentSpanId = parentSpanId

  return observeAgentRun(stream, adapter, context)
}
