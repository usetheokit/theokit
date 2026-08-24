/**
 * The run span records the model, so tokens convert to a cost (B-019, fifth criterion).
 *
 * ## What was missing, and why tokens alone were not enough
 *
 * The exported `agent.run` span carried `agent`, `tokens.*`, `stop.reason`, and `cost.usd` when the
 * provider happened to report one. When it did not, the token counts were the only route to "what
 * did this run cost" — and tokens convert to nothing without a model, because price is per model.
 * So the span answered the cost question for exactly the providers that had already answered it.
 *
 * ## The attribute name is the spec's, not ours
 *
 * `gen_ai.request.model` — "the name of the GenAI model a request is being made to" — is the
 * registry entry in OpenTelemetry's GenAI semantic conventions
 * (`open-telemetry/semantic-conventions-genai`, `docs/registry/attributes/gen-ai.md`), read from
 * that source rather than adopted from a neighbour. It is also what the AI SDK's OpenTelemetry
 * integration emits for the same fact, which is what makes a trace from this framework readable by
 * a dashboard someone already has.
 *
 * ## B-022 — the fixture is the producer's output, not a hand-written guess
 *
 * The token attributes were absent for a whole milestone because the reader assumed a flat shape
 * and the test fixture was written from the same assumption, so the suite agreed with the bug. That
 * is registered as B-022 and it is the specific failure this file is arranged to avoid: nothing
 * below hand-writes a `finish` chunk. The metadata comes out of `realUsageDone` and through
 * `presentUIMessageStream` — the two production functions that build it — and the span reads
 * whatever those produce. Change either shape and this test goes red rather than staying green
 * against a fiction.
 *
 * ## Where the other half lives
 *
 * This file grades the SPAN side: given what the producer emits, does the model reach the
 * collector. Whether the producer emits the model that actually RAN — a per-run override beating
 * the declared model, an undeclared agent reporting the default it fell back to — is graded in
 * `packages/agents/tests/integration/effective-model-on-the-wire.test.ts`, against a mocked SDK and
 * the real adapter, because that is the layer where the resolution happens.
 */
import { describe, expect, it } from 'vitest'

import { presentUIMessageStream } from '../../packages/agents/src/bridge/present-ui-message-stream.js'
import { realUsageDone } from '../../packages/agents/src/bridge/sdk-adapter-create-options.js'
import type { AgentStreamEvent } from '../../packages/agents/src/bridge/agent-stream-events.js'
import { observeAgentRun } from '../../packages/theo/src/server/agent/observe-agent-run.js'
import { TheoCloudObservabilityAdapter } from '../../packages/theo/src/server/observability/adapters/theo-cloud.js'

const MODEL = 'anthropic/claude-sonnet-4-6'

interface ExportedSpan {
  name: string
  attributes: { key: string; value: Record<string, unknown> }[]
}

function createExportProbe() {
  const bodies: string[] = []
  const adapter = new TheoCloudObservabilityAdapter({
    ingestUrl: 'http://collector.invalid/v1/traces',
    token: 'probe',
    flushIntervalMs: 600_000,
    _mockFetch: ((_input: unknown, init: { body?: unknown } | undefined) => {
      bodies.push(new TextDecoder().decode(init?.body as Uint8Array))
      return Promise.resolve(new Response(null, { status: 200 }))
    }) as unknown as typeof globalThis.fetch,
  })

  return {
    adapter,
    async exported(): Promise<ExportedSpan[]> {
      await adapter.flush()
      return bodies.flatMap(
        (body) =>
          (
            JSON.parse(body) as {
              resourceSpans: { scopeSpans: { spans: ExportedSpan[] }[] }[]
            }
          ).resourceSpans[0].scopeSpans[0].spans,
      )
    },
  }
}

/**
 * The wire a real turn produces, built by the real producers.
 *
 * `realUsageDone` is what the SDK adapter yields as the terminal frame, over the `RunResult` shape
 * the SDK returns; `presentUIMessageStream` is what turns that into the chunks a surface receives.
 * The `model` argument is the value the adapter resolves before the turn starts.
 */
async function producedChunks(model: string | undefined): Promise<unknown[]> {
  const runResult = {
    result: 'done',
    usage: { inputTokens: 1200, outputTokens: 340 },
    cost: { amount: 0.0031 },
  }
  const done = realUsageDone(runResult, Date.now() - 8, model) as unknown as AgentStreamEvent
  async function* events(): AsyncGenerator<AgentStreamEvent> {
    yield done
  }
  const out: unknown[] = []
  for await (const chunk of presentUIMessageStream(events(), { textId: 'text-1' })) out.push(chunk)
  return out
}

async function runSpanFor(model: string | undefined): Promise<ExportedSpan> {
  const probe = createExportProbe()
  const chunks = await producedChunks(model)
  async function* replay(): AsyncGenerator {
    for (const chunk of chunks) yield chunk
  }
  const forwarded: unknown[] = []
  for await (const chunk of observeAgentRun(replay(), probe.adapter, { agent: 'chat' })) {
    forwarded.push(chunk)
  }
  // The translator must not change the stream it instruments, so the drain doubles as that check.
  expect(forwarded).toEqual(chunks)
  const spans = await probe.exported()
  const run = spans.find((s) => s.name === 'agent.run')
  if (run === undefined) throw new Error('no agent.run span in the exported payload')
  return run
}

function attributeOf(span: ExportedSpan, key: string): Record<string, unknown> | undefined {
  return span.attributes.find((a) => a.key === key)?.value
}

describe('the exported run span answers what the run cost (B-019)', () => {
  it('test_the_model_reaches_the_collector_under_the_otel_genai_attribute', async () => {
    const run = await runSpanFor(MODEL)

    // Read off the serialized OTLP body. Before this landed, the complete attribute set was
    // `agent`, `tokens.*`, `stop.reason` and sometimes `cost.usd` — no span recorded the model,
    // so the criterion's token route was closed.
    expect(attributeOf(run, 'gen_ai.request.model')).toEqual({ stringValue: MODEL })
  })

  it('test_the_model_arrives_beside_the_tokens_it_prices', async () => {
    const run = await runSpanFor(MODEL)

    // A model with no tokens prices nothing and tokens with no model convert to nothing. The
    // criterion is that BOTH are on the span an operator reads.
    expect(attributeOf(run, 'tokens.input')).toEqual({ intValue: '1200' })
    expect(attributeOf(run, 'tokens.output')).toEqual({ intValue: '340' })
    expect(attributeOf(run, 'tokens.total')).toEqual({ intValue: '1540' })
    expect(attributeOf(run, 'gen_ai.request.model')).toEqual({ stringValue: MODEL })
  })

  it('test_a_turn_whose_producer_reported_no_model_records_none_rather_than_a_guess', async () => {
    const run = await runSpanFor(undefined)

    // Absence over invention: a span asserting a model nobody ran would price the run wrongly,
    // which is worse than leaving the question open.
    expect(attributeOf(run, 'gen_ai.request.model')).toBeUndefined()
    expect(attributeOf(run, 'tokens.total')).toEqual({ intValue: '1540' })
  })
})
