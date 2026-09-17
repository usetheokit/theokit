/**
 * The base URL a test uses to reach a server it started on this machine.
 *
 * #830 — `127.0.0.1`, never `localhost`, and that is the whole of it. `localhost` resolves to both
 * `::1` and `127.0.0.1`, Node tries the AAAA record first, and a dev server bound to IPv4 only leaves
 * the v6 attempt to TIME OUT rather than be refused. The readiness probe and the test then disagree
 * about which family they reached, so a server that is genuinely up can still fail a fetch.
 *
 * Measured in CI on 2026-09-17: `auto-inject-entry-client.test.ts` failed a promotion PR with
 * `connect ETIMEDOUT ::1:5173` wrapped in an `AggregateError` — the shape of a happy-eyeballs fallback
 * that ran out of patience — and the identical commit passed on re-run.
 *
 * A timeout is also the expensive way to fail: a refused connection costs a millisecond, and this cost
 * the job its patience. Naming the family removes both problems at once.
 */
export function localUrl(port: number, path = '/'): string {
  return `http://127.0.0.1:${String(port)}${path}`
}
