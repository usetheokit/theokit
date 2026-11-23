/**
 * OC-88 (B-398): what the model is told about a tool result, and the option that frames it.
 *
 * The SDK wraps a tool result's text in `<untrusted-tool-output>` tags, escaping a forged closing
 * tag, only when a send passes `toolResultGuard`; it reads the option per send, so
 * `theoClawAgentOptions` sets it once as the agent's `sendDefaults` and no send site passes it.
 * With `delimit` on, the SDK also adds the explanation of the tag to the system prompt.
 */

/** Tool rounds a tool result stays in full before the SDK prunes it (OC-54). */
export const DEFAULT_PRUNE_TOOL_RESULT_ROUNDS = 4

/** `THEOCLAW_PRUNE_TOOL_RESULT_ROUNDS` (a positive integer) picks the round count; anything else keeps the default. */
export function pruneToolResultRounds(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env['THEOCLAW_PRUNE_TOOL_RESULT_ROUNDS'])
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PRUNE_TOOL_RESULT_ROUNDS
}

/** The send options that frame every tool result of the run as data and prune the aged ones. */
export interface UntrustedContentSendOptions {
  readonly toolResultGuard: { readonly delimit: true }
  readonly pruneToolResults: { readonly olderThanRounds: number }
  /** The SDK's window guard: the call that would be the 4th identical one within the last 20 is blocked with a tool result. */
  readonly doomLoop: { readonly window: number; readonly windowRepeatLimit: number }
}

/** How many times the same call may start within the window before the next one is blocked. */
export const LOOP_REPEAT_LIMIT = 3
/** The most recent calls the SDK window remembers. */
export const LOOP_WINDOW = 20

/** The agent's `sendDefaults`, so every send's tool results reach the model framed. */
export function untrustedContentSendOptions(): UntrustedContentSendOptions {
  return { toolResultGuard: { delimit: true }, pruneToolResults: { olderThanRounds: pruneToolResultRounds() }, doomLoop: { window: LOOP_WINDOW, windowRepeatLimit: LOOP_REPEAT_LIMIT } }
}
