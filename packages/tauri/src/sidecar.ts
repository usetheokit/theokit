import { randomUUID } from 'node:crypto'

import { streamAgentTurnInProcess, type InProcessAwaitApproval } from 'theokit/server/agent'

/** Writes one JSONL line (the sidecar's stdout `write`). */
export type WriteLine = (line: string) => void

/**
 * Resolve one gated-tool approval inline (the Rust shell forwards the webview's decision over stdin).
 * Aliases the seam's {@link InProcessAwaitApproval} so a sidecar can return the full `boolean | HitlDecision`
 * the SDK supports — never a narrower shape (the desktop stdin protocol carries `approved` today, but the
 * type stays forward-compatible with structured decisions).
 */
export type SidecarAwaitApproval = InProcessAwaitApproval

/**
 * `@theokit/tauri/sidecar` (ADR-0055 D2) — the NODE side of the desktop app. Run ONE agent turn via the
 * in-process seam (`streamAgentTurnInProcess`, M35/M36) and emit each `UIMessageChunk` as a single JSONL
 * line to `write`; the Rust shell streams these to the webview over a Tauri `Channel`. A thrown error is
 * surfaced as a trailing `{type:'error'}` line, never swallowed (Rule 8). HITL: a gated tool pauses; the
 * caller resolves `awaitApproval` (typically after the Rust shell forwards the webview's decision on stdin).
 */
export async function runTurnToJsonl(
  mod: unknown,
  apiKey: string,
  message: string,
  write: WriteLine,
  awaitApproval?: SidecarAwaitApproval,
): Promise<void> {
  try {
    for await (const chunk of streamAgentTurnInProcess(mod, apiKey, {
      message,
      sessionId: `desktop-${randomUUID()}`,
      awaitApproval,
    })) {
      write(`${JSON.stringify(chunk)}\n`)
    }
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err)
    write(`${JSON.stringify({ type: 'error', errorText })}\n`)
  }
}
