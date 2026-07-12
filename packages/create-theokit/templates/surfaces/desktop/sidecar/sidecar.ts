import { createInterface } from 'node:readline'

import { runTurnToJsonl } from '@theokit/tauri/sidecar'

import * as chatAgent from '../agents/chat.js'

/**
 * M47 / M36 (ADR-0045, ADR-0055) — the desktop sidecar entry. The Rust shell spawns this with the user
 * message as argv[2] and streams its stdout (JSONL chunks) to the webview over a Tauri `Channel`. The
 * turn is run by `@theokit/tauri/sidecar`'s `runTurnToJsonl` (the shared desktop glue — no hand-rolled
 * copy). HITL: a gated tool pauses the run; the sidecar emits a `tool-approval-request` line and awaits
 * the decision on stdin (`{approvalId, approved}\n`, forwarded by the Rust `approve` command).
 */
const message = process.argv[2] ?? ''
const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? ''

const pending = new Map<string, (approved: boolean) => void>()
const rl = createInterface({ input: process.stdin })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const msg = JSON.parse(trimmed) as { approvalId?: string; approved?: boolean }
    if (typeof msg.approvalId === 'string' && typeof msg.approved === 'boolean') {
      pending.get(msg.approvalId)?.(msg.approved)
      pending.delete(msg.approvalId)
    }
  } catch {
    // ignore malformed stdin lines
  }
})

// Fail-closed: if the shell kills the sidecar, deny every pending approval (Rule 8).
rl.on('close', () => {
  for (const resolve of pending.values()) resolve(false)
  pending.clear()
})

const write = (line: string): void => {
  process.stdout.write(line)
}

await runTurnToJsonl(chatAgent, apiKey, message, write, ({ approvalId, toolName }) => {
  return new Promise<boolean>((resolve) => {
    pending.set(approvalId, resolve)
    write(`${JSON.stringify({ type: 'tool-approval-request', approvalId, toolName })}\n`)
  })
})

rl.close()
process.exit(0)
