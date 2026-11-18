import { randomBytes } from 'node:crypto'

import type { ToolRefusal } from '@theokit/presenter'

/**
 * Run-scoped ledger of framework vetoes (internal).
 *
 * The SDK `pre_tool_call` context carries no call id, so a plugin cannot tag the refused call
 * directly. Each framework veto records WHO refused here, keyed by `(runId, toolName)`, before
 * returning `{ block: true, message }`; the adapter takes the entry when the SDK reports
 * `permission_denied` for that run and tool, matching on the unique marker in the veto message.
 */
interface Entry {
  refusal: ToolRefusal
  /** Unique marker appended to this veto's message; a denial carrying it is this veto's denial. */
  token: string
}
const ledger = new Map<string, Map<string, Entry[]>>()
/**
 * Bounds for runs that never reach the adapter's cleanup (a gate used directly as an SDK hook): the
 * oldest run, or the oldest entries of one run, are evicted rather than kept forever.
 */
const MAX_RUNS = 256
const MAX_ENTRIES_PER_RUN = 256
const entryCount = new Map<string, number>()
const MARKER = /\[veto:([0-9a-f]{24})\]/g

/**
 * Record a veto and return the message to veto with. The returned message is `message` plus a
 * unguessable `[veto:<hex>]` marker: SDK tool calls dispatch concurrently, so neither arrival
 * order nor message text can tie a `permission_denied` to its veto (two calls can be refused with
 * identical text). The marker survives the SDK's wrapping and binds the denial to exactly this entry.
 */
export function recordRefusal(
  runId: string,
  toolName: string,
  refusal: ToolRefusal,
  message: string,
): string {
  const token = randomBytes(12).toString('hex')
  let tools = ledger.get(runId)
  if (tools === undefined) {
    if (ledger.size >= MAX_RUNS) dropRunRefusals(ledger.keys().next().value!)
    tools = new Map()
    ledger.set(runId, tools)
  }
  const count = (entryCount.get(runId) ?? 0) + 1
  entryCount.set(runId, count)
  if (count > MAX_ENTRIES_PER_RUN) evictOldest(tools, runId)
  const queue = tools.get(toolName)
  const entry = { refusal, token }
  if (queue === undefined) tools.set(toolName, [entry])
  else queue.push(entry)
  return `${message} [veto:${token}]`
}

/**
 * Remove and return the refusal for this run and tool. When the denial's own `message` is known,
 * only the entry whose marker it carries is taken, so an external denial (no marker) or another
 * call's denial can never claim it. Without a message, the oldest entry is taken.
 */
export function takeRefusal(
  runId: string,
  toolName: string,
  denialMessage?: string,
): ToolRefusal | undefined {
  const tools = ledger.get(runId)
  const queue = tools?.get(toolName)
  if (tools === undefined || queue === undefined) return undefined
  let at = 0
  if (denialMessage !== undefined) {
    // The LAST marker is the one the framework appended; earlier ones are quoted text (hook output,
    // an earlier denial) and must not select an entry.
    const marker = [...denialMessage.matchAll(MARKER)].at(-1)?.[1]
    at = marker === undefined ? -1 : queue.findIndex((e) => e.token === marker)
  }
  if (at < 0) return undefined
  const [taken] = queue.splice(at, 1)
  entryCount.set(runId, (entryCount.get(runId) ?? 1) - 1)
  if (queue.length === 0) tools.delete(toolName)
  if (tools.size === 0) dropRunRefusals(runId)
  return taken.refusal
}

/** Drop whatever a finished run left behind. */
export function dropRunRefusals(runId: string): void {
  ledger.delete(runId)
  entryCount.delete(runId)
}

function evictOldest(tools: Map<string, Entry[]>, runId: string): void {
  for (const [name, queue] of tools) {
    queue.shift()
    if (queue.length === 0) tools.delete(name)
    entryCount.set(runId, (entryCount.get(runId) ?? 1) - 1)
    return
  }
}
