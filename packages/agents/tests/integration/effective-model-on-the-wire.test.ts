/**
 * The model a turn ran on travels to whoever only sees the wire (usetheokit/theokit#368).
 *
 * ## Why the wire, and not the compiled agent
 *
 * The consumer that needs this is the framework's observability translator: it reads the chunk
 * stream and records the model on the run span, beside the token counts, because tokens without a
 * model convert to no cost. It could have read `CompiledAgentOptions.model` from the HTTP route
 * instead — and would have been wrong twice. A per-run override wins over the declared model, and
 * an agent that declares nothing still runs on the adapter's default. Both cases price differently
 * from what the declaration says.
 *
 * The wire is also the only path the three targets share. A model read inside the HTTP route is a
 * model Tauri and a terminal never see.
 *
 * ## What is mocked
 *
 * Only `@theokit/sdk`, exactly as `stop-reason.test.ts` does and for the same reason. The real
 * `createSdkAgentStream`, `presentUIMessageStream` and `streamAgentUIMessages` run — the last being
 * what `mountAgent` calls — so what is asserted is that the resolved value survives every layer
 * between the resolution site and the wire, not that a helper returns its argument.
 */
import 'reflect-metadata'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'

const h = vi.hoisted(() => ({
  waitResult: {} as Record<string, unknown>,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn((id: string) =>
      Promise.resolve({
        agentId: id,
        send: () =>
          Promise.resolve({
            events: async function* () {
              yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
            },
            wait: () => Promise.resolve(h.waitResult),
          }),
        dispose: () => Promise.resolve(),
      }),
    ),
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

function agent(model?: string): CompiledAgentOptions {
  return compileAgentDefinition(model === undefined ? defineAgent({}) : defineAgent({ model }))
}

/** The framework-level terminal frame `createSdkAgentStream` ends on. */
async function terminalFrame(
  compiled: CompiledAgentOptions,
  overrides?: { model?: string },
): Promise<Record<string, unknown>> {
  const stream = createSdkAgentStream(
    compiled,
    [],
    'test-key',
    overrides,
  )('go', `sess-${Math.random()}`)
  let last: Record<string, unknown> | undefined
  for await (const event of stream) last = event as Record<string, unknown>
  if (last?.type !== 'done') throw new Error(`expected a terminal done, got ${String(last?.type)}`)
  return last
}

/** The `messageMetadata` riding the wire `finish` chunk — what a served surface reconstructs. */
async function finishMetadata(
  compiled: CompiledAgentOptions,
): Promise<Record<string, unknown> | undefined> {
  const chunks: Record<string, unknown>[] = []
  for await (const chunk of streamAgentUIMessages(compiled, 'test-key', {
    message: 'go',
    sessionId: `sess-${Math.random()}`,
  })) {
    chunks.push(chunk as unknown as Record<string, unknown>)
  }
  const finish = chunks.at(-1)
  expect(finish?.type).toBe('finish')
  return finish?.messageMetadata as Record<string, unknown> | undefined
}

describe('the effective model reaches the terminal frame', () => {
  beforeEach(() => {
    h.waitResult = { result: 'ok', usage: { inputTokens: 10, outputTokens: 2 } }
  })

  it('test_the_declared_model_is_reported_when_nothing_overrides_it', async () => {
    expect(await terminalFrame(agent('anthropic/claude-sonnet-4-6'))).toMatchObject({
      model: 'anthropic/claude-sonnet-4-6',
    })
  })

  it('test_a_per_run_override_is_what_gets_reported', async () => {
    // The case that decides why this is read at the adapter and not off the compiled agent: the
    // run is priced against what it ran on, and an override changes that per request.
    const frame = await terminalFrame(agent('openai/gpt-4o-mini'), {
      model: 'anthropic/claude-opus-4-1',
    })

    expect(frame).toMatchObject({ model: 'anthropic/claude-opus-4-1' })
  })

  it('test_an_agent_that_declared_no_model_reports_the_default_it_actually_ran', async () => {
    // The adapter's silent fallback. Reading the declaration here would report NOTHING for a run
    // that genuinely consumed tokens — the worst of the three outcomes, because it looks like a
    // free run instead of an unpriced one.
    expect(await terminalFrame(agent())).toMatchObject({ model: 'openai/gpt-4o-mini' })
  })
})

describe('the effective model reaches the served wire', () => {
  beforeEach(() => {
    h.waitResult = { result: 'ok', usage: { inputTokens: 10, outputTokens: 2 } }
  })

  it('test_the_finish_chunk_metadata_carries_the_model_beside_the_tokens', async () => {
    // `streamAgentUIMessages` is what `mountAgent` and the thread route both call, and
    // `messageMetadata` is what the observability translator reads. A model that stops at the
    // framework frame is a model no span can record.
    const metadata = await finishMetadata(agent('anthropic/claude-sonnet-4-6'))

    expect(metadata).toMatchObject({
      model: 'anthropic/claude-sonnet-4-6',
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    })
  })
})
