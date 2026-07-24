/**
 * M54 LIVE proof — a custom loop stop-criterion, injected via `.loopStrategy()`, drives a REAL
 * provider run and terminates. Run with a provider key:
 *
 *   node --env-file=<agent-builder>/.env node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 *
 * Why live: the whole point of M54 is that a caller-injected stop criterion is bounded by the
 * runner. A unit test with a fake stream factory proves the control flow; only a real round-trip
 * proves the seam works end-to-end against a provider that actually calls tools.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { applyCapabilities } from '../../src/capability/capability.js'
import { AgentConfigCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { ToolboxCapability, type ToolDeclaration } from '../../src/capability/toolbox.js'
import { AgentRunner } from '../../src/loop/agent-runner.js'
import type { LoopStrategy, LoopOutcome } from '../../src/loop/loop-strategy.js'

const MODEL = process.env.LIVE_MODEL ?? 'google/gemini-2.5-flash-lite'
const KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'THEOKIT_API_KEY']
const HAS_KEY = KEYS.some((n) => (process.env[n] ?? '').length > 0)

function apiKey(): string {
  for (const n of KEYS) {
    const v = process.env[n]
    if (v !== undefined && v.length > 0) return v
  }
  throw new Error('no provider key present')
}

class CounterTools {
  static readonly tools: ToolDeclaration[] = [
    {
      name: 'tick',
      description:
        'Advance a counter by one and return the new value. Call it, then report the value.',
      input: z.object({}),
      method: 'tick',
    },
  ]
  value = 0
  tick(): string {
    this.value += 1
    return String(this.value)
  }
}

describe.skipIf(!HAS_KEY)('M54 LIVE — custom loopStrategy against a real provider', () => {
  it('a custom stop criterion drives a real run and the runner ceiling bounds it', async () => {
    const rounds: number[] = []
    // Custom: keep going while the model is still calling tools — but the runner caps it at 2.
    const stopWhenNoTools: LoopStrategy = {
      name: 'while-tool-calling',
      maxIterations: 2,
      shouldContinue: (o: LoopOutcome) => {
        rounds.push(o.round)
        return o.finishReason === 'tool-calls'
      },
    }

    const compiled = applyCapabilities([
      new ModelCapability(MODEL),
      new AgentConfigCapability({
        systemPrompt: 'You have a `tick` tool. Call it a few times, then state the final counter.',
      }),
      new ToolboxCapability(new CounterTools(), { namespace: 'ctr' }),
    ])

    const runner = AgentRunner.fromSpec({
      compiled,
      name: 'counter',
      strategy: 'react',
    })
      .loopStrategy(stopWhenNoTools)
      .build()

    console.log(
      `[live] injected strategy: ${runner.loopStrategy.name} (max ${runner.loopStrategy.maxIterations})`,
    )

    const result = await runner.run('Use the tick tool, then report the counter.', {
      apiKey: apiKey(),
    })

    console.log(`[live] rounds observed by the custom shouldContinue: ${JSON.stringify(rounds)}`)
    console.log(`[live] finishReason: ${result.finishReason}`)
    console.log(`[live] response: ${result.response.slice(0, 200)}`)

    // The custom ran (it observed at least one round) and the runner bounded it at maxIterations=2.
    expect(rounds.length).toBeGreaterThan(0)
    expect(Math.max(...rounds)).toBeLessThanOrEqual(2)
    // A run that hit the ceiling reports step_limit; one the model ended itself reports stop. Either
    // is a clean termination — never an infinite loop.
    expect(['step_limit', 'stop', 'length']).toContain(result.finishReason)
  }, 120_000)
})
