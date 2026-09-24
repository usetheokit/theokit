#!/usr/bin/env -S npx tsx
/**
 * Report whether a run started from a production entry point lands a span on a real collector.
 *
 * B-199 — every in-tree exercise of the span path substitutes the transport (`_mockFetch` appears
 * six times in `packages/theo/tests/observability/theo-cloud-adapter.test.ts`), so the code that
 * BUILDS a span was covered and the claim that a span ARRIVES was not. `honesty-gate-golden-rule.md`
 * names that substitution: confirming a claim against the REPORT of a thing rather than the thing.
 *
 * WHY NOT A UNIT TEST. The question is whether bytes leave this process and are accepted, parsed and
 * stored by something that speaks OTLP. A test that owns both ends answers a different question. This
 * needs a collector standing, which is why it is a probe and not part of any suite.
 *
 * WHAT IT DRIVES. `mountAgent` — the function every deploy adapter and the vite middleware call —
 * with the adapter resolved by `createObservabilityPluginFromConfig`, the real boot. Nothing is
 * stubbed: no mock fetch, no hand-built adapter, no injected exporter.
 *
 * THE CONTROL IS THE POINT. A measurement that can only pass proves nothing. The first endpoint this
 * was pointed at answered 200 on `/v1/traces` AND 200 on a path that does not exist — a hand-written
 * receiver that cannot refuse, which would have made "a POST left the process" read as "a span was
 * accepted". So the probe refuses to measure until the endpoint has demonstrated it can say no.
 *
 *   docker run -d --name otel -p 14318:4318 otel/opentelemetry-collector-contrib:latest
 *   npx tsx scripts/probe-otlp-delivery.ts --ingest http://127.0.0.1:14318/v1/traces
 *
 * WHAT IS OBSERVED, AND WHY THAT IS NOT A STUB. The adapter reports nothing: its `flush()` awaits the
 * POST for its side effect and discards the response, catching and logging a transport error without
 * rethrowing (`adapters/theo-cloud.ts:114-128`). So `await flush()` resolved identically whether the
 * span was stored, refused with a 500, or never sent — and this probe claimed an acceptance nobody
 * had read (B-294). Measured: against a receiver that refused an unknown path and answered 404 on
 * `/v1/traces`, the span was REFUSED and the probe exited 0, printing the epilogue below. The answer
 * exists at exactly one place, the transport, so `recordDeliveriesTo` wraps `fetch` and DELEGATES to
 * the real one — same request, same collector, same response handed back — and notes the status. A
 * stub answers in place of the system; this reads over its shoulder. The wrapper is installed only
 * after the control has passed, and matches the ingest URL exactly: the control POSTs to a path the
 * collector does not serve and expects a refusal, and a recorder already listening would have booked
 * that as a failed delivery.
 *
 * Exit 0  a span left the process, reached the collector and was not refused (HTTP < 400, the same
 *         boundary the control uses). That is the collector's word at the transport and NOT its
 *         store's — an endpoint can accept a payload and drop it in a pipeline behind the port —
 *         which is why the marker is still printed with the command that reads it back
 * Exit 1  the run produced no span, the collector refused the payload, or the transport never
 *         reached it. Reachable: point --ingest at a host that answers at or above 400 on the real
 *         path as well as on an unknown one
 * Exit 2  the probe could not measure. Five conditions reach it: `--ingest` is not a URL, nothing
 *         answered at it, it accepted the connection and answered nothing within `--timeout-ms`,
 *         it answered below 400 on a path it does not serve, or the boot resolved no adapter. NOT a pass: "we could not check" and "we checked and it is
 *         clean" are different facts, and a probe reporting the first as the second is worse than
 *         no probe. Each condition prints its own cause — a shared exit code is not a shared
 *         diagnosis, and naming the wrong one sends the reader to the wrong system.
 */
import { AgentBuilder } from '../packages/agents/src/index.js'
import { mountAgent } from '../packages/theo/src/server/agent/mount-agent.js'
import {
  createObservabilityPluginFromConfig,
  getObservabilityAdapter,
} from '../packages/theo/src/server/observability-bootstrap.js'

import {
  DEFAULT_TIMEOUT_MS,
  endpointCanRefuse,
  type EndpointVerdict,
} from './lib/endpoint-can-refuse.js'
import { deliveryVerdict, recordDeliveriesTo } from './lib/otlp-delivery.js'

/**
 * `.at()` rather than `[i + 1]` on purpose. This repository leaves `noUncheckedIndexedAccess` off, so
 * the index form is typed `string` while `--ingest` passed as the LAST argument produces `undefined`
 * at run time — and a lint that reads the type then calls the guard against it unnecessary. Obeying
 * that would turn a real check into `new URL(undefined)`. `.at()` is typed `string | undefined`, which
 * is what the value actually is, so the type and the run time agree and no guard has to be argued for.
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return (i >= 0 ? process.argv.at(i + 1) : undefined) ?? fallback
}

const ingest = arg('ingest', 'http://127.0.0.1:14318/v1/traces')
const marker = `otlp-probe-${String(Date.now())}`
/** How long the endpoint has to answer. Raise it for a collector behind a slow link. */
const TIMEOUT_MS = Number(arg('timeout-ms', String(DEFAULT_TIMEOUT_MS)))

// One message per cause, because they send the reader to different systems. This used to be a single
// sentence for every refusal — the guard returned a boolean — and it named a cause it had not
// observed: a socket that completed the handshake and then said nothing was reported as "answers
// below 400 (or is unreachable)", sending an operator to replace a collector that worked. The header
// above states the rule; this switch is what keeps it.
const NOT_MEASURED: Record<Exclude<EndpointVerdict, 'refuses'>, string> = {
  unparseable:
    `--ingest could not be read as a URL: ${ingest}. It needs a scheme — this probe speaks HTTP, so ` +
    `http:// or https://.`,
  permissive:
    `${ingest} answers below 400 on a path it does not serve, so a success on the real path would ` +
    `say nothing. Point --ingest at a collector, not at a receiver that accepts everything.`,
  unreachable:
    `nothing answered at ${ingest} — the connection was refused or the host did not resolve. ` +
    `Check that the collector is running and the port is right.`,
  'timed-out':
    `${ingest} accepted the connection and sent no answer within ${String(TIMEOUT_MS)}ms. The host ` +
    `is up and the process behind the port is not answering; this is not a wrong address.`,
}

const verdict = await endpointCanRefuse(ingest, TIMEOUT_MS)
if (verdict !== 'refuses') {
  console.error(`${NOT_MEASURED[verdict]} NOT MEASURED.`)
  process.exit(2)
}

// Installed HERE and not a line earlier: the control above deliberately POSTs to a path the
// collector does not serve and needs to be refused, so a recorder already listening would have
// counted that refusal as a failed delivery and turned every healthy collector into an exit 1.
const realFetch = globalThis.fetch
const { fetch: recordingFetch, attempts } = recordDeliveriesTo(ingest, realFetch)
globalThis.fetch = recordingFetch

const plugin = createObservabilityPluginFromConfig(
  {},
  { THEO_CLOUD_INGEST_URL: ingest, THEO_CLOUD_API_KEY: 'otlp-probe', NODE_ENV: 'production' },
)
const adapter = getObservabilityAdapter()
if (plugin === undefined || adapter === undefined) {
  console.error(
    'the boot resolved no adapter, so `observeServedRun` would pass the stream through untouched ' +
      'and no span would exist to deliver. NOT MEASURED.',
  )
  process.exit(2)
}
console.log(`adapter  : ${adapter.name}`)

const mod = {
  default: AgentBuilder.create().model('anthropic/claude-sonnet-4-6').system('probe').build(),
}
const response = await mountAgent(
  mod,
  new Request(`http://localhost/api/agents/${marker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
    body: JSON.stringify({ message: 'hi' }),
  }),
  () => 'probe-key',
  { agentName: marker },
)
console.log(`mount    : HTTP ${String(response.status)}`)

// Draining the body IS the run: the spans are produced from the chunk stream, not from the call.
const body = await response.text()
console.log(`drained  : ${String(body.length)} bytes`)

await (adapter as { flush?: () => Promise<void> }).flush?.()
// The exporter batches on a timer; give the last batch its window before the process exits. The
// recorder is still installed through this window on purpose — a flush the timer fires here is a
// delivery like any other, and restoring `fetch` first would lose it.
await new Promise((resolve) => setTimeout(resolve, 3000))
globalThis.fetch = realFetch

const delivered = deliveryVerdict(ingest, attempts)
if (delivered.code !== 0) {
  // Exit 1, not 2. "We measured and it failed" and "we could not measure" are different facts, and
  // this probe exists to keep them apart — the header says so and every exit 2 above is the other
  // one. Until B-294 this branch was unreachable and only an uncaught exception produced a 1.
  console.error(`delivery : ${delivered.message}`)
  process.exit(1)
}

console.log(`delivery : ${delivered.message}`)
console.log(`\nmarker   : ${marker}`)
console.log("read it back on the COLLECTOR side — the adapter's own word is not evidence:")
console.log(`  docker logs <collector> 2>&1 | grep -B22 'agent: Str(${marker})'`)
// Explicit, so exit 0 is a statement this file makes rather than the absence of anything else.
process.exit(0)
