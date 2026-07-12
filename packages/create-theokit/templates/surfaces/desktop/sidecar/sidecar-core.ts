import { randomUUID } from 'node:crypto'

import { streamAgentTurnInProcess } from 'theokit/server'

type WriteLine = (line: string) => void
type AwaitApproval = (req: {
  approvalId: string
  toolName: string
  opts: unknown
}) => Promise<boolean>

/**
 * M45 / M36 (ADR-0045 D2) — run ONE agent turn via the in-process seam and emit each `UIMessageChunk`
 * as a single JSONL line to `write`. This is the SERVER side of the desktop app (a Node sidecar); the
 * CLIENT (the webview) consumes these lines via the unified `createAgentClient(ChannelTransport)`.
 * A thrown error is surfaced as a trailing `{type:'error'}` line, never swallowed (Rule 8).
 */
export async function runTurnToJsonl(
  mod: unknown,
  apiKey: string,
  message: string,
  write: WriteLine,
  awaitApproval?: AwaitApproval,
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
