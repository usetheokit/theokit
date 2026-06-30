/**
 * Tool-dialect stripper (theocode#32) — bridge middleware.
 *
 * Neutralizes a model that leaks its Hermes tool-call dialect — `<function=NAME>…</function></tool_call>`
 * XML — into the assistant TEXT stream instead of emitting native `tool_calls` (qwen3-coder class). The
 * leaked block is STRIPPED out of the visible text; it is NEVER parsed back into a tool call (parsing a
 * provider-broken channel re-introduces the no-progress spin closed in theokit#53). Two exports:
 *  - `createToolDialectStripper` — the pure incremental splitter (handles the OPEN `<function=` and the
 *    CLOSE `</tool_call>` each straddling a chunk boundary); the testable core.
 *  - `stripToolDialectStream` — a StreamEvent transform that applies the stripper to `text_delta` events
 *    and passes every other event through unchanged.
 *
 * Opt-in: wired into `createSdkAgentStream` only when `stripToolDialect` is set — default off, because a
 * code assistant can legitimately emit a literal `<function=` substring in answer/code text.
 *
 * Sibling of `think-tag-extractor.ts` (same incremental-splitter shape): the only deltas are the
 * delimiter (a two-string OPEN…CLOSE pair, not a single `<think>` tag) and the disposition of matched
 * content (dropped, not re-routed to a `thinking` segment).
 *
 * Accepted best-effort limit (EC-5): if a leaked block's parameter value contains the literal substring
 * `</tool_call>`, the scanner closes at that inner occurrence and the trailing real `</function></tool_call>`
 * re-emits as text. This errs toward showing MORE text (never silently drops), matching the lossless
 * contract — same class as the think-tag scanner being fooled by `<thinkers>`-shaped content. Pinned by
 * `tool-dialect-stripper.test.ts:test_stripper_embedded_close_early_closes_then_text`.
 */
import type { StreamEvent } from './agent-sse-handler.js'

/** The Hermes leak's open marker. Single change-point if a second tool-dialect opener ever appears. */
const OPEN = '<function='
/** The Hermes leak's close marker — the whole `<function=…>` block is dropped up to and including this. */
const CLOSE = '</tool_call>'

/** A typed slice of the surviving (non-leaked) text stream. Dropped leak content yields no segment. */
export interface Segment {
  kind: 'text'
  content: string
}

/**
 * The length of the longest suffix of `s` that is a (proper) prefix of `delim` — i.e. how many trailing
 * chars of `s` could still grow into `delim` on the next chunk. A full match is resolved by `indexOf`
 * first, so the search caps at `delim.length - 1`. Returns 0 when the tail cannot extend to the delimiter.
 */
function heldPrefixLength(s: string, delim: string): number {
  const max = Math.min(s.length, delim.length - 1)
  for (let k = max; k >= 1; k--) {
    if (s.slice(s.length - k) === delim.slice(0, k)) return k
  }
  return 0
}

/**
 * A pure, stateful, incremental tool-dialect splitter. Feed it text chunks via `write`; it returns the
 * surviving text segments, dropping any resolved `<function=…></tool_call>` block and holding back only a
 * tail that is still a viable prefix of the active delimiter (so a delimiter split across two chunks is
 * recognized). Call `end()` once the stream is done: an UNCLOSED leak (saw `<function=`, never saw
 * `</tool_call>`) is flushed as text — lossless, never silently dropped (Unbreakable Rule 8).
 *
 * One instance per stream (per run); never shared — there is no cross-instance state.
 */
export function createToolDialectStripper(): {
  write: (chunk: string) => Segment[]
  end: () => Segment[]
} {
  let mode: 'text' | 'stripping' = 'text'
  let buffer = ''
  // Accumulates the dropped-so-far leak content (including the OPEN marker) so an unclosed leak can be
  // flushed losslessly on end(). Reset to '' the moment a full OPEN…CLOSE pair resolves.
  let pendingLeak = ''

  const write = (chunk: string): Segment[] => {
    buffer += chunk
    const out: Segment[] = []
    for (;;) {
      if (mode === 'text') {
        const idx = buffer.indexOf(OPEN)
        if (idx !== -1) {
          const content = buffer.slice(0, idx)
          if (content) out.push({ kind: 'text', content })
          pendingLeak = OPEN
          buffer = buffer.slice(idx + OPEN.length)
          mode = 'stripping'
          continue
        }
        const keep = heldPrefixLength(buffer, OPEN)
        const emit = buffer.slice(0, buffer.length - keep)
        if (emit) out.push({ kind: 'text', content: emit })
        buffer = buffer.slice(buffer.length - keep)
        break
      }
      // stripping: scan for CLOSE, dropping everything in between (accumulated into pendingLeak).
      const idx = buffer.indexOf(CLOSE)
      if (idx !== -1) {
        buffer = buffer.slice(idx + CLOSE.length)
        pendingLeak = ''
        mode = 'text'
        continue
      }
      const keep = heldPrefixLength(buffer, CLOSE)
      pendingLeak += buffer.slice(0, buffer.length - keep)
      buffer = buffer.slice(buffer.length - keep)
      break
    }
    return out
  }

  const end = (): Segment[] => {
    // Lossless: an unclosed leak (still in stripping mode) flushes pendingLeak + the held CLOSE-prefix
    // as text; a held OPEN-prefix in text mode flushes as text. Never silently drop unconfirmed content.
    const leftover = mode === 'stripping' ? pendingLeak + buffer : buffer
    buffer = ''
    pendingLeak = ''
    return leftover ? [{ kind: 'text', content: leftover }] : []
  }

  return { write, end }
}

/**
 * Stream transform: strip a leaked `<function=…></tool_call>` Hermes tool-call dialect out of `text_delta`
 * events, passing every other event (native `thinking`, `tool_call`, `done`, `error`, `status`, …) through
 * unchanged. A fresh stripper per call ⇒ per-stream (per-round) state; the stripper's mode persists across
 * interleaved non-text events. Non-string `text_delta.content` is passed through untouched (defensive —
 * never coerced). The `end()` flush runs in a `finally`, so a buffered unclosed leak is surfaced as text
 * even when the source errors mid-stream (delivered before the error re-propagates) — Rule 8: lose nothing.
 */
export async function* stripToolDialectStream(
  source: AsyncIterable<StreamEvent>,
): AsyncGenerator<StreamEvent> {
  const stripper = createToolDialectStripper()
  try {
    for await (const event of source) {
      if (event.type === 'text_delta' && typeof event.content === 'string') {
        for (const seg of stripper.write(event.content)) {
          yield { type: 'text_delta', content: seg.content }
        }
      } else {
        yield event
      }
    }
  } finally {
    for (const seg of stripper.end()) {
      yield { type: 'text_delta', content: seg.content }
    }
  }
}
