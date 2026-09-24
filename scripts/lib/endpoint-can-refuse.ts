/** How long the endpoint has to answer before it counts as unable to demonstrate a refusal. */
export const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Why the endpoint may not be measured against — or `refuses`, the one value that permits measuring.
 *
 * This was a `boolean` until a review measured what the boolean cost. Four distinct conditions
 * collapsed into `false`, and the one place that must print a cause — the probe — could not tell
 * them apart, so every one of them printed the same sentence: *"answers below 400 (or is
 * unreachable) on a path it does not serve"*. Measured against a socket that completed the handshake
 * and then said nothing: the endpoint answered nothing and was not unreachable, and the operator was
 * told to replace a collector that was not the problem.
 *
 * The probe's own header states the rule this violated — *"a shared exit code is not a shared
 * diagnosis, and naming the wrong one sends the reader to the wrong system"*. A truthful boolean is
 * necessary and not sufficient: the pair the operator meets is the guard plus the message.
 *
 * The shape is the one `packages/agents/src/bridge/mcp-file.ts` already established here: degrade at
 * the right radius, and keep the cause. Its docblock records the same lesson from the other side —
 * refusing the file when one entry is unsupported turns *"that server is not supported"* into
 * *"you have no MCP at all"*.
 */
export type EndpointVerdict =
  /** Answered at or above 400 on a path it does not serve: it can refuse, so a success means something. */
  | 'refuses'
  /** Answered below 400 on a path it does not serve, so a success on the real path would say nothing. */
  | 'permissive'
  /** The request threw before any answer — nothing is listening, or the connection was refused. */
  | 'unreachable'
  /** The connection was accepted and no answer arrived within the timeout. */
  | 'timed-out'
  /** `ingest` is not a URL, so nothing was contacted at all. */
  | 'unparseable'

/**
 * Whether the endpoint has demonstrated it can REFUSE a request, and when it has not, why.
 *
 * A measurement that can only pass proves nothing. The first receiver the OTLP probe was pointed at
 * answered 200 on `/v1/traces` AND 200 on a path that does not exist, which would have made "a POST
 * left the process" read as "a span was accepted".
 *
 * Every verdict other than `refuses` is the safe direction: the caller's contract is to refuse to
 * measure. What the verdict adds over a boolean is the only thing the caller can act on — which of
 * the four it was, so the operator is sent to the right system.
 *
 * `timeoutMs` is a parameter rather than a constant because a correct collector behind a slow link
 * is refused by a fixed bound: measured, one answering 404 after 6s came back `timed-out` at 5007ms
 * with nothing naming a timeout the operator could raise.
 */
export async function endpointCanRefuse(
  ingest: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<EndpointVerdict> {
  let absent: URL
  try {
    absent = new URL(ingest)
  } catch {
    return 'unparseable'
  }
  absent.pathname = '/a-path-this-collector-does-not-serve'

  try {
    const res = await fetch(absent, {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.status >= 400 ? 'refuses' : 'permissive'
  } catch (error) {
    // `AbortSignal.timeout` rejects with a TimeoutError DOMException; everything else — DNS, a
    // refused connection, a reset — is unreachable. Both are safe, and they send the reader to
    // different systems, which is the whole reason this function stopped returning a boolean.
    return error instanceof Error && error.name === 'TimeoutError' ? 'timed-out' : 'unreachable'
  }
}
