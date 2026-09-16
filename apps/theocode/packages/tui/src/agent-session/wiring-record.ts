/**
 * B-069/B-070/B-071 — where the TUI keeps what the last agent build actually wired.
 *
 * `buildChatAgent` publishes the record through `onWired` at the moment it decides, and the agent is
 * rebuilt per turn. A module-level holder is the honest shape for that: the record describes THE
 * PROCESS's current agent, there is exactly one, and threading it through React state would make a
 * value that changes outside render pretend it changes during one.
 *
 * `undefined` before the first turn is meaningful and is NOT flattened into an empty record: "no
 * agent has been built yet" and "an agent was built and wired nothing" are different answers, and a
 * listing that showed the second for the first would be lying at exactly the moment a user opens it.
 */
import type { WiredCapabilities } from '@theocode/agent'

let lastWired: WiredCapabilities | undefined

export function recordWiring(wired: WiredCapabilities): void {
  lastWired = wired
}

/**
 * B-168 — clear the record, so a test that publishes one does not decide what the next test observes.
 *
 * Vitest isolates per FILE, not per test: `interpret-command.test.ts` publishes at one point and 13
 * tests run after it, every one seeing a record. Nothing depends on it today, and a reviewer measured
 * how thin that is — one of those tests reads the leaked record through production and passes only
 * because its fake omits `skills`, which is the partial-record trap B-161 needed three attempts to
 * close.
 *
 * Named for tests and used by them. `recordWiring(undefined)` would have been the smaller change and
 * is wrong: production could then un-publish a record by accident, and `undefined` here MEANS "no
 * agent has been built yet" — a state this module's own comment calls out as distinct from an agent
 * that wired nothing.
 */
export function clearWiring(): void {
  lastWired = undefined
}

export function currentWiring(): WiredCapabilities | undefined {
  return lastWired
}
