/**
 * `@theokit/agents/usage` — M84: the runtime-neutral half of cost tracking.
 *
 * The acceptance criterion of the milestone, stated as a package boundary: a terminal product that
 * depends ONLY on `@theokit/agents` can record and query usage without adding `theokit`.
 *
 * The HTTP wiring — `trackAgentRun`, spans named `http.request`, keying by `requestId` — stays in
 * `theokit/server/cost`, and re-exports these for one major so nothing breaks (Top-risk 1).
 */
export { InMemoryUsageStorage } from './in-memory-usage.js'
// The tool-facing half: what a handler running INSIDE the loop can ask about the run it is part of.
// It lands on this subpath and not the main barrel because it belongs to the same subject — real
// provider-reported usage — and because the barrel is a measured 36.5 KB against a 37.5 KB ceiling.
export { readRunUsage } from './run-usage.js'
export type { RunUsageSnapshot } from './run-usage.js'
export type {
  ToolUsageRecord,
  UsageQuery,
  UsageRecord,
  UsageResult,
  UsageStorageAdapter,
} from './usage-types.js'
