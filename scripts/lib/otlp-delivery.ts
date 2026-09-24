/**
 * What the OTLP probe OBSERVED leaving the process, and what that permits it to claim.
 *
 * B-294 — the probe's header promised *"Exit 0 the run produced a span and the exporter reported it
 * accepted"*, and no acceptance was ever read. `TheoCloudObservabilityAdapter.flush()` awaits the POST
 * for its side effect and discards the answer — the response object is never inspected, and a
 * transport error is caught, logged and swallowed (`adapters/theo-cloud.ts:114-128`). So `await
 * flush()` resolves identically whether the collector stored the span, answered 500, or was never
 * reached. Exit 0 was unconditional and exit 1 was reachable only by an uncaught exception.
 *
 * Measured against a receiver answering 404 on `/v1/traces` while refusing an unknown path, so the
 * probe's own control passed: the span was REFUSED and the probe exited 0, printing the epilogue that
 * sends the operator to read a span back that the collector had thrown away.
 *
 * ## Observation is not substitution
 *
 * The probe's header states that nothing is stubbed — no mock fetch, no hand-built adapter, no
 * injected exporter — and that is still true. `recordDeliveriesTo` wraps `fetch` and DELEGATES to the
 * real one: the same request, unmodified, reaches the same collector, and the same response comes
 * back to the same caller. What it adds is a note of the status. A stub answers in place of the
 * system; this reads over its shoulder, and the distinction is the whole reason the probe may still
 * claim to measure the real transport.
 *
 * The wrapper is installed AFTER the control has run, and it matches the ingest URL exactly. Both
 * matter: the control deliberately POSTs to a path the collector does not serve and expects to be
 * refused, so a recorder that was already listening would have booked that refusal as a failed
 * delivery and turned every healthy collector into an exit 1.
 *
 * ## What exit 0 is still not
 *
 * A status below 400 is the COLLECTOR's word, not its store's. An OTLP endpoint may accept a payload
 * and drop it in a pipeline behind the port, which is why the probe keeps printing the marker and the
 * command that reads it back. The claim this module supports is narrower and true: bytes left the
 * process, arrived, and were not refused.
 */

/** One POST the exporter made to the ingest URL, and how it ended. */
export interface DeliveryAttempt {
  /** The status the collector answered, or `null` when the transport threw before any answer. */
  readonly status: number | null
  /** Why the transport threw, when it did. Absent when a status came back. */
  readonly error?: string
}

/** The exit code the observed deliveries justify, and the sentence that explains it. */
export interface DeliveryVerdict {
  readonly code: 0 | 1
  readonly message: string
}

/**
 * At or above this, the collector refused. Below it, it did not.
 *
 * The same threshold `endpointCanRefuse` uses, deliberately: the control decides an endpoint CAN
 * refuse by reading `status >= 400`, and a delivery judged on a different boundary would let a
 * response count as a refusal for the control and an acceptance here, or the reverse.
 */
const REFUSED_FROM = 400

/** The absolute URL a `fetch` call targets, or `null` when it cannot be read as one. */
function targetOf(input: Parameters<typeof fetch>[0]): string | null {
  try {
    if (typeof input === 'string') return new URL(input).href
    if (input instanceof URL) return input.href
    return new URL(input.url).href
  } catch {
    return null
  }
}

/**
 * A `fetch` that behaves exactly like `inner` and notes every call to `ingest`.
 *
 * `attempts` is the array the caller reads afterwards — it is mutated in place rather than returned
 * per call, because the calls are made by the exporter deep inside the adapter and no seam there
 * hands anything back. That absent seam is the defect this module works around, and it is worth
 * naming: the adapter could report its own result, and until it does, the transport is the only place
 * the answer exists.
 */
export function recordDeliveriesTo(
  ingest: string,
  inner: typeof globalThis.fetch,
): { fetch: typeof globalThis.fetch; attempts: DeliveryAttempt[] } {
  const attempts: DeliveryAttempt[] = []
  // Normalised once. A collector reached as `http://127.0.0.1:4318/v1/traces` and configured with a
  // trailing difference is the same endpoint, and a raw string comparison would miss the delivery and
  // report that no span was ever sent.
  const wanted = targetOf(ingest)

  const recording: typeof globalThis.fetch = async (input, init) => {
    // Anything that is not the ingest URL passes through unwatched — the agent's own LLM call goes
    // out through this same function, and counting it as a delivery would be a span nobody exported.
    if (wanted === null || targetOf(input) !== wanted) return inner(input, init)

    try {
      const response = await inner(input, init)
      attempts.push({ status: response.status })
      return response
    } catch (error) {
      // RE-THROWN, never absorbed. The adapter has its own opinion about a failed flush and is
      // entitled to it; an observer that swallowed the error would change the behaviour it claims
      // only to watch.
      attempts.push({
        status: null,
        error: error instanceof Error ? error.message : 'unknown transport error',
      })
      throw error
    }
  }

  return { fetch: recording, attempts }
}

/**
 * The exit code the observed deliveries justify.
 *
 * Exit 0 requires at least one accepted delivery AND no refusal and no transport failure. The
 * conjunction is the point: the exporter flushes in batches, so a run can accept one batch and have
 * another refused, and reporting that as success would call a partial loss a delivery. It is the rule
 * the probe's sibling already holds for a pending check — "I could not tell" never resolves to
 * "green" — applied to "some of it did not arrive".
 */
export function deliveryVerdict(
  ingest: string,
  attempts: readonly DeliveryAttempt[],
): DeliveryVerdict {
  if (attempts.length === 0) {
    return {
      code: 1,
      message:
        `the run produced no span: nothing was POSTed to ${ingest}. The adapter resolved and the ` +
        `request was served, so the span path between them emitted nothing to export.`,
    }
  }

  const failed = attempts.filter((a) => a.status === null)
  const refused = attempts.filter((a) => a.status !== null && a.status >= REFUSED_FROM)
  const accepted = attempts.filter((a) => a.status !== null && a.status < REFUSED_FROM)

  if (failed.length > 0) {
    const why = [...new Set(failed.map((a) => a.error ?? 'unknown transport error'))].join('; ')
    return {
      code: 1,
      message:
        `${String(failed.length)} of ${String(attempts.length)} deliveries to ${ingest} never ` +
        `reached the collector: ${why}. The adapter logs a failed flush and swallows it, so the ` +
        `run would otherwise have looked clean.`,
    }
  }

  if (refused.length > 0) {
    const statuses = [...new Set(refused.map((a) => String(a.status)))].join(', ')
    return {
      code: 1,
      message:
        `${ingest} refused the payload: HTTP ${statuses} on ${String(refused.length)} of ` +
        `${String(attempts.length)} deliveries. A span was built and the collector did not take it.`,
    }
  }

  const statuses = [...new Set(accepted.map((a) => String(a.status)))].join(', ')
  return {
    code: 0,
    message:
      `${String(accepted.length)} delivery/deliveries to ${ingest} accepted (HTTP ${statuses}). ` +
      `That is the collector's word at the transport, not its store's — read the marker back to ` +
      `close the last gap.`,
  }
}
