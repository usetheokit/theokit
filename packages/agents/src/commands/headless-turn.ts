import { createWireReader, finalMessageOf } from '@theokit/presenter'
import type { AgentOutputEvent } from '@theokit/presenter'
import { readTurnMetadata } from '@theokit/presenter/wire'
import type { WireChunk, WireTurnMetadata } from '@theokit/presenter/wire'

/** Where a one-shot turn writes: the answer on `out`, progress and diagnostics on `err`. */
export interface HeadlessIo {
  readonly out: (s: string) => void
  readonly err: (s: string) => void
}

/** `cut` is a turn the runtime stopped (step limit, no progress); `empty` produced nothing. */
export type HeadlessOutcome = 'ok' | 'error' | 'cut' | 'empty'

export interface HeadlessTurnResult {
  readonly finalText: string
  readonly outcome: HeadlessOutcome
  readonly stopReason?: 'step_limit' | 'no_progress'
  readonly errorCode?: string
  readonly usage?: WireTurnMetadata['usage']
  /** ok 0, error 1, empty 1, cut 2 unless overridden. */
  readonly exitCode: number
}

export interface HeadlessTurnOptions {
  readonly io: HeadlessIo
  /** One JSON line per canonical event on `out`; `finalText` is still returned. */
  readonly json?: boolean
  /** Receives the final text, e.g. to write a `-o` file. */
  readonly outputLastMessage?: (text: string) => void | Promise<void>
  readonly exitCodes?: Partial<Record<HeadlessOutcome, number>>
}

const DEFAULT_EXIT_CODES: Record<HeadlessOutcome, number> = { ok: 0, error: 1, empty: 1, cut: 2 }

/** Thrown by {@link readHeadlessPrompt} when no prompt is left. */
export class EmptyPromptError extends Error {
  constructor(message = 'No prompt: pass one as an argument or on stdin.') {
    super(message)
    this.name = 'EmptyPromptError'
  }
}

/**
 * The prompt of a one-shot run: the argument, stdin (`required` when there is no argument), or stdin
 * appended as a `<stdin>` block. Throws {@link EmptyPromptError} when nothing is left.
 */
export function readHeadlessPrompt(input: {
  prompt?: string
  stdin: 'ignore' | 'append' | 'required'
  readStdin: () => string
}): string {
  const arg = input.prompt?.trim() ?? ''
  let prompt = arg
  if (input.stdin === 'required') {
    prompt = input.readStdin().trim()
  } else if (input.stdin === 'append') {
    const piped = input.readStdin().trim()
    if (piped !== '') prompt = arg === '' ? piped : `${arg}\n\n<stdin>\n${piped}\n</stdin>`
  }
  if (prompt.trim() === '') throw new EmptyPromptError()
  return prompt
}

function safe(write: (s: string) => void, s: string): void {
  try {
    write(s)
  } catch {
    // a broken stream must not turn a finished turn into a rejection
  }
}

function progressLine(event: AgentOutputEvent): string | undefined {
  if (event.type === 'tool-call') return `[tool] ${event.name}`
  if (event.type === 'tool-result' && event.isError === true) return `[tool failed] ${event.name}`
  if (event.type === 'error') return `error: ${event.message}`
  return undefined
}

/**
 * Consume one turn's wire chunks into stdout/stderr output and an exit code. Never rejects: a
 * thrown stream is an `error` outcome. Precedence: error, then cut, then empty, else ok.
 */
export async function runHeadlessTurn(
  chunks: AsyncIterable<WireChunk>,
  options: HeadlessTurnOptions,
): Promise<HeadlessTurnResult> {
  const { io } = options
  const reader = createWireReader()
  const events: AgentOutputEvent[] = []
  let meta: WireTurnMetadata | undefined
  let errorCode: string | undefined
  let failed = false

  try {
    for await (const chunk of chunks) {
      const m = readTurnMetadata(chunk)
      if (m !== undefined) meta = m
      for (const event of reader.read(chunk)) {
        events.push(event)
        if (event.type === 'error') {
          failed = true
          errorCode ??= event.code
        }
        if (options.json === true) safe(io.out, `${JSON.stringify(event)}\n`)
        else {
          const line = progressLine(event)
          if (line !== undefined) safe(io.err, `${line}\n`)
        }
      }
    }
  } catch (e) {
    failed = true
    safe(io.err, `error: ${e instanceof Error ? e.message : String(e)}\n`)
  }

  const finalText = finalMessageOf(events)
  const stopReason = meta?.stopReason
  const hasTools = events.some((e) => e.type === 'tool-call')
  let outcome: HeadlessOutcome
  if (failed) outcome = 'error'
  else if (stopReason !== undefined) outcome = 'cut'
  else if (finalText === '' && !hasTools) outcome = 'empty'
  else outcome = 'ok'

  if (options.json !== true && finalText !== '') safe(io.out, `${finalText}\n`)
  if (outcome === 'cut') safe(io.err, `turn cut: ${stopReason}\n`)
  if (outcome === 'empty') safe(io.err, 'the turn produced no text and no tool calls\n')

  if (options.outputLastMessage !== undefined) {
    try {
      await options.outputLastMessage(finalText)
    } catch (e) {
      outcome = 'error'
      safe(io.err, `error: could not write the last message: ${e instanceof Error ? e.message : String(e)}\n`)
    }
  }

  const exitCode = { ...DEFAULT_EXIT_CODES, ...options.exitCodes }[outcome]
  return {
    finalText,
    outcome,
    ...(stopReason === undefined ? {} : { stopReason }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(meta?.usage === undefined ? {} : { usage: meta.usage }),
    exitCode,
  }
}
