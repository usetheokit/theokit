/**
 * The base URL a test uses to reach a server it started on this machine.
 *
 * #830 — the address family is DISCOVERED, once, by the readiness probe, and every later request uses
 * what answered. Neither half of that is optional:
 *
 * - `localhost` resolves to both `::1` and `127.0.0.1`. Node tries the AAAA record first, and a server
 *   bound to IPv4 only leaves the v6 attempt to TIME OUT rather than be refused — measured in CI as
 *   `connect ETIMEDOUT ::1:5173` inside an `AggregateError`, on a commit that passed on re-run.
 * - Hard-coding `127.0.0.1` instead is the same mistake pointing the other way, and it was measured
 *   too: on a runner whose dev server binds IPv6, eight tests went from flaky to deterministically
 *   refused.
 *
 * So no family is chosen here. `waitForServer` finds the one that accepts and records it; `localUrl`
 * returns it. A test that asks before the probe ran gets `127.0.0.1` and a comment saying why: that is
 * the pre-probe default, not an answer.
 */
const hostForPort = new Map<number, string>()

/** Recorded by `waitForServer` when a host accepts — the one fact that keeps both sides in step. */
export function rememberHost(port: number, host: string): void {
  hostForPort.set(port, host)
}

/** The loopback hosts to try, in the order Node's own resolver would reach them for `localhost`. */
export const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]'] as const

export function localUrl(port: number, path = '/'): string {
  return `http://${hostForPort.get(port) ?? LOOPBACK_HOSTS[0]}:${String(port)}${path}`
}
