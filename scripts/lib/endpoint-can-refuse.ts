/**
 * Whether the endpoint has demonstrated it can REFUSE a request.
 *
 * A measurement that can only pass proves nothing. The first receiver the OTLP probe was
 * pointed at answered 200 on `/v1/traces` AND 200 on a path that does not exist, which would
 * have made "a POST left the process" read as "a span was accepted".
 *
 * Returns false when the endpoint answers below 400 on a path it does not serve, and false when
 * the request throws — an unreachable endpoint has demonstrated nothing either. Both are the safe
 * direction: the caller's contract is to refuse to measure.
 */
export async function endpointCanRefuse(ingest: string): Promise<boolean> {
  const absent = new URL(ingest)
  absent.pathname = '/a-path-this-collector-does-not-serve'
  try {
    const res = await fetch(absent, { method: 'POST', body: '{}' })
    return res.status >= 400
  } catch {
    return false
  }
}
