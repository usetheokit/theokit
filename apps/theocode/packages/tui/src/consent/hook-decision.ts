/**
 * B-040 — what a hook approval decision does, extracted so it can be tested.
 *
 * The gate used to call `consent.approveHookConsent(...)` and then run
 * `if (pendingHooks.length <= 1) consent.markReviewed()` SYNCHRONOUSLY, while the approve was still
 * in flight. On a rejected persist for the LAST pending hook, `hooksReviewed` was already true:
 * `InputSlot` stops rendering the gate for the session, `epoch` never bumps so `pendingHooks` never
 * recomputes, and the only report went to a log file the user is not reading — which B-039 has just
 * shown could be discarded entirely.
 *
 * The sibling `TrustGate`, five lines below in the same file, does the opposite for the identical
 * failure: a toast plus a state revert. This is that shape, for hooks.
 */
export interface HookDecisionDeps {
  readonly approve: (spec: unknown) => Promise<void>
  readonly refuse: (fingerprint: string) => void
  readonly markReviewed: () => void
  readonly toast: (message: string) => void
}

export interface PendingHook {
  readonly spec: unknown
  readonly fingerprint: string
}

/**
 * Apply the user's answer for `head`. `remaining` is how many hooks are still pending INCLUDING this
 * one, so `<= 1` means this was the last and the gate may close.
 */
export async function applyHookDecision(
  decision: 'yes' | 'no',
  head: PendingHook,
  remaining: number,
  deps: HookDecisionDeps,
): Promise<void> {
  if (decision === 'no') {
    deps.refuse(head.fingerprint)
    if (remaining <= 1) deps.markReviewed()
    return
  }

  try {
    await deps.approve(head.spec)
  } catch (err) {
    // The gate stays OPEN. An approval that did not persist is an approval that will not be in
    // effect next launch, and closing here would tell the user the opposite.
    deps.toast(
      `could not persist the hook approval: ${(err as Error).message} — the hook is still ` +
        'unapproved; approve again to retry',
    )
    return
  }
  if (remaining <= 1) deps.markReviewed()
}
