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
  /** Unique marker appended to this veto's message. */
  token: string
  /** The complete veto message (text + marker): a denial is this veto's only if it equals it. */
  tagged: string
}
const ledger = new Map<string, Map<string, Entry[]>>()
/**
 * Bounds for runs that never reach the adapter's cleanup (a gate used directly as an SDK hook): the
 * oldest such run, or the oldest entries of one such run, are evicted rather than kept forever.
 * Runs retained by an adapter stream are never evicted; the stream's cleanup drops them.
 */
const MAX_RUNS = 256
const MAX_ENTRIES_PER_RUN = 256
const entryCount = new Map<string, number>()
/** Runs the adapter is actively streaming; their entries are evicted only when nothing else can be. */
const liveRuns = new Set<string>()

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
    if (ledger.size >= MAX_RUNS) {
      const victim = oldestUnmanagedRun()
      if (victim !== undefined) dropRunRefusals(victim)
    }
    tools = new Map()
    ledger.set(runId, tools)
  }
  const count = (entryCount.get(runId) ?? 0) + 1
  entryCount.set(runId, count)
  if (count > MAX_ENTRIES_PER_RUN && !liveRuns.has(runId)) evictOldest(tools, runId)
  const queue = tools.get(toolName)
  const tagged = `${message} [veto:${token}]`
  const entry = { refusal, token, tagged }
  if (queue === undefined) tools.set(toolName, [entry])
  else queue.push(entry)
  return tagged
}

/**
 * Remove and return the refusal for this run and tool. When the denial's own `message` is known,
 * only the entry whose complete tagged veto message equals it is taken, so an external
 * denial (no marker, or one merely quoting it) or another call's denial can never claim it. Without a message, the oldest entry is taken.
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
    // The SDK reports a plugin veto's message verbatim, so only the exact tagged message selects an
    // entry: a denial that merely ends with, quotes or copies a veto (an external denial) never does.
    at = queue.findIndex((e) => e.tagged === denialMessage)
  }
  if (at < 0) return undefined
  const [taken] = queue.splice(at, 1)
  entryCount.set(runId, (entryCount.get(runId) ?? 1) - 1)
  if (queue.length === 0) tools.delete(toolName)
  if (tools.size === 0 && !liveRuns.has(runId)) dropRunRefusals(runId)
  return taken.refusal
}

/** Drop whatever a finished run left behind. */
export function dropRunRefusals(runId: string): void {
  ledger.delete(runId)
  entryCount.delete(runId)
  liveRuns.delete(runId)
}

/** Mark a run as owned by an adapter stream: unmanaged (gate-only) runs are evicted before it. */
export function retainRun(runId: string): void {
  liveRuns.add(runId)
}

function oldestUnmanagedRun(): string | undefined {
  for (const id of ledger.keys()) if (!liveRuns.has(id)) return id
  return undefined
}

function evictOldest(tools: Map<string, Entry[]>, runId: string): void {
  for (const [name, queue] of tools) {
    queue.shift()
    if (queue.length === 0) tools.delete(name)
    entryCount.set(runId, (entryCount.get(runId) ?? 1) - 1)
    return
  }
}
