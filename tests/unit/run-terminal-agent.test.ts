/**
 * M5 (theokit-ai-first) — runAgentInTerminal: the terminal sibling of mount-agent.
 *
 * Wires the M4 harness (compileAgentModule + streamAgentUIMessages) to the terminal render surface +
 * the shared approval registry. Here `@theokit/agents` is stubbed so the chunk stream is deterministic
 * (no LLM); the test proves the WIRING: a gated agent renders the approval prompt, on approve the run
 * continues to the tool output, on deny the denial surfaces, and a non-gated agent never prompts. The
 * real pause (the SDK's awaited pre_tool_call hook) is proven by M4's hitl-harness E2E.
 */
import { Writable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

interface Chunk {
  type: string
  [k: string]: unknown
}

const hoisted = vi.hoisted(() => ({ chunks: [] as Chunk[], lastStreamInput: null as unknown }))

vi.mock('@theokit/agents', () => ({
  // Pass a pre-built compiled agent through the mod wrapper (avoids the decorator compile path here).
  compileAgentModule: (mod: { __compiled: unknown }) => mod.__compiled,
  streamAgentUIMessages: (_compiled: unknown, _apiKey: string, input: unknown) => {
    hoisted.lastStreamInput = input
    return (async function* () {
      for (const c of hoisted.chunks) yield c
    })()
  },
}))

const { runAgentInTerminal } =
  await import('../../packages/theo/src/server/agent/run-terminal-agent.js')

function captureStdout() {
  let text = ''
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += String(chunk)
      cb()
    },
  })
  return { stream, get: () => text }
}

/** A fake registry with spies — the wiring test asserts on resolve() without a live pause. */
function fakeRegistry() {
  return { register: vi.fn(), resolve: vi.fn().mockReturnValue(true) }
}

const GATED = {
  __compiled: { hitl: new Map([['ops.deploy', { question: 'Deploy?' }]]), tools: [], stream: true },
}
const PLAIN = { __compiled: { tools: [], stream: true } }

describe('runAgentInTerminal (M5)', () => {
  it('test_e2e_terminal_pause_approve_runs_tool_then_done', async () => {
    hoisted.chunks = [
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'ops.deploy',
        input: { env: 'prod' },
      },
      { type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'deployed' },
      { type: 'finish' },
    ]
    const out = captureStdout()
    const registry = fakeRegistry()
    const promptApproval = vi.fn().mockResolvedValue(true)

    await runAgentInTerminal(GATED, 'k', {
      message: 'deploy',
      stdout: out.stream,
      registry,
      promptApproval,
    })

    // Prompted for the gated tool, approved → registry resolved true → the tool output rendered after.
    expect(promptApproval).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'ops.deploy' }))
    expect(registry.resolve).toHaveBeenCalledWith('c1', true)
    expect(out.get()).toContain('✓ deployed')
    // The stream received the HITL wiring (gated map threaded through).
    expect((hoisted.lastStreamInput as { hitl?: unknown }).hitl).toBeDefined()
  })

  it('test_e2e_terminal_deny_surfaces_denied_and_continues', async () => {
    hoisted.chunks = [
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'ops.deploy', input: {} },
      { type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' },
      {
        type: 'tool-output-available',
        toolCallId: 'c1',
        output: 'Plugin blocked this tool call: denied',
      },
      { type: 'finish' },
    ]
    const out = captureStdout()
    const registry = fakeRegistry()
    const promptApproval = vi.fn().mockResolvedValue(false)

    await runAgentInTerminal(GATED, 'k', {
      message: 'deploy',
      stdout: out.stream,
      registry,
      promptApproval,
    })

    expect(registry.resolve).toHaveBeenCalledWith('c1', false)
    // The denial surfaced and the render continued to completion (no crash).
    expect(out.get()).toContain('blocked this tool call')
  })

  it('test_e2e_terminal_non_gated_runs_without_prompt', async () => {
    hoisted.chunks = [
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'hello' },
      { type: 'text-end', id: 't0' },
      { type: 'finish' },
    ]
    const out = captureStdout()
    const registry = fakeRegistry()
    const promptApproval = vi.fn()

    await runAgentInTerminal(PLAIN, 'k', {
      message: 'hi',
      stdout: out.stream,
      registry,
      promptApproval,
    })

    expect(promptApproval).not.toHaveBeenCalled()
    expect(out.get()).toContain('hello')
    // No gated tools ⇒ no hitl wiring threaded into the stream.
    expect((hoisted.lastStreamInput as { hitl?: unknown }).hitl).toBeUndefined()
  })
})
