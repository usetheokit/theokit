import { LOOPBACK_HOSTS, rememberHost } from './local-url.js'

/**
 * Helper: wait until a dev server actually ACCEPTS connections.
 *
 * The symmetric twin of `safeClose`, for the other end of the lifecycle. `startDevServer` resolving
 * means the address is assigned; it does not mean the listener is accepting. The integration tests
 * read `.address().port` the instant the promise settles and connect, so any gap between those two
 * facts is a flake — and CI runners are exactly where the gap widens (usetheokit/theokit#699).
 *
 * Measured twice on 2026-09-08, on release pull requests, as `TypeError: fetch failed`:
 * `auto-inject-entry-client.test.ts` (#688) and `devtools-injection.test.ts` (#692). Both passed
 * locally and on re-run, which is the shape that trains a team to re-run instead of read.
 *
 * "Resolved is not ready" is the same sentence this repository has now written twice about a
 * different promise — `Agent.delete` resolved `void` having removed nothing (#675).
 *
 * NOT a fixed sleep. A sleep turns a race into a slower race and hides it on fast machines, which is
 * how a flake becomes permanent. This polls, and on exhaustion it FAILS with the port and the
 * elapsed time so a genuine boot failure stays distinguishable from a slow one.
 */
export async function waitForServer(port: number, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    try {
      // Both families, because which one the server bound is not knowable from here and guessing has
      // now been measured wrong in both directions (#830). The first that accepts is recorded, and
      // every later request in the run uses it.
      for (const host of LOOPBACK_HOSTS) {
        try {
          await fetch(`http://${host}:${String(port)}/`)
          rememberHost(port, host)
          return
        } catch (perHost) {
          lastError = perHost
        }
      }
      throw lastError
    } catch (error) {
      lastError = error
      // Short and fixed rather than exponential: the window being closed is milliseconds wide, and a
      // backoff would spend most of the budget asleep past the moment the server came up.
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  const waited = Date.now() - started
  throw new Error(
    `dev server on port ${String(port)} did not accept a connection within ${String(waited)}ms — ` +
      `this is a boot failure, not the readiness race #699 describes. Last error: ` +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  )
}
