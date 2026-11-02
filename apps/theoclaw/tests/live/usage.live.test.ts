import { afterAll, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import { createContainer } from '../../src/composition.js'
import { controlOptions } from '../../src/control-plane/control-wiring.js'
import { type ControlPlaneHandle, healthHandler, listenControlPlane } from '../../src/control-plane/listener.js'
import type { TurnAgent } from '../../src/control-plane/turn.js'
import { runControlTurn } from './support/control-turn.js'
import { type RecordingProxy, startRecordingProxy } from './support/recording-proxy.js'

/**
 * AC-007 (B-400, OC-97): one real `/control` turn through TheoClaw's own runner and socket, its
 * model reached through a loopback proxy that records the provider's own usage response. Runs only
 * with THEOCLAW_LIVE=1, THEOCLAW_MODEL and a key; without the flag it skips, so CI stays offline.
 * `THEOCLAW_LIVE_UPSTREAM` is the provider's OpenAI-compatible base (default OpenRouter's).
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const TURN_TIMEOUT_MS = 120_000
const TOKEN = `usage-live-control-token-${Date.now()}-0123456789`
const UPSTREAM = process.env.THEOCLAW_LIVE_UPSTREAM ?? 'https://openrouter.ai/api/v1'

const closers: Array<() => Promise<void>> = []

afterAll(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

describe.skipIf(!LIVE)('usage and cost against a real model (OC-97)', () => {
  it("the done frame's tokens equal the provider's usage response and are above 0", { timeout: TURN_TIMEOUT_MS }, async () => {
    const model = process.env.THEOCLAW_MODEL
    const key = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
    if (!model || !key) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL and THEOKIT_API_KEY or OPENROUTER_API_KEY')
    const proxy: RecordingProxy = await startRecordingProxy(UPSTREAM)
    closers.push(() => proxy.close())
    const build = async (): Promise<TurnAgent> =>
      (await createTheoClawAgent(theoClawAgentOptions({ model: { id: model, url: proxy.url }, apiKey: key }))) as unknown as TurnAgent
    const stderr: string[] = []
    const handle: ControlPlaneHandle = await listenControlPlane({
      handler: healthHandler,
      port: 0,
      host: '127.0.0.1',
      control: controlOptions(TOKEN, createContainer<TurnAgent>({ factory: build }).withAgent, build, (line) => void stderr.push(line), [key], model),
      stderr: (line) => void stderr.push(line),
    })
    closers.push(() => handle.close())

    const turn = await runControlTurn(handle.address().port, TOKEN, 'Reply with exactly the word: pong', TURN_TIMEOUT_MS - 10_000)

    expect(turn.status, turn.error).toBe('finished')
    const done = turn.frames.find((frame) => frame.type === 'done') as {
      usage: { inputTokens: number; outputTokens: number }
      model: string
      costUsd?: number
      costUnpriced?: true
    }
    // The independent source: the provider's own usage response, as the proxy captured it.
    const promptTokens = proxy.usages.reduce((sum, usage) => sum + (usage.prompt_tokens ?? 0), 0)
    const completionTokens = proxy.usages.reduce((sum, usage) => sum + (usage.completion_tokens ?? 0), 0)
    expect(proxy.usages.length).toBeGreaterThan(0)
    expect(done.usage.inputTokens).toBeGreaterThan(0)
    expect(done.usage.outputTokens).toBeGreaterThan(0)
    expect(done.usage).toEqual({ inputTokens: promptTokens, outputTokens: completionTokens })
    expect(done.model).toBe(model)
    // A priced run carries a finite positive amount; an unpriced one says so and is never 0.
    if (done.costUsd === undefined) expect(done.costUnpriced).toBe(true)
    else expect(done.costUsd).toBeGreaterThan(0)
    const cost = done.costUsd === undefined ? /^cost=unpriced$/ : /^cost=\$\d+(\.\d+)?$/
    const line = stderr.find((entry) => entry.startsWith('theoclaw: usage '))
    expect(line?.split(' ')).toEqual(['theoclaw:', 'usage', 'control', model, `in=${promptTokens}`, `out=${completionTokens}`, expect.stringMatching(cost)])
    for (const entry of stderr) expect(entry).not.toContain(key)
  })
})
