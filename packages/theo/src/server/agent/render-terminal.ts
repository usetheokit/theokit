/**
 * M5 (theokit-ai-first) — the terminal render surface for the M4 agent harness.
 *
 * Consumes the M4 `UIMessageChunk` stream (`streamAgentUIMessages`) and writes it to the terminal:
 * streaming text, a dim reasoning line, `▸ tool(input)` / result cards, a checkpoint notice, errors.
 * On a HITL `tool-approval-request` it delegates to the injected `onApproval` (the entry wires that to
 * a readline prompt + the approval registry). This is the ONLY new code M5 adds — no runtime, no LLM
 * call, no tool dispatch (ADR 0039 D2). I/O is INJECTED (`stdout`, prompt streams) so the whole
 * surface is deterministically testable without a TTY (ADR 0039 D4 / ADR-M5a).
 */
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type { UIMessageChunk } from 'ai'

/** ANSI helpers — applied only on a TTY so a captured (non-TTY) sink stays plain-text for tests. */
const ANSI = {
  dim: '\x1b[2m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  reset: '\x1b[0m',
}
function paint(text: string, color: keyof typeof ANSI, tty: boolean | undefined): string {
  return tty ? `${ANSI[color]}${text}${ANSI.reset}` : text
}

/** A stdout-like sink; `isTTY` gates color (Node's `process.stdout` carries it, a test sink does not). */
export type TerminalOut = Writable & { isTTY?: boolean }

interface TerminalRenderOptions {
  stdout: TerminalOut
  /** Resolve a HITL approval (the entry prompts + resolves the registry). */
  onApproval: (req: { approvalId: string; toolName: string }) => Promise<void>
}

/** Render an `unknown` tool output/input for display (string as-is; other JSON-ish values stringified). */
function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {})
}

/**
 * Map a single (non-approval) `UIMessageChunk` to its terminal line(s), or `''` for chunks that render
 * nothing (`start`/`text-start`/`reasoning-start`/…). Pure — the async loop owns approval + I/O.
 * Narrows the `ai` discriminated union directly on `chunk.type` (no cast; G3).
 */
function renderChunkLine(chunk: UIMessageChunk, tty: boolean | undefined): string {
  switch (chunk.type) {
    case 'text-delta':
      return chunk.delta
    case 'text-end':
    case 'finish':
      return '\n'
    case 'reasoning-delta':
      return paint(chunk.delta, 'dim', tty)
    case 'reasoning-end':
      return '\n'
    case 'tool-input-available':
      return paint(`\n▸ ${chunk.toolName}(${display(chunk.input)})\n`, 'cyan', tty)
    case 'tool-output-available':
      return paint(`  ✓ ${display(chunk.output)}\n`, 'green', tty)
    case 'tool-output-error':
      return paint(`  ✗ ${chunk.errorText}\n`, 'red', tty)
    case 'error':
      return paint(`\n✗ ${chunk.errorText}\n`, 'red', tty)
    default:
      // ai-sdk `data-*` transient parts (e.g. the M4 `data-checkpoint` resume handle).
      return chunk.type === 'data-checkpoint'
        ? paint('\n⎇ checkpoint saved — resume with the same session id\n', 'dim', tty)
        : ''
  }
}

/**
 * Render the `UIMessageChunk` stream to `stdout`. Sequential: one chunk → its line(s). The SDK run is
 * already paused inside the awaited `pre_tool_call` hook when a `tool-approval-request` arrives, so a
 * blocking `await onApproval(...)` here is correct — no frame buffer, no concurrency. Returns whether
 * an `error` chunk was seen so the caller can signal a non-zero exit (fail-loud, not silent exit 0).
 */
export async function renderAgentStreamToTerminal(
  chunks: AsyncIterable<UIMessageChunk>,
  opts: TerminalRenderOptions,
): Promise<{ sawError: boolean }> {
  const tty = opts.stdout.isTTY
  const write = (s: string): void => {
    if (s) opts.stdout.write(s)
  }
  // toolCallId → toolName, so the approval prompt (whose chunk carries only ids) can name the tool.
  const toolNames = new Map<string, string>()
  let sawError = false

  for await (const chunk of chunks) {
    if (chunk.type === 'tool-approval-request') {
      const toolName = toolNames.get(chunk.toolCallId)
      await opts.onApproval({ approvalId: chunk.approvalId, toolName: toolName ?? 'tool' })
      continue
    }
    if (chunk.type === 'tool-input-available' && chunk.toolCallId) {
      toolNames.set(chunk.toolCallId, chunk.toolName)
    }
    if (chunk.type === 'error') sawError = true
    write(renderChunkLine(chunk, tty))
  }
  return { sawError }
}

/** Injectable I/O for the approval prompt (defaults to the process streams at the CLI entry). */
interface PromptIO {
  input: Readable & { isTTY?: boolean }
  output: Writable & { isTTY?: boolean }
}

/**
 * Prompt `Approve <tool>? (y/N)` and resolve to the decision. A non-interactive environment (piped /
 * CI — either stream is not a TTY) AUTO-DENIES without prompting (ADR-M5b fail-safe: a decision that
 * cannot be obtained is a deny, never an auto-approve; mirrors HITL `onTimeout: 'abort'`).
 *
 * `timeoutMs` (the gated tool's `@HumanInTheLoop` timeout) auto-denies + closes the prompt when the
 * human walks away — WITHOUT it the readline question would outlive the SDK run (the registry settles
 * the run at its own timeout but readline has no timer), hanging the CLI on a now-irrelevant prompt.
 */
export function promptTerminalApproval(
  req: { toolName: string },
  io: PromptIO,
  timeoutMs?: number,
): Promise<boolean> {
  if (!io.input.isTTY || !io.output.isTTY) {
    io.output.write(`\n⚠ Non-interactive terminal — auto-denying approval for '${req.toolName}'.\n`)
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    const rl = createInterface({ input: io.input, output: io.output })
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (approved: boolean): void => {
      if (timer) clearTimeout(timer)
      rl.close()
      resolve(approved)
    }
    if (timeoutMs !== undefined && timeoutMs > 0) {
      timer = setTimeout(() => {
        io.output.write(`\n⚠ Approval timed out — denying '${req.toolName}'.\n`)
        settle(false)
      }, timeoutMs)
    }
    rl.question(`\n❔ Approve ${req.toolName}? (y/N) `, (answer) => {
      const a = answer.trim().toLowerCase()
      settle(a === 'y' || a === 'yes')
    })
  })
}
