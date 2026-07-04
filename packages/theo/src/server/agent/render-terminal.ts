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

export interface TerminalRenderOptions {
  stdout: TerminalOut
  /** Resolve a HITL approval (the entry prompts + resolves the registry). */
  onApproval: (req: { approvalId: string; toolName: string }) => Promise<void>
}

/** Read a string field off a loosely-typed chunk (the `ai` union is wide). */
function str(chunk: Record<string, unknown>, key: string): string {
  const v = chunk[key]
  return typeof v === 'string' ? v : ''
}

/**
 * Map a single (non-approval) `UIMessageChunk` to its terminal line(s), or `''` for chunks that render
 * nothing (`start`/`text-start`/`reasoning-start`/…). Pure — the async loop owns approval + I/O.
 */
function renderChunkLine(c: Record<string, unknown>, tty: boolean | undefined): string {
  switch (c.type) {
    case 'text-delta':
      return str(c, 'delta')
    case 'text-end':
    case 'finish':
      return '\n'
    case 'reasoning-delta':
      return paint(str(c, 'delta'), 'dim', tty)
    case 'reasoning-end':
      return '\n'
    case 'tool-input-available':
      return paint(`\n▸ ${str(c, 'toolName')}(${JSON.stringify(c.input ?? {})})\n`, 'cyan', tty)
    case 'tool-output-available':
      return paint(`  ✓ ${str(c, 'output')}\n`, 'green', tty)
    case 'tool-output-error':
      return paint(`  ✗ ${str(c, 'errorText')}\n`, 'red', tty)
    case 'data-checkpoint':
      return paint('\n⎇ checkpoint saved — resume with the same session id\n', 'dim', tty)
    case 'error':
      return paint(`\n✗ ${str(c, 'errorText')}\n`, 'red', tty)
    default:
      return ''
  }
}

/**
 * Render the `UIMessageChunk` stream to `stdout`. Sequential: one chunk → its line(s). The SDK run is
 * already paused inside the awaited `pre_tool_call` hook when a `tool-approval-request` arrives, so a
 * blocking `await onApproval(...)` here is correct — no frame buffer, no concurrency.
 */
export async function renderAgentStreamToTerminal(
  chunks: AsyncIterable<UIMessageChunk>,
  opts: TerminalRenderOptions,
): Promise<void> {
  const tty = opts.stdout.isTTY
  const write = (s: string): void => {
    if (s) opts.stdout.write(s)
  }
  // toolCallId → toolName, so the approval prompt (whose chunk carries only ids) can name the tool.
  const toolNames = new Map<string, string>()

  for await (const chunk of chunks) {
    const c = chunk as unknown as Record<string, unknown>
    if (c.type === 'tool-approval-request') {
      const toolName = toolNames.get(str(c, 'toolCallId'))
      await opts.onApproval({ approvalId: str(c, 'approvalId'), toolName: toolName ?? 'tool' })
      continue
    }
    if (c.type === 'tool-input-available') {
      const id = str(c, 'toolCallId')
      if (id) toolNames.set(id, str(c, 'toolName'))
    }
    write(renderChunkLine(c, tty))
  }
}

/** Injectable I/O for the approval prompt (defaults to the process streams at the CLI entry). */
export interface PromptIO {
  input: Readable & { isTTY?: boolean }
  output: Writable & { isTTY?: boolean }
}

/**
 * Prompt `Approve <tool>? (y/n)` and resolve to the decision. A non-interactive environment (piped /
 * CI — either stream is not a TTY) AUTO-DENIES without prompting (ADR-M5b fail-safe: a decision that
 * cannot be obtained is a deny, never an auto-approve; mirrors HITL `onTimeout: 'abort'`).
 */
export function promptTerminalApproval(req: { toolName: string }, io: PromptIO): Promise<boolean> {
  if (!io.input.isTTY || !io.output.isTTY) {
    io.output.write(`\n⚠ Non-interactive terminal — auto-denying approval for '${req.toolName}'.\n`)
    return Promise.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    const rl = createInterface({ input: io.input, output: io.output })
    rl.question(`\n❔ Approve ${req.toolName}? (y/N) `, (answer) => {
      rl.close()
      const a = answer.trim().toLowerCase()
      resolve(a === 'y' || a === 'yes')
    })
  })
}
