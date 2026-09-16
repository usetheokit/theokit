import { mcpFailureSink } from './mcp-failure-sink.js'
import { sinkRetryEvent } from './retry-record-holder.js'

/**
 * The single subscription to the SDK's run events, fanned out to the two holders that read it.
 *
 * Two members are consumed and every other is deliberately ignored: `mcp_server_failed`, so `/mcp`
 * reports a server that failed THIS turn rather than filling with unrelated runtime noise (B-088),
 * and `rate_limit`, so a failed turn can say how many attempts it cost (B-130).
 *
 * Named rather than inline because the FAN-OUT is the part that can break silently. Both records are
 * covered; the two statements that feed them lived inside a generator inside a class at 0% coverage,
 * and dropping either one leaves every test green while its panel reports nothing forever. The CLI
 * had the same linkage untested — see `@theocode/shared/turn-failure-reporting` — and a guarantee
 * that holds on one of two surfaces is not a guarantee.
 */
export function runEventSink(event: Parameters<typeof sinkRetryEvent>[0]): void {
  mcpFailureSink(event as Parameters<typeof mcpFailureSink>[0])
  sinkRetryEvent(event)
}
