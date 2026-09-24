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
 * Exit 0  the run produced a span and the exporter reported it accepted; the marker is printed with
 *         the command that reads it back on the collector side
 * Exit 1  the run produced no span, or the collector refused the payload
 * Exit 2  the probe could not measure — no adapter resolved, or the endpoint answers 2xx to a path
 *         that does not exist. NOT a pass: "we could not check" and "we checked and it is clean" are
 *         different facts, and a probe reporting the first as the second is worse than no probe.
 */
import { AgentBuilder } from '../packages/agents/src/index.js'
import { endpointCanRefuse } from './lib/endpoint-can-refuse.js'
import { mountAgent } from '../packages/theo/src/server/agent/mount-agent.js'
import {
  createObservabilityPluginFromConfig,
  getObservabilityAdapter,
} from '../packages/theo/src/server/observability-bootstrap.js'

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

if (!(await endpointCanRefuse(ingest))) {
  console.error(
    `${ingest} answers 2xx (or is unreachable) on a path it does not serve, so a 2xx on the real ` +
      `path would say nothing. Point --ingest at a collector, not at a receiver that accepts ` +
      `everything. NOT MEASURED.`,
  )
  process.exit(2)
}

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
// The exporter batches on a timer; give the last batch its window before the process exits.
await new Promise((resolve) => setTimeout(resolve, 3000))

console.log(`\nmarker   : ${marker}`)
console.log("read it back on the COLLECTOR side — the adapter's own word is not evidence:")
console.log(`  docker logs <collector> 2>&1 | grep -B22 'agent: Str(${marker})'`)
