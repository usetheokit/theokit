import { createRetryRecord } from '@theocode/shared/retry-record'

/**
 * B-130 — where the TUI keeps the attempts the CURRENT turn has spent.
 *
 * The mechanism is `@theocode/shared/retry-record`; what lives here is the PROCESS HOLDER, for the
 * reason `mcp-failure-record.ts` states about its own: there is exactly one agent in this process,
 * the value changes outside render, and threading it through React state would make it pretend to
 * change during one.
 *
 * It is reset at the same turn boundary the MCP failures are, and for a sharper reason — a stale
 * count is worse than an absent one, because "after 3 attempts" on a turn that made one is a number
 * that is WRONG rather than missing.
 */
let record = createRetryRecord()

/** Tests only — the holder outlives a single test otherwise. Mirrors `resetMcpFailures`. */
export function resetRetryRecord(): void {
  record = createRetryRecord()
}

/** Called when a turn begins, beside `startMcpFailureTurn`. */
export function startRetryTurn(): void {
  record.startTurn()
}

export function currentAttempts(): number {
  return record.attempts()
}

/**
 * Feed a run event into the current holder.
 *
 * A FUNCTION rather than `export const sink = record.sink`, for the reason spelled out in
 * `mcp-failure-record.ts`: that binding would capture the instance live at module evaluation, and
 * `resetRetryRecord` reassigns — so after a reset the sink would write into an instance nobody
 * reads.
 */
export function sinkRetryEvent(event: Parameters<typeof record.sink>[0]): void {
  record.sink(event)
}
