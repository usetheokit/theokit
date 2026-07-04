/**
 * M5 (theokit-ai-first) — the terminal render surface for the M4 harness.
 *
 * `renderAgentStreamToTerminal` maps each `UIMessageChunk` to terminal output on an INJECTED sink
 * (no `process.*`) and delegates HITL approval to an injected `onApproval`; `promptTerminalApproval`
 * is the readline `y/n` prompt that auto-denies on a non-interactive terminal (ADR-M5b fail-safe).
 * Both are driven here with a capture `Writable` + scripted streams — no TTY, no LLM.
 */
import { PassThrough, Writable } from 'node:stream'

import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import {
  promptTerminalApproval,
  renderAgentStreamToTerminal,
} from '../../packages/theo/src/server/agent/render-terminal.js'

/** A non-TTY capture sink — accumulates writes into a plain string (no ANSI, since isTTY is falsy). */
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

async function* fromChunks(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  for (const c of chunks) yield c
}

describe('renderAgentStreamToTerminal (M5)', () => {
  it('test_renders_text_tool_and_checkpoint_chunks_to_stdout', async () => {
    const out = captureStdout()
    const chunks = [
      { type: 'start' },
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'Deploying' },
      { type: 'text-end', id: 't0' },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'ops.deploy',
        input: { env: 'prod' },
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'c1', output: 'deployed' },
      { type: 'data-checkpoint', data: { resumeToken: 's1' }, transient: true },
      { type: 'finish' },
    ] as unknown as UIMessageChunk[]

    await renderAgentStreamToTerminal(fromChunks(chunks), {
      stdout: out.stream,
      onApproval: vi.fn(),
    })

    const text = out.get()
    expect(text).toContain('Deploying')
    expect(text).toContain('▸ ops.deploy(')
    expect(text).toContain('"env":"prod"')
    expect(text).toContain('✓ deployed')
    expect(text).toContain('checkpoint saved')
  })

  it('test_calls_onApproval_on_tool_approval_request_with_tool_name', async () => {
    const out = captureStdout()
    const onApproval = vi.fn().mockResolvedValue(undefined)
    const chunks = [
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'ops.deploy',
        input: {},
        dynamic: true,
      },
      { type: 'tool-approval-request', approvalId: 'c1', toolCallId: 'c1' },
      { type: 'finish' },
    ] as unknown as UIMessageChunk[]

    await renderAgentStreamToTerminal(fromChunks(chunks), { stdout: out.stream, onApproval })

    expect(onApproval).toHaveBeenCalledTimes(1)
    expect(onApproval).toHaveBeenCalledWith({ approvalId: 'c1', toolName: 'ops.deploy' })
  })

  it('test_renderer_surfaces_error_chunk_and_returns_sawError', async () => {
    const out = captureStdout()
    const chunks = [
      { type: 'error', errorText: 'kaboom' },
      { type: 'finish' },
    ] as unknown as UIMessageChunk[]
    const result = await renderAgentStreamToTerminal(fromChunks(chunks), {
      stdout: out.stream,
      onApproval: vi.fn(),
    })
    expect(out.get()).toContain('✗ kaboom')
    // The error signal is returned so the CLI can exit non-zero (fail-loud, not silent exit 0).
    expect(result).toEqual({ sawError: true })
  })

  it('test_clean_run_returns_sawError_false', async () => {
    const out = captureStdout()
    const chunks = [
      { type: 'text-delta', id: 't0', delta: 'ok' },
      { type: 'finish' },
    ] as unknown as UIMessageChunk[]
    const result = await renderAgentStreamToTerminal(fromChunks(chunks), {
      stdout: out.stream,
      onApproval: vi.fn(),
    })
    expect(result).toEqual({ sawError: false })
  })

  it('test_renders_non_string_tool_output_as_json', async () => {
    // The SDK types tool output as `unknown`; a non-string output must not render blank (review LOW).
    const out = captureStdout()
    const chunks = [
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 't', input: {}, dynamic: true },
      { type: 'tool-output-available', toolCallId: 'c1', output: { status: 'ok', count: 3 } },
      { type: 'finish' },
    ] as unknown as UIMessageChunk[]
    await renderAgentStreamToTerminal(fromChunks(chunks), {
      stdout: out.stream,
      onApproval: vi.fn(),
    })
    expect(out.get()).toContain('"status":"ok"')
  })

  it('test_tool_output_error_renders_error_line', async () => {
    const out = captureStdout()
    const chunks = [
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 't', input: {}, dynamic: true },
      { type: 'tool-output-error', toolCallId: 'c1', errorText: 'tool failed' },
      { type: 'finish' },
    ] as unknown as UIMessageChunk[]
    await renderAgentStreamToTerminal(fromChunks(chunks), {
      stdout: out.stream,
      onApproval: vi.fn(),
    })
    expect(out.get()).toContain('✗ tool failed')
  })
})

/** A TTY-flagged pair of streams for the interactive prompt path. */
function ttyIO() {
  const input = new PassThrough() as PassThrough & { isTTY?: boolean }
  input.isTTY = true
  let text = ''
  const output = new Writable({
    write(chunk, _enc, cb) {
      text += String(chunk)
      cb()
    },
  }) as Writable & { isTTY?: boolean }
  output.isTTY = true
  return { input, output, get: () => text }
}

describe('promptTerminalApproval (M5)', () => {
  it('test_prompt_returns_true_on_y', async () => {
    const io = ttyIO()
    const p = promptTerminalApproval(
      { toolName: 'ops.deploy' },
      { input: io.input, output: io.output },
    )
    io.input.write('y\n')
    expect(await p).toBe(true)
    expect(io.get()).toContain('Approve ops.deploy?')
  })

  it('test_prompt_returns_false_on_n', async () => {
    const io = ttyIO()
    const p = promptTerminalApproval(
      { toolName: 'ops.deploy' },
      { input: io.input, output: io.output },
    )
    io.input.write('n\n')
    expect(await p).toBe(false)
  })

  it('test_prompt_defaults_to_deny_on_empty', async () => {
    const io = ttyIO()
    const p = promptTerminalApproval(
      { toolName: 'ops.deploy' },
      { input: io.input, output: io.output },
    )
    io.input.write('\n')
    expect(await p).toBe(false) // capital N default — empty is a deny
  })

  it('test_prompt_times_out_and_denies_so_the_cli_never_hangs', async () => {
    // The prompt shares the gated tool's timeout so it can't outlive the registry-settled run (review
    // M1). No input arrives → the timer fires → deny. Uses fake timers for determinism.
    vi.useFakeTimers()
    try {
      const io = ttyIO()
      const p = promptTerminalApproval(
        { toolName: 'ops.deploy' },
        { input: io.input, output: io.output },
        1000,
      )
      vi.advanceTimersByTime(1001)
      expect(await p).toBe(false)
      expect(io.get()).toContain('timed out')
    } finally {
      vi.useRealTimers()
    }
  })

  it('test_prompt_non_tty_auto_denies_without_prompting', async () => {
    // Non-interactive (piped/CI) → auto-deny, no question written (ADR-M5b fail-safe).
    let text = ''
    const output = new Writable({
      write(chunk, _enc, cb) {
        text += String(chunk)
        cb()
      },
    }) as Writable & { isTTY?: boolean }
    // output.isTTY stays undefined → non-interactive.
    const input = new PassThrough() as PassThrough & { isTTY?: boolean }
    const result = await promptTerminalApproval({ toolName: 'ops.deploy' }, { input, output })
    expect(result).toBe(false)
    expect(text).toContain('Non-interactive')
    expect(text).not.toContain('(y/N)')
  })
})
