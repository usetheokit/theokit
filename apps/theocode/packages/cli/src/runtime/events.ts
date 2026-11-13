import {
  foldTurnLifecycle,
  fromWireChunk,
  type AgentOutputEvent,
  type TurnLifecycle,
} from '@theokit/presenter'
import type { WireChunk } from '@theokit/presenter/wire'
import type { AgentTurnMetadata } from '@theokit/agents/bridge'

type TurnFold = TurnLifecycle<unknown>

export interface ExecIo {
  out: (line: string) => void
  err: (line: string) => void
}

export interface ProcessorResult {
  finalText: string
  errorSeen: boolean
  usage: Record<string, number>
  /** Set when the loop cut the turn short (`step_limit` | `no_progress`); absent on a finished turn. */
  stopReason?: AgentTurnMetadata['stopReason']
}

/** Exit code of a turn the loop cut short: distinct from 1 (failed) and 130 (interrupted). */
export const CUT_TURN_EXIT_CODE = 3

/** The finish chunk's metadata. A local cast until `readTurnMetadata` (#1854) ships. */
function readFinishMetadata(chunk: WireChunk): AgentTurnMetadata | undefined {
  return (chunk as { messageMetadata?: AgentTurnMetadata }).messageMetadata
}

/** 1 for an error or empty turn, 3 for a cut turn, else 0. */
export function exitCodeFor(result: ProcessorResult, emptyTurn: boolean): number {
  if (result.errorSeen || emptyTurn) return 1
  return result.stopReason !== undefined ? CUT_TURN_EXIT_CODE : 0
}

/**
 * One wire chunk to canonical events, remembering each call's tool name.
 *
 * `tool-output-*` carries only `toolCallId`; the name arrives on the earlier input chunk, so the
 * map is threaded through `fromWireChunk` per processor.
 */
function wireTranslator(): (chunk: WireChunk) => AgentOutputEvent[] {
  const toolNames = new Map<string, string>()
  return (chunk) => {
    if (chunk.type === 'tool-input-available') toolNames.set(chunk.toolCallId, chunk.toolName)
    return fromWireChunk(chunk, toolNames)
  }
}

const USAGE_ALIASES: readonly (readonly [output: string, camel: string, snake: string])[] = [
  ['input_tokens', 'inputTokens', 'input_tokens'],
  ['cached_input_tokens', 'cacheReadTokens', 'cached_input_tokens'],
  ['cache_write_input_tokens', 'cacheWriteTokens', 'cache_write_input_tokens'],
  ['output_tokens', 'outputTokens', 'output_tokens'],
  ['reasoning_output_tokens', 'reasoningTokens', 'reasoning_output_tokens'],
]

function toCodexUsage(u: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    USAGE_ALIASES.map(([output, camel, snake]) => [output, u?.[camel] ?? u?.[snake] ?? 0]),
  )
}

/**
 * What the turn actually COST, with the cached prefix taken out.
 *
 * `input_tokens` includes the cached prefix the provider re-read for free, so adding it to
 * `output_tokens` reports a number the user is not paying. Measured 2026-08-25 on a three-round
 * turn: the provider reported `cached_tokens: 4608` on every round, and this line reported 19,511
 * where 5,687 were new.
 *
 * The formula is Codex's, deliberately, because that is what makes the two comparable —
 * `codex-rs/protocol/src/protocol.rs`:
 *
 *     pub fn non_cached_input(&self) -> i64 { (self.input_tokens - self.cached_input()).max(0) }
 *     // blended total = non_cached_input() + output_tokens.max(0)
 *
 * Until this matched, every cost comparison between the two agents was measuring a gross figure
 * against a net one and reading the difference as a defect in this product.
 *
 * `Math.max(0, …)` on the subtraction, as Codex has it: a provider that reports more cached tokens
 * than input tokens is describing something this arithmetic cannot represent, and a negative token
 * count is worse than a clamped one.
 */
function blendedTotal(u: Record<string, number>): number {
  const nonCachedInput = Math.max(0, (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0))
  return nonCachedInput + Math.max(0, u.output_tokens ?? 0)
}

import { toolLine } from './tool-line.js'
import type { ToolChunk } from './tool-line.js'
import { changedPaths } from './changed-paths.js'
import { turnDiff } from './turn-diff.js'

export interface ExecProcessor {
  process(chunk: WireChunk): void
  finish(
    status: 'finished' | 'error',
    extra?: { usage?: Record<string, number>; error?: string },
  ): ProcessorResult
}

/**
 * The assistant's FINAL message, kept apart from the preambles that precede its tool calls.
 *
 * A turn emits text more than once. The instructions ask for a preamble before a burst of tool
 * calls ("Next, I'll patch the config and update the related tests.") and for a closing recap after
 * the last one — all of it arrives as `text-delta`, with nothing in the stream marking where one
 * message ends and the next begins.
 *
 * Concatenating them was wrong twice over, and `--help` states the contract it broke: "Stdout
 * carries ONLY the final message". Measured 2026-08-25 on a two-step task, stdout read:
 *
 *     I'll read `duration.mjs` and report its contents briefly.`duration.mjs:2` defines …
 *
 * — the preamble and the answer with no separator between them, because nothing was ever meant to
 * join them. `-o/--output-last-message` wrote the same run-on string to a file a script then reads.
 * Codex, on the same task, prints the closing message alone.
 *
 * The boundary is the tool call: text buffered when one STARTS was a preamble by definition, since
 * the answer cannot precede the tool that establishes it (the instructions say so in as many
 * words). Whatever is left when the turn ends is the answer. A turn with no tool call has one
 * message and it is the answer, which falls out of the same rule rather than needing a branch.
 */
function finalMessage(): {
  delta: (d: string) => void
  /** Close the current message: returns it if it said anything, and starts the next. */
  cut: () => string | undefined
  done: () => string
} {
  let buffer = ''
  return {
    delta: (d) => {
      buffer += d
    },
    cut: () => {
      const said = buffer.trim()
      buffer = ''
      return said.length > 0 ? said : undefined
    },
    done: () => buffer.trim(),
  }
}

function humanStatus(
  errorSeen: boolean,
  stop: AgentTurnMetadata['stopReason'],
  status: string,
): string {
  if (errorSeen) return 'error'
  return stop === undefined ? status : 'cut'
}

/** The prose is the agent's claim; the diff is the artifact. Silent when nothing changed. */
function emitDiff(
  io: ExecIo,
  git: (args: string[]) => { ok: boolean; stdout: string },
  writes: ToolChunk[],
): void {
  const diff = turnDiff(git, changedPaths(writes))
  if (diff !== undefined) io.err(diff)
}

function execLine(
  sessionId: string,
  status: string,
  stop: AgentTurnMetadata['stopReason'],
  u: ReturnType<typeof toCodexUsage>,
): string {
  const why = stop === undefined ? '' : ` stop=${stop}`
  return `[exec] session=${sessionId} status=${status}${why} tokens=${blendedTotal(u)}`
}

function jsonlOutcome(
  failed: boolean,
  stop: AgentTurnMetadata['stopReason'],
  usage: Record<string, number> | undefined,
  error: string | undefined,
): { status: 'ok' | 'error'; error?: string; usage: Record<string, number> | undefined } {
  if (failed) return { status: 'error', error: error ?? 'turn failed', usage }
  if (stop !== undefined) return { status: 'error', error: `turn cut: stop=${stop}`, usage }
  return { status: 'ok', usage }
}

export function createHumanProcessor(
  io: ExecIo,
  sessionId: string,
  /**
   * #105 — how the turn asks git what it changed. Injected rather than built here for the reason
   * every other seam in this file is: with an ambient runner the arms would depend on whichever
   * checkout the suite happens to run in. Omitted in production by nobody — `run.ts` supplies it.
   */
  git?: (args: string[]) => { ok: boolean; stdout: string },
): ExecProcessor {
  const message = finalMessage()
  let errorSeen = false
  let usage: Record<string, number> | undefined
  let stopReason: AgentTurnMetadata['stopReason']
  // #105 — collected as they go past, so the diff at the end is scoped to what THIS turn wrote
  // rather than to whatever the working tree happens to hold.
  const writes: ToolChunk[] = []
  const translate = wireTranslator()
  // Per-event handling as a table, mirroring the JSONL twin's `toContentChunk` extraction. An event
  // type without a row carries nothing for this surface.
  const onEvent: Record<string, (event: AgentOutputEvent) => void> = {
    'tool-call': (event) => {
      if (event.type !== 'tool-call') return
      // The preamble goes out BEFORE the call it announces, which is the order it was written
      // to be read in — and to stderr, where the rest of the progress already goes.
      const preamble = message.cut()
      if (preamble !== undefined) io.err(preamble)
      const call = { toolName: event.name, input: event.input }
      io.err(toolLine(call))
      writes.push(call)
    },
    'tool-result': (event) => {
      if (event.type !== 'tool-result') return
      io.err(event.isError === true ? `  failed: ${String(event.result)}` : `  done`)
    },
    text: (event) => {
      if (event.type === 'text') message.delta(event.text)
    },
    error: (event) => {
      if (event.type !== 'error') return
      errorSeen = true
      io.err(`ERROR: ${event.message}`)
    },
  }

  return {
    process(chunk) {
      if (chunk.type === 'finish') {
        const meta = readFinishMetadata(chunk)
        usage = meta?.usage as Record<string, number> | undefined
        stopReason = meta?.stopReason
        return
      }
      for (const event of translate(chunk)) onEvent[event.type]?.(event)
    },
    finish(status, extra) {
      if (status === 'error') {
        errorSeen = true
        if (extra?.error !== undefined) io.err(`ERROR: ${extra.error}`)
      }
      const finalText = message.done()
      if (finalText.length > 0) io.out(finalText)
      // #105 — after the answer, before the accounting line: what the tree now holds, from git.
      if (git !== undefined) emitDiff(io, git, writes)
      const stop = errorSeen ? undefined : stopReason
      const u = toCodexUsage(extra?.usage ?? usage)
      io.err(execLine(sessionId, humanStatus(errorSeen, stop, status), stop, u))
      const cut = stop === undefined ? {} : { stopReason: stop }
      return { finalText, errorSeen, usage: u, ...cut }
    },
  }
}

function commandEvent(
  kind: 'item.started' | 'item.completed',
  id: string,
  toolName: string | undefined,
  status: 'in_progress' | 'completed' | 'failed',
): unknown {
  return {
    type: kind,
    item: { id, type: 'command_execution', command: toolName ?? 'tool', status },
  }
}

/**
 * Translate one canonical event into the fold's vocabulary, or `null` when it carries no lifecycle.
 * Part of the Codex JSONL projection — the B-123 rationale lives on `createJsonlProcessor`.
 */
function toContentChunk(event: AgentOutputEvent): Parameters<TurnFold['observe']>[0] | null {
  switch (event.type) {
    case 'text':
      return { kind: 'text', delta: event.text }
    case 'tool-call':
      return { kind: 'tool-call', id: event.callId, name: event.name }
    case 'tool-result':
      return { kind: 'tool-result', id: event.callId, name: event.name }
    case 'error':
      return { kind: 'error', message: event.message }
    default:
      return null
  }
}

/** The Codex dialect, as constructors the fold calls. This product's words, and only its words. */
function codexDialect(
  failed: ReadonlySet<string>,
): Parameters<typeof foldTurnLifecycle<unknown>>[0] {
  return {
    threadStarted: (id) => ({ type: 'thread.started', thread_id: id }),
    turnStarted: () => ({ type: 'turn.started' }),
    itemStarted: (item) => commandEvent('item.started', item.id, item.kind, 'in_progress'),
    itemCompleted: (item) =>
      item.id === 'message'
        ? {
            type: 'item.completed',
            item: { id: 'item_msg', type: 'agent_message', text: item.kind },
          }
        : commandEvent(
            'item.completed',
            item.id,
            item.kind,
            failed.has(item.id) ? 'failed' : 'completed',
          ),
    turnCompleted: (u) => ({
      type: 'turn.completed',
      usage: toCodexUsage(u as Record<string, number> | undefined),
    }),
    turnFailed: (error) => ({ type: 'turn.failed', error }),
  }
}

/**
 * The Codex JSONL dialect, as a projection of the framework's lifecycle fold.
 *
 * B-123 — `foldTurnLifecycle` carries the invariant this used to hold by hand: a turn opens exactly
 * once and closes exactly once, never both completed and failed, never left open. Here the error
 * path and the finish path each closed the turn, and only an `errorSeen` flag threaded through both
 * kept them from doing it twice — right until someone edited one path.
 *
 * What stays is this product's VOCABULARY, which is why the framework does not ship it: the event
 * names, the item shapes, the Codex usage block. ADR 0007 records the reasoning.
 */
export function createJsonlProcessor(io: ExecIo, threadId: string): ExecProcessor {
  const emit = (obj: unknown): void => {
    try {
      io.out(JSON.stringify(obj))
    } catch {
      io.out(JSON.stringify({ type: 'error', message: 'serialization failure' }))
    }
  }

  let usage: Record<string, number> | undefined
  let stopReason: AgentTurnMetadata['stopReason']
  // The same rule as the human processor. The JSONL events themselves already arrive separated by
  // `turn.observe`; it is `finalText` — what `-o/--output-last-message` writes — that ran them
  // together, so a script reading that file got the preambles glued to the answer.
  const message = finalMessage()
  let errorSeen = false

  // The fold has no failed-result flag yet (#1852), so failed call ids are kept here.
  const failedCalls = new Set<string>()
  const translate = wireTranslator()
  const turn = foldTurnLifecycle<unknown>(codexDialect(failedCalls), threadId)
  for (const event of turn.opened) emit(event)

  const track = (event: AgentOutputEvent): boolean => {
    if (event.type === 'text') message.delta(event.text)
    if (event.type === 'tool-call') message.cut()
    if (event.type === 'tool-result' && event.isError === true) failedCalls.add(event.callId)
    return event.type === 'error'
  }

  return {
    process(chunk) {
      if (chunk.type === 'finish') {
        const meta = readFinishMetadata(chunk)
        usage = meta?.usage as Record<string, number> | undefined
        stopReason = meta?.stopReason
        return
      }
      for (const event of translate(chunk)) {
        if (track(event)) errorSeen = true
        const mapped = toContentChunk(event)
        if (mapped === null) continue
        for (const out of turn.observe(mapped)) emit(out)
      }
    },
    finish(status, extra) {
      const raw = extra?.usage ?? usage
      const failed = status === 'error' || errorSeen
      const stop = failed ? undefined : stopReason
      const outcome = jsonlOutcome(failed, stop, raw, extra?.error)

      for (const event of turn.finish(outcome)) emit(event)
      return {
        finalText: message.done(),
        errorSeen: failed,
        usage: toCodexUsage(raw),
        ...(stop === undefined ? {} : { stopReason: stop }),
      }
    },
  }
}

export function silentEmptyTurnDiagnostic(
  result: ProcessorResult,
  status: 'finished' | 'error',
): string | undefined {
  if (status !== 'finished' || result.errorSeen) return undefined
  if (result.finalText.trim().length > 0) return undefined
  if ((result.usage.input_tokens ?? 0) > 0 || (result.usage.output_tokens ?? 0) > 0)
    return undefined
  return (
    '[exec] the model was never called (input_tokens=0) and the turn produced no output — likely a ' +
    'credential/provider resolution failure. For an OAuth Codex route (openai-chatgpt), verify ' +
    'THEOKIT_AUTH_HOME points at the credential store and re-run `/login`.'
  )
}
