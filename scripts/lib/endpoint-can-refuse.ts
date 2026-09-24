/** How long the endpoint has to answer before it counts as unable to demonstrate a refusal. */
const TIMEOUT_MS = 5_000

/**
 * Whether the endpoint has demonstrated it can REFUSE a request.
 *
 * A measurement that can only pass proves nothing. The first receiver the OTLP probe was
 * pointed at answered 200 on `/v1/traces` AND 200 on a path that does not exist, which would
 * have made "a POST left the process" read as "a span was accepted".
 *
 * Returns false when the endpoint answers below 400 on a path it does not serve, false when the
 * request throws, false when `ingest` cannot be parsed as a URL, and false when the endpoint accepts
 * the connection and does not answer within `TIMEOUT_MS`. All four are the safe direction: the
 * caller's contract is to refuse to measure.
 *
 * The timeout is the fourth of those and it is not decoration. `fetch` has NO default timeout, so
 * against a host that completes the TCP handshake and then says nothing — a port with a stuck
 * process — this function returned nothing at all: measured still pending at 8081ms. A guard whose
 * entire purpose is to report "could not measure" instead said nothing, forever, with no message and
 * no exit 2. The abort surfaces as a rejection, which the `catch` below already answers correctly.
 *
 * `new URL` is INSIDE the try, and that placement is the finding rather than a style choice. It sat
 * outside until a review measured it: `--ingest 127.0.0.1:4318/v1/traces` — a missing scheme, the
 * likeliest typo — threw `TypeError` out of this function, so the probe exited 1 with a stack instead
 * of the exit 2 it designed for "NOT MEASURED", and a caller keying on 2 could not tell the two apart.
 */
export async function endpointCanRefuse(ingest: string): Promise<boolean> {
  try {
    const absent = new URL(ingest)
    absent.pathname = '/a-path-this-collector-does-not-serve'
    const res = await fetch(absent, {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.status >= 400
  } catch {
    return false
  }
}
