/**
 * M28 (ADR-0041) — `createVendorAgentTool`: expose a third-party agent SDK (Claude Agent SDK,
 * OpenAI, Cursor) behind a uniform `CustomTool`, mirroring the M17 ACP pattern.
 *
 * The vendor RUNTIME stays theirs — TheoKit only wires. The vendor client is INJECTED (the real
 * vendor SDK client in prod, a fake in tests), so no vendor dependency enters core; vendor-specific
 * client packages belong under `@theokit/agent-*`, never here. This calls no LLM of its own and runs
 * no loop — it delegates each prompt to `client.query(...)` (sdk-runtime.md / G2). Resume is threaded
 * via the vendor's own session id.
 */
import type { CustomTool } from '../define/define-agent-tool.js'

/**
 * Structural contract a vendor agent client must satisfy (the adapter never imports a vendor type).
 * `query` runs one turn; `resumeSessionId` continues a prior vendor session; the returned
 * `sessionId` identifies the session to resume next.
 */
export interface VendorAgentClient {
  query(
    prompt: string,
    opts?: { resumeSessionId?: string },
  ): Promise<{ text: string; sessionId?: string }>
}

/** Config for {@link createVendorAgentTool}. */
export interface VendorAgentToolConfig {
  /** Vendor label (e.g. `claude`, `openai`, `cursor`). Drives the default tool name. */
  vendor: string
  /** The injected vendor client (real SDK client in prod, a fake in tests). */
  client: VendorAgentClient
  /** Tool name the model calls (defaults to `<vendor>_agent`). */
  name?: string
  /** Tool description surfaced to the model (defaults to a one-line delegate hint). */
  description?: string
  /**
   * Side-channel callback invoked with the vendor session id after each turn — lets the app capture
   * it for a later resume WITHOUT leaking session bookkeeping into the model's view of the result.
   */
  onSession?: (sessionId: string) => void
}

/**
 * Wrap a vendor agent SDK as a {@link CustomTool}. Fails fast if `vendor` is empty or the client
 * does not expose `query()` (error-handling.md) — a mis-wired call is caught at definition time.
 */
export function createVendorAgentTool(config: VendorAgentToolConfig): CustomTool {
  if (!config.vendor || config.vendor.length === 0) {
    throw new Error('createVendorAgentTool: `vendor` is required (e.g. "claude", "openai").')
  }
  const queryFn = (config.client as { query?: unknown } | null | undefined)?.query
  if (typeof queryFn !== 'function') {
    throw new Error(
      `createVendorAgentTool(${JSON.stringify(config.vendor)}): the vendor client does not expose a query() method. ` +
        'Pass the vendor SDK client (or a @theokit/agent-* wrapper).',
    )
  }

  const name = config.name ?? `${config.vendor}_agent`
  const description =
    config.description ?? `Delegate a task to the ${config.vendor} agent and return its answer.`

  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The task/prompt for the vendor agent.' },
        resumeSessionId: {
          type: 'string',
          description: 'Optional vendor session id to resume a prior conversation.',
        },
      },
      required: ['prompt'],
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const prompt = typeof input.prompt === 'string' ? input.prompt : ''
      const resumeSessionId =
        typeof input.resumeSessionId === 'string' ? input.resumeSessionId : undefined
      const result = await config.client.query(
        prompt,
        resumeSessionId !== undefined ? { resumeSessionId } : undefined,
      )
      if (result.sessionId !== undefined && config.onSession) config.onSession(result.sessionId)
      return result.text
    },
  }
}
