/**
 * V4-L.2 — an invalid per-request `maxIterations` (< 1) must fail loudly via the
 * existing zod-validated `resolveLoopStrategy`, never start a silent unbounded loop.
 * The override re-resolves the strategy in `stream()`, so the throw surfaces at the
 * call site (the body runs eagerly — `stream()` is a regular method, not an async gen).
 */
import 'reflect-metadata'
import { MainLoopCapability } from '../../src/capability/agent-capabilities.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { describe, expect, it } from 'vitest'

import { AgentRunner } from '../../src/index.js'

const mlAgent = applyCapabilities([
  new ModelCapability('m'),
  new MainLoopCapability({ maxIterations: 8 }),
])

describe('V4-L.2 invalid maxIterations fails loudly', () => {
  it('test_maxIterations_zero_throws_at_stream', () => {
    const runner = AgentRunner.fromSpec({
      compiled: mlAgent,
      agentName: 'mlAgent',
      strategy: 'react',
    }).build()
    // zod `.int().min(1)` in resolveLoopStrategy rejects 0 synchronously at stream() call.
    expect(() => runner.stream('x', { apiKey: 'k', maxIterations: 0 })).toThrow()
  })

  it('test_maxIterations_negative_throws_at_stream', () => {
    const runner = AgentRunner.fromSpec({
      compiled: mlAgent,
      agentName: 'mlAgent',
      strategy: 'react',
    }).build()
    expect(() => runner.stream('x', { apiKey: 'k', maxIterations: -3 })).toThrow()
  })
})
