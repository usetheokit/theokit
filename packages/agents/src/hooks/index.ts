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

/**
 * Hook inheritance for a delegated member — exported HERE because it is a hook-engine concern, not a
 * delegation detail: it decides which gates a run is subject to. `delegate()` applies it by default;
 * a caller composing its own sub-agent surface needs the same rule and should not re-derive it.
 */
export { inheritHooks, hooksPlugin, type CodePlugin } from '../bridge/delegation-hooks.js'

/**
 * The producer for the `approved` set this module's gate REQUIRES.
 *
 * Shipping the gate without it left a consumer two exits — approve everything, or write the store —
 * and the half they had to write is the half that touches directory modes and atomic replacement.
 */
export {
  HookApprovalStore,
  type ApprovalState,
  type HookApprovalStoreOptions,
} from './approval-store.js'
export {
  ensureSecureDir,
  readSecureJson,
  writeSecureJson,
  type SecureStoreRead,
} from './secure-store.js'
