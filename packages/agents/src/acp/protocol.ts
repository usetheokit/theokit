/**
 * M17 (theokit-ai-first) — ACP (Agent Client Protocol) stdio framing.
 *
 * ACP talks to a coding agent (Claude Code, Amp, Codex) over stdio as newline-delimited JSON. This
 * is the transport-agnostic CORE: encode a message to a line, and decode a byte/char stream that may
 * split a message across chunks. Pure — no subprocess, no Node API. The subprocess spawn lives in the
 * adapter layer (G8) / SDK; `createACPTool` (wrapping this codec + an injected transport) is a
 * follow-up once the adapter ships.
 */

/** Serialize a message to a single newline-terminated JSON line. */
export function encodeAcpMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * Incremental decoder for newline-delimited JSON. Feed it chunks with {@link push}; it buffers a
 * partial trailing line across calls and returns every WHOLE message parsed so far. Blank lines are
 * skipped. A completed non-JSON line fails fast with a typed error (error-handling.md) — a corrupt
 * frame must never be silently dropped.
 */
export class AcpMessageDecoder {
  private buffer = ''

  /** Feed a chunk; returns the messages completed by this chunk (possibly empty). */
  push(chunk: string): unknown[] {
    this.buffer += chunk
    const messages: unknown[] = []
    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line.length > 0) {
        try {
          messages.push(JSON.parse(line))
        } catch (cause) {
          throw new Error(`[@theokit/agents] ACP decode failed on line: ${line}`, { cause })
        }
      }
      newlineIndex = this.buffer.indexOf('\n')
    }
    return messages
  }
}
