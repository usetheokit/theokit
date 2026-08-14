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
export type {
  ToolUsageRecord,
  UsageQuery,
  UsageRecord,
  UsageResult,
  UsageStorageAdapter,
} from './usage-types.js'
