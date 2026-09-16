/**
 * Hook approvals — a FACADE over the framework's `HookApprovalStore` since 2026-08-15.
 *
 * The fingerprint, the three-state classification, the per-project scoping and the private-mode
 * write all live in `@theokit/agents/hooks` now. What stays here is the shape this product's consent
 * screen speaks: `ClassifiedHook`, and the `HookSpec` field names (`timeout_ms`, which the framework
 * calls `timeoutMs`).
 *
 * ## Why it could not move earlier
 *
 * Three properties were missing from the framework store, and every one surfaced by ATTEMPTING the
 * migration rather than by reading the design:
 *
 *  - **Scoping.** It keyed by fingerprint alone, so an approval was machine-wide. Adopting it would
 *    have WIDENED this product's posture — a hook approved in one repository pre-approved in the
 *    next one cloned. Fixed in `@theokit/agents@9.0.0` (breaking: `scope` is required).
 *  - **The directory mode.** The shared `.theokit` directory was created without one and never
 *    repaired. Fixed in `9.0.1`.
 *  - **The records.** Only the set of approved hashes was readable, and a consent screen has to say
 *    WHICH command was approved. Fixed in `9.1.0` with `approvals(scope)`.
 *
 * ## `modified` is decided by a rule now, not a heuristic
 *
 * The old `previousByEvent` option guessed: exactly one orphaned approval plus exactly one new hook
 * in the same event meant "edited". The framework compares the event+matcher SLOT, so a command that
 * changed under the same slot is `modified` outright — no counting, and no ambiguity when two hooks
 * change at once.
 *
 * ## The one thing that does not carry across
 *
 * Approvals recorded by the previous store CANNOT be migrated, and that is stated rather than
 * papered over. The legacy record kept `{command, event}`; the framework fingerprint also needs
 * `matcher` and `timeoutMs`, which were never written. Recomputing would mean inventing the two
 * missing fields and producing a hash that matches nothing real. So an old approval reads as
 * `untrusted` and the operator approves once more — fail-closed, the only safe direction for a
 * consent store to fail.
 */
import { HookApprovalStore, hookFingerprint as frameworkFingerprint } from '@theokit/agents/hooks'
import type { HookIdentity } from '@theokit/agents/hooks'

import { homedir } from 'node:os'

import type { HookSpec } from './hooks-spec.js'

type HookTrustStatus = 'trusted' | 'untrusted' | 'modified'

/** What a consent screen renders. `previousCommand` is filled when the framework says `modified`. */
export interface ClassifiedHook {
  spec: HookSpec
  fingerprint: string
  status: HookTrustStatus
  previousCommand?: string
}

/** One approval, in this product's vocabulary. */
export interface ApprovedHook {
  command: string
  event?: string
  approvedAt: string
}

/** `timeout_ms` here, `timeoutMs` there — the same field, and the only translation this facade does. */
function identityOf(spec: HookSpec): HookIdentity {
  return {
    command: spec.command,
    event: spec.event,
    ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
    timeoutMs: spec.timeout_ms,
  }
}

const storeFor = (home: string = homedir()): HookApprovalStore => new HookApprovalStore({ home })

/** The framework's hash, so what this product SHOWS is what the gate COMPARES. */
export function hookFingerprint(spec: HookSpec): string {
  return frameworkFingerprint(identityOf(spec))
}

export function loadApprovedHooks(dir: string, home?: string): Map<string, ApprovedHook> {
  return new Map(
    storeFor(home)
      .approvals(dir)
      .map((r) => [
        r.fingerprint,
        { command: r.command, event: r.event, approvedAt: r.approvedAt },
      ]),
  )
}

/**
 * Classify each spec against what THIS project approved.
 *
 * The store is the authority, and it is read here: treating a caller-supplied map as truth would
 * let a stale copy answer a security question. Until 2026-09-10 the signature ALSO demanded that
 * map — `_approved`, bound to an underscore and never read — and the sole caller performed a real
 * disk read to supply it, so `computePendingHooks` read like a function that classifies against
 * what that read returned. On a surface where the difference between "the argument decides" and
 * "the argument is ignored" is the whole security question, the signature has to say which. It
 * now says it by not asking (finding #61).
 *
 * The precondition that actually governs the answer is `opts.dir` — WHICH project is being asked
 * about — and it is the only one left.
 */
export function classifyHooks(
  specs: readonly HookSpec[],
  opts: { dir?: string; home?: string } = {},
): ClassifiedHook[] {
  const dir = opts.dir ?? process.cwd()
  const store = storeFor(opts.home)
  const records = store.approvals(dir)

  return specs.map((spec) => {
    const identity = identityOf(spec)
    const fingerprint = frameworkFingerprint(identity)
    const state = store.stateOf(identity, dir)
    if (state === 'approved') return { spec, fingerprint, status: 'trusted' as const }
    if (state === 'modified') {
      const previous = records.find((r) => r.event === spec.event && r.matcher === spec.matcher)
      return {
        spec,
        fingerprint,
        status: 'modified' as const,
        ...(previous === undefined ? {} : { previousCommand: previous.command }),
      }
    }
    return { spec, fingerprint, status: 'untrusted' as const }
  })
}

export async function approveHook(dir: string, spec: HookSpec, home?: string): Promise<void> {
  // `await` on a synchronous call, deliberately: the signature was async and its call sites await
  // it. Narrowing it to sync would be a breaking change for a facade whose whole point is that the
  // move is invisible.
  await Promise.resolve()
  storeFor(home).approve(identityOf(spec), dir)
}
