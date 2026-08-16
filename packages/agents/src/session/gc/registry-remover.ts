/**
 * Bounding an injected registry remover, in one place.
 *
 * ## Why this file exists, written after it was needed
 *
 * `deleteSession` and `runTranscriptGC` both take a `removeFromRegistry` and both must await it —
 * the only agent registry in the ecosystem is `Agent.delete(id): Promise<void>`. The plan named this
 * file (*"session/gc/registry-remover.ts (NEW) — the shared awaiting helper"*) and the first
 * implementation skipped it, putting the bound inside `deleteSession` and leaving the sweep with a
 * bare `await`.
 *
 * The divergence was not theoretical. A remover that never settled hung `runTranscriptGC`
 * indefinitely — not one session, every session after it, with no error, no timeout and no output.
 * The single-session path was already tested against exactly that; the sweep, which is the path that
 * runs unattended over a whole project, was not. That is `system-design-guardrails.md` § G12 in its
 * most expensive form: one rule, two call sites, and the one nobody was watching was the one that
 * mattered.
 */
import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * The registry did not answer in time.
 *
 * T2.2 — this used to mean "you passed a Promise to a synchronous seam". The seam now awaits, so the
 * only thing left that a caller cannot fix by awaiting is a registry that does not respond.
 */
export class SessionRegistryRemoverError extends TheokitAgentError {
  override readonly name = 'SessionRegistryRemoverError'
  readonly sessionId: string

  constructor(sessionId: string, timeoutMs: number) {
    super(
      `[@theokit/agents] the registry remover for session "${sessionId}" timed out: it did not ` +
        `settle within ${String(timeoutMs)}ms. The transcript was left on disk — an orphan file is collected by ` +
        `the next sweep, while a registry entry pointing at a deleted transcript is repaired by ` +
        `nothing, because GC works from transcripts.`,
    )
    this.sessionId = sessionId
  }
}

/**
 * How long to wait for a registry that has not answered, when the caller says nothing.
 *
 * The bound was OPT-IN in the first version of this fix, and nothing opted in: no production call
 * site passed `registryTimeoutMs`, so the shipped default was byte-for-byte the hang the fix was
 * written to close — while `session-lifecycle.ts` states the guarantee unconditionally and the
 * consumer's `Agent.delete` is handed straight to this seam. A bound nobody applies is a comment.
 *
 * 30s is generous for what a registry removal is (a map delete, or a small write) and short enough
 * that an operator notices. The failure direction is safe by construction: on timeout the transcript
 * is KEPT, and an orphan file is collected by the next sweep, whereas a registry entry pointing at a
 * deleted transcript is repaired by nothing.
 */
export const DEFAULT_REGISTRY_TIMEOUT_MS = 30_000

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === 'function'
}

/**
 * Await `outcome`, bounded by `timeoutMs` when one is given.
 *
 * The race is deliberate and one-directional: whichever settles first decides, and a remover that
 * settles AFTER the timeout can no longer affect anything, because the caller's result is already
 * built (EC-8). Reporting "not removed" for something that later succeeded is wrong in the SAFE
 * direction; reaching back into a returned result would not be.
 *
 * With no `timeoutMs` the {@link DEFAULT_REGISTRY_TIMEOUT_MS} applies. Unbounded is still reachable
 * — pass a non-finite value such as `Infinity` — but it has to be ASKED FOR, because the version of
 * this function where absence meant unbounded shipped the hang it was written to close.
 *
 * A non-thenable outcome never reaches the race: a remover that returns a value rather than a
 * promise has already finished.
 */
export async function awaitRegistryRemoval(
  outcome: unknown,
  sessionId: string,
  timeoutMs: number | undefined = DEFAULT_REGISTRY_TIMEOUT_MS,
): Promise<unknown> {
  if (!isThenable(outcome) || !Number.isFinite(timeoutMs)) return outcome
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      outcome,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new SessionRegistryRemoverError(sessionId, timeoutMs))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
