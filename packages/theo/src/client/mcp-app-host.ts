/**
 * M30 (ADR-0041) — client host for MCP App `ui://` resources.
 *
 * Renders a tool's `ui://` HTML in a SANDBOXED iframe and bridges a capability-scoped guest API over
 * `postMessage`. Security is load-bearing:
 *  - the iframe is `sandbox="allow-scripts"` ONLY — NOT `allow-same-origin`, so the guest runs at a
 *    null origin and cannot touch the parent DOM, cookies, or storage;
 *  - the host only honors messages whose `source` is the iframe's own `contentWindow`;
 *  - the guest API is a fixed, capability-scoped vocabulary (`callServerTool`, `sendMessage`) — any
 *    other message type is ignored.
 */

/** The guest → host message vocabulary (capability-scoped). */
export type GuestMessage =
  | { type: 'callServerTool'; id: string; tool: string; args?: unknown }
  | { type: 'sendMessage'; text: string }

/** Callbacks the host wires for the guest API. */
export interface McpAppHostOptions {
  /** Guest asked to call a server tool — return its result (posted back to the guest by id). */
  onCallServerTool: (tool: string, args: unknown) => unknown
  /** Guest emitted a chat message to the host app. */
  onSendMessage?: (text: string) => void
}

/**
 * Pure bridge: interpret one guest message and (for `callServerTool`) post the result back via
 * `post`. Exported for unit testing without a DOM. Unknown message shapes are ignored — the guest
 * API is capability-scoped, not an open RPC surface.
 */
export function createGuestMessageHandler(
  opts: McpAppHostOptions,
  post: (message: unknown) => void,
): (data: unknown) => Promise<void> {
  return async (data: unknown): Promise<void> => {
    if (typeof data !== 'object' || data === null) return
    const msg = data as Partial<GuestMessage> & { type?: string }
    if (
      msg.type === 'callServerTool' &&
      typeof msg.id === 'string' &&
      typeof msg.tool === 'string'
    ) {
      const result = await opts.onCallServerTool(msg.tool, msg.args)
      post({ type: 'callServerTool:result', id: msg.id, result })
      return
    }
    if (msg.type === 'sendMessage' && typeof (msg as { text?: unknown }).text === 'string') {
      opts.onSendMessage?.((msg as { text: string }).text)
    }
  }
}

/** Handle returned by {@link mountMcpApp}. */
export interface McpAppHandle {
  iframe: HTMLIFrameElement
  /** Remove the message listener and the iframe. */
  dispose: () => void
}

/** The sandbox tokens the guest iframe is allowed — scripts only, NEVER `allow-same-origin`. */
export const MCP_APP_SANDBOX = 'allow-scripts'

/**
 * Mount an MCP App resource's HTML in a sandboxed iframe inside `container`, wiring the guest API.
 * The HTML comes from `resources/read` (see `mcp-app-resources.ts`). Returns a handle to dispose.
 */
export function mountMcpApp(
  container: HTMLElement,
  resource: { html: string },
  opts: McpAppHostOptions,
): McpAppHandle {
  const iframe = container.ownerDocument.createElement('iframe')
  // Security: scripts only, null origin. Do NOT add allow-same-origin.
  iframe.setAttribute('sandbox', MCP_APP_SANDBOX)
  iframe.srcdoc = resource.html
  container.appendChild(iframe)

  const post = (message: unknown): void => {
    // The guest is a sandboxed srcdoc iframe (allow-scripts, NO allow-same-origin) → its origin is
    // the opaque string "null", which cannot be used as a reliable targetOrigin. '*' is the only
    // valid target for a null-origin sandboxed guest; the sandbox (no navigation, no same-origin)
    // is what prevents a cross-origin leak, not the targetOrigin string.
    // eslint-disable-next-line sonarjs/post-message -- sandboxed null-origin iframe: '*' is correct
    iframe.contentWindow?.postMessage(message, '*')
  }
  const handle = createGuestMessageHandler(opts, post)

  const onMessage = (event: MessageEvent): void => {
    // Only trust messages from THIS iframe's guest window.
    if (event.source !== iframe.contentWindow) return
    void handle(event.data)
  }
  const view = container.ownerDocument.defaultView
  view?.addEventListener('message', onMessage)

  return {
    iframe,
    dispose: () => {
      view?.removeEventListener('message', onMessage)
      iframe.remove()
    },
  }
}
