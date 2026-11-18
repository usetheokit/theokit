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
const ledger = new Map<string, Map<string, ToolRefusal[]>>()

export function recordRefusal(runId: string, toolName: string, refusal: ToolRefusal): void {
  let tools = ledger.get(runId)
  if (tools === undefined) {
    tools = new Map()
    ledger.set(runId, tools)
  }
  const queue = tools.get(toolName)
  if (queue === undefined) tools.set(toolName, [refusal])
  else queue.push(refusal)
}

/** Remove and return the oldest unmatched refusal for this run and tool. */
export function takeRefusal(runId: string, toolName: string): ToolRefusal | undefined {
  const tools = ledger.get(runId)
  const queue = tools?.get(toolName)
  if (tools === undefined || queue === undefined) return undefined
  const first = queue.shift()
  if (queue.length === 0) tools.delete(toolName)
  if (tools.size === 0) ledger.delete(runId)
  return first
}

/** Drop whatever a finished run left behind. */
export function dropRunRefusals(runId: string): void {
  ledger.delete(runId)
}
