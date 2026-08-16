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
 * With no `timeoutMs` the behaviour is a plain await — the bound is opt-in, so an existing caller
 * that never passed one keeps exactly what it had.
 */
export async function awaitRegistryRemoval(
  outcome: unknown,
  sessionId: string,
  timeoutMs: number | undefined,
): Promise<unknown> {
  if (!isThenable(outcome) || timeoutMs === undefined) return outcome
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
