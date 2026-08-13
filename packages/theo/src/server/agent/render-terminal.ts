/**
 * M5 (theokit-ai-first) — the terminal render surface for the M4 agent harness.
 *
 * Consumes the M4 `UIMessageChunk` stream (`streamAgentUIMessages`) and writes it to the terminal:
 * streaming text, a dim reasoning line, tool call / result rows, a checkpoint notice, errors.
 *
 * ## M70 — this file used to be the evidence of the gap it now closes
 *
 * It switched on wire chunks BY HAND and never touched `TerminalPresenter`, even though that
 * presenter exists for exactly this. Not a consumer's idiosyncrasy — a structural one: the
 * presenter's only source translators consumed raw SDK messages, and this surface receives
 * `WireChunk`, already translated. There was no door between them, so our own terminal renderer
 * re-implemented the mapping and the shared presenter had no production consumer at all.
 *
 * The pipeline is now `WireChunk → fromWireChunk → TerminalPresenter`. The presenter returns DATA
 * (`TerminalRow[]`) carrying a semantic `kind`, and this file decides the styling — which is the
 * split the presenter was designed for (format there, render here).
 * On a HITL `tool-approval-request` it delegates to the injected `onApproval` (the entry wires that to
 * a readline prompt + the approval registry). This is the ONLY new code M5 adds — no runtime, no LLM
 * call, no tool dispatch (ADR 0039 D2). I/O is INJECTED (`stdout`, prompt streams) so the whole
 * surface is deterministically testable without a TTY (ADR 0039 D4 / ADR-M5a).
 */
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import { TerminalPresenter, fromWireChunk } from '@theokit/presenter'
import type { TerminalRow } from '@theokit/presenter'
import type { WireChunk as UIMessageChunk } from '@theokit/presenter/wire'

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

/** Semantic row kind → the ANSI colour this surface paints it with. */
const ROW_COLOR: Record<TerminalRow['kind'], keyof typeof ANSI | undefined> = {
  text: undefined,
  reasoning: 'dim',
  tool: 'cyan',
  'tool-result': 'green',
  'tool-error': 'red',
  error: 'red',
  status: 'dim',
  finish: 'dim',
}

/**
 * Paint one presented row for this terminal.
 *
 * The presenter decided WHAT the line says and what kind it is; this decides how it looks here. A
 * `text` row is written raw so streaming deltas concatenate into a paragraph — every other kind is
 * a discrete line and gets its own newline.
 */
function paintRow(row: TerminalRow, tty: boolean | undefined): string {
  const color = ROW_COLOR[row.kind]
  const body = color === undefined ? row.text : paint(row.text, color, tty)
  return row.kind === 'text' ? body : `\n${body}\n`
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
  // toolCallId → toolName. Needed twice, for the same reason: the wire drops the name after the
  // call. The approval prompt's chunk carries only ids, and `tool-output-available` carries only
  // `toolCallId` — which is why `fromWireChunk` takes this map rather than inventing a name.
  const toolNames = new Map<string, string>()
  const presenter = new TerminalPresenter({ maxPreview: 88 })
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

    // The checkpoint notice stays here, deliberately. It is a FRAMEWORK signal carried as a
    // `data-*` part, not agent output, so it never enters the canonical event — the same line the
    // forward mapping drew for HITL. Routing it through the presenter would mean widening the
    // canonical event to carry framework concerns.
    if (chunk.type === 'data-checkpoint') {
      write(paint('\n\u2387 checkpoint saved — resume with the same session id\n', 'dim', tty))
      continue
    }

    for (const event of fromWireChunk(chunk, toolNames)) {
      for (const row of presenter.present(event)) write(paintRow(row, tty))
    }
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
