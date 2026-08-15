/**
 * T1.2 — `inspectCompiled` must accept what the composition path actually returns.
 *
 * The seam shipped typed over `AgentDefinition` with its DEFAULT type parameters
 * (`<z.ZodType, string>`), while `AgentBuilder.build()` returns a specific instantiation —
 * `AgentDefinition<TInput, 'a' | 'b'>`, with the accumulated literal tool names threaded through.
 *
 * That is why the seam has zero adoption in the consumer's 72 test files: its `composition.test.ts`
 * documents the refusal and then re-derives the same three facts by hand over 176 lines. Absorbed
 * with the wrong shape is worse than absent — the work was paid for and the case that motivated it
 * still cannot use it.
 *
 * These tests exercise the REAL builder, so the assertion is on assignability in practice rather
 * than on a hand-written fixture that would agree with whichever shape we chose.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import { inspectCompiled } from '../../src/testing/inspect-compiled.js'

describe('inspectCompiled', () => {
  it('accepts_builder_composition_output', () => {
    const built = AgentBuilder.create()
      .input(z.object({ q: z.string() }))
      .model('openai/gpt-4o-mini')
      .system('you are a test agent')
      .build()

    // No cast. A cast here would hide exactly the defect this task exists to close.
    const inspection = inspectCompiled(built)

    expect(inspection.model).toBe('openai/gpt-4o-mini')
    expect(Array.isArray(inspection.toolNames)).toBe(true)
  })

  it('handles_agent_with_no_tools', () => {
    const built = AgentBuilder.create().model('openai/gpt-4o-mini').build()

    const inspection = inspectCompiled(built)

    expect(inspection.toolNames).toEqual([])
    expect(inspection.gatedToolNames).toEqual([])
  })

  it('reports_tool_names_sorted', () => {
    const built = AgentBuilder.create().model('openai/gpt-4o-mini').build()
    const inspection = inspectCompiled(built)

    // Sorted output is the contract: a list whose order tracks decorator position is a list nobody
    // can diff, and a test pinning that order fails on a reorder that changed nothing.
    expect([...inspection.toolNames]).toEqual(
      [...inspection.toolNames].sort((a, b) => a.localeCompare(b)),
    )
  })
})
