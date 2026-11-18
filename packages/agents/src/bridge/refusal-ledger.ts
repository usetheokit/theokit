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
let counter = 0

/**
 * Record a veto and return the message to veto with. The returned message is `message` plus a
 * unique `[veto:N]` marker: SDK tool calls dispatch concurrently, so neither arrival order nor
 * message text can tie a `permission_denied` to its veto (two calls can be refused with identical
 * text). The marker survives the SDK's wrapping and binds the denial to exactly this entry.
 */
export function recordRefusal(
  runId: string,
  toolName: string,
  refusal: ToolRefusal,
  message: string,
): string {
  const token = `[veto:${(++counter).toString(36)}]`
  let tools = ledger.get(runId)
  if (tools === undefined) {
    tools = new Map()
    ledger.set(runId, tools)
  }
  const queue = tools.get(toolName)
  const entry = { refusal, token }
  if (queue === undefined) tools.set(toolName, [entry])
  else queue.push(entry)
  return `${message} ${token}`
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
  const at =
    denialMessage === undefined ? 0 : queue.findIndex((e) => denialMessage.includes(e.token))
  if (at < 0) return undefined
  const [taken] = queue.splice(at, 1)
  if (queue.length === 0) tools.delete(toolName)
  if (tools.size === 0) ledger.delete(runId)
  return taken.refusal
}

/** Drop whatever a finished run left behind. */
export function dropRunRefusals(runId: string): void {
  ledger.delete(runId)
}
