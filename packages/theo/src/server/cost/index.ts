/**
 * server/cost — Cost tracking primitives (Phase 5, R0.5.11).
 *
 * T4.4 (architecture-cleanup) — sub-barrel entrypoint. Consumers may import
 * from `theokit/server/cost` directly via package.json subpath exports.
 *
 * Backwards compat: `theokit/server` still re-exports these symbols via
 * its top-level barrel (deprecated path; remove in 1.0).
 */

export { trackAgentRun } from './track-agent-run.js'
export type { TrackAgentRunInput, TrackAgentRunOptions } from './track-agent-run.js'

export type {
  UsageRecord,
  ToolUsageRecord,
  UsageQuery,
  UsageResult,
  UsageStorageAdapter,
} from './cost-types.js'

export { InMemoryUsageStorage } from './usage-storage-memory.js'

export { trackAgentTools } from './track-agent-tools.js'
export type {
  TrackAgentToolsOptions,
  TrackAgentToolsHooks,
  ToolHookEvent,
} from './track-agent-tools.js'

// M84 — the runtime-neutral half now lives in `@theokit/agents/usage`.
//
// 1 715 LOC of observability and cost lived here, and `theokit` is the Vite/React web framework. The
// only real product on this stack depends on `@theokit/agents` and never on `theokit` — so none of
// it was reachable from the one place that needed it, and what would have been is HTTP-shaped.
//
// Re-exported from this path for one major so nothing breaks (Top-risk 1). What stays here is the
// HTTP wiring — `trackAgentRun`, spans named `http.request`, keying by `requestId` — because that is
// what it is about.
export { InMemoryUsageStorage as NeutralUsageStorage } from '@theokit/agents/usage'
