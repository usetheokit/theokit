/**
 * `@theokit/agents/hooks` — the M75 hook engine.
 *
 * A subpath rather than a member of the main barrel: this is the machinery for running user-declared
 * subprocesses, and an app that only defines an agent should not carry it. See `../index.ts` for the
 * measurement that moved it here.
 *
 * Denial is the default. `approved` is a REQUIRED argument on `buildHookHandlers` because an
 * optional gate is a gate somebody forgets, and forgetting this one runs a stranger's shell command.
 */
export {
  DEFAULT_CONTINUATION_BUDGET,
  DEFAULT_HOOK_TIMEOUT_MS,
  HOOK_EVENTS,
  HookSpecError,
  buildHookHandlers,
  fenceHookOutput,
  hookSpecSchema,
  parseHookSpecs,
} from './hook-spec.js'
export type { BuildHookHandlersOptions, HookEvent, HookSpec } from './hook-spec.js'
export { hookFingerprint } from './hook-fingerprint.js'
export type { HookIdentity } from './hook-fingerprint.js'
export {
  CHAIN_BUDGET_MULTIPLIER,
  DRAIN_BUDGET_MS,
  MAX_OUTPUT_BYTES,
  runHookCommand,
} from './hook-runner.js'
export type { HookRunInput, HookRunResult } from './hook-runner.js'
