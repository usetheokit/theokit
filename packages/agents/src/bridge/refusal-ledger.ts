import type { ToolRefusal } from '@theokit/presenter'

/**
 * Run-scoped ledger of framework vetoes (internal).
 *
 * The SDK `pre_tool_call` context carries no call id, so a plugin cannot tag the refused call
 * directly. Each framework veto records WHO refused here, keyed by `(runId, toolName)`, before
 * returning `{ block: true, message }`; the adapter takes the entry when the SDK reports
 * `permission_denied` for that run and tool. Entries are FIFO per key, so two refusals of the same
 * tool in one run are matched in the order they were vetoed.
 */
interface Entry {
  refusal: ToolRefusal
  /** The model-facing veto message, used to tell this veto's denial from an unrelated one. */
  message: string | undefined
}
const ledger = new Map<string, Map<string, Entry[]>>()

export function recordRefusal(
  runId: string,
  toolName: string,
  refusal: ToolRefusal,
  message?: string,
): void {
  let tools = ledger.get(runId)
  if (tools === undefined) {
    tools = new Map()
    ledger.set(runId, tools)
  }
  const queue = tools.get(toolName)
  const entry = { refusal, message }
  if (queue === undefined) tools.set(toolName, [entry])
  else queue.push(entry)
}

/**
 * Remove and return the oldest unmatched refusal for this run and tool. When the denial's own
 * `message` is known, only an entry recorded with that message (the SDK may wrap it) is taken, so an
 * external denial of the same tool cannot claim a framework veto still on its way to the SDK.
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
    at = queue.findIndex((e) => e.message !== undefined && denialMessage.includes(e.message))
    if (at < 0) at = queue.findIndex((e) => e.message === undefined)
    if (at < 0) return undefined
  }
  const [taken] = queue.splice(at, 1)
  if (queue.length === 0) tools.delete(toolName)
  if (tools.size === 0) ledger.delete(runId)
  return taken.refusal
}

/** Drop whatever a finished run left behind. */
export function dropRunRefusals(runId: string): void {
  ledger.delete(runId)
}
