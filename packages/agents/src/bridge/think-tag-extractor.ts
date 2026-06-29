/**
 * `<think>`-tag reasoning extractor (M2 reasoning-visibility) — bridge middleware.
 *
 * Converts inline `<think>…</think>` in the assistant TEXT stream into `thinking` segments, so
 * models that emit reasoning as inline tags (qwen3-coder / deepseek-class) surface reasoning the
 * same way native-reasoning providers do (M1's `reasoningEffort`). Two exports:
 *  - `createThinkTagExtractor` — the pure incremental splitter (handles a tag straddling a chunk
 *    boundary); the testable core.
 *  - `extractThinkTagStream` — a StreamEvent transform that applies the extractor to `text_delta`
 *    events and passes every other event through unchanged (Phase 2).
 *
 * Opt-in: wired into `createSdkAgentStream` only when `parseThinkTags` is set (Phase 3) — default
 * off, because a code assistant can legitimately emit literal `<think>` in answer/code text.
 *
 * Reference patterns: Aider `reasoning_tags.py`, Vercel AI SDK `extract-reasoning-middleware.ts`
 * (blueprint `code-assistant-reasoning-ux` ADR-3).
 */
import type { StreamEvent } from './agent-sse-handler.js'

/** The de-facto inline-reasoning tag (qwen/deepseek). Single change point if a second tag ever appears. */
const TAG = 'think'
const OPEN = `<${TAG}>`
const CLOSE = `</${TAG}>`

/** A typed slice of the text stream: ordinary `text` vs extracted `thinking`. */
export interface Segment {
  kind: 'text' | 'thinking'
  content: string
}

/**
 * The length of the longest suffix of `s` that is a (proper) prefix of `delim` — i.e. how many
 * trailing chars of `s` could still grow into `delim` on the next chunk. A full match is never
 * counted here (the caller resolves full matches via `indexOf` first), so the search caps at
 * `delim.length - 1`. Returns 0 when the tail cannot extend to the delimiter (EC-1: a buffered
 * prefix like `<think` followed by `ers>` is NOT held — it is flushed as text).
 */
function heldPrefixLength(s: string, delim: string): number {
  const max = Math.min(s.length, delim.length - 1)
  for (let k = max; k >= 1; k--) {
    if (s.slice(s.length - k) === delim.slice(0, k)) return k
  }
  return 0
}

/**
 * A pure, stateful, incremental `<think>` splitter. Feed it text chunks via `write`; it returns the
 * segments it can resolve so far, holding back only a tail that is still a viable prefix of the
 * active delimiter (so a tag split across two chunks is recognized). Call `end()` once the stream
 * is done to flush any buffered tail (a truncated `<think>` with no close is flushed as `thinking`,
 * so reasoning is never silently dropped).
 *
 * One instance per stream (per round); never shared — there is no cross-instance state.
 */
export function createThinkTagExtractor(): {
  write: (chunk: string) => Segment[]
  end: () => Segment[]
} {
  let mode: 'text' | 'thinking' = 'text'
  let buffer = ''

  const write = (chunk: string): Segment[] => {
    buffer += chunk
    const out: Segment[] = []
    // Resolve every full delimiter currently in the buffer; stop when only a partial prefix remains.
    for (;;) {
      const delim = mode === 'text' ? OPEN : CLOSE
      const idx = buffer.indexOf(delim)
      if (idx !== -1) {
        const content = buffer.slice(0, idx)
        if (content) out.push({ kind: mode, content })
        buffer = buffer.slice(idx + delim.length)
        mode = mode === 'text' ? 'thinking' : 'text'
        continue
      }
      // No full delimiter: emit everything except a tail that could still become the delimiter.
      const keep = heldPrefixLength(buffer, delim)
      const emit = buffer.slice(0, buffer.length - keep)
      if (emit) out.push({ kind: mode, content: emit })
      buffer = buffer.slice(buffer.length - keep)
      break
    }
    return out
  }

  const end = (): Segment[] => {
    if (!buffer) return []
    const seg: Segment = { kind: mode, content: buffer }
    buffer = ''
    return [seg]
  }

  return { write, end }
}

/** Map an extractor segment to its StreamEvent (`thinking` segment → thinking event, else text_delta). */
function segmentToEvent(seg: Segment): StreamEvent {
  return seg.kind === 'thinking'
    ? { type: 'thinking', content: seg.content }
    : { type: 'text_delta', content: seg.content }
}

/**
 * Stream transform: convert inline `<think>…</think>` carried in `text_delta` events into `thinking`
 * events, passing every other event (native `thinking`, `tool_call`, `done`, `error`, …) through
 * unchanged. A fresh extractor per call ⇒ per-stream (per-round) state; the extractor's mode persists
 * across interleaved non-text events (a reasoning block split by a tool call is not corrupted). On
 * source end, the extractor is flushed so a truncated `<think>` is still surfaced (as `thinking`).
 *
 * Non-string `text_delta.content` is passed through untouched (defensive — never throws). The
 * `end()` flush runs in a `finally`, so a buffered unclosed `<think>` is surfaced as `thinking`
 * even when the source errors mid-stream (the flushed segments are delivered before the error
 * re-propagates) — never silently dropped (Unbreakable Rule 8: fail loud, lose nothing).
 */
export async function* extractThinkTagStream(
  source: AsyncIterable<StreamEvent>,
): AsyncGenerator<StreamEvent> {
  const extractor = createThinkTagExtractor()
  try {
    for await (const event of source) {
      if (event.type === 'text_delta' && typeof event.content === 'string') {
        for (const seg of extractor.write(event.content)) yield segmentToEvent(seg)
      } else {
        yield event
      }
    }
  } finally {
    for (const seg of extractor.end()) yield segmentToEvent(seg)
  }
}
