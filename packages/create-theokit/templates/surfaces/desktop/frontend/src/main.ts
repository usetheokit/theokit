import {
  ChannelTransport,
  createAgentClient,
  type ApprovalDecision,
  type ChannelPushSource,
} from 'theokit/client/core'

/**
 * M45 — the desktop webview on the UNIFIED client. It consumes the agent via
 * `createAgentClient(new ChannelTransport({ source }))` from the React-FREE `theokit/client/core`
 * (M42 + M44) — NO React in the webview, no bespoke `channel.onmessage` reader. The Tauri
 * `Channel`/`invoke` is wrapped as an injected `ChannelPushSource` (M42), so this file is Tauri-aware
 * but the client is the same one the web + terminal surfaces use.
 */
interface TauriChannel {
  onmessage: (line: string) => void
}
interface TauriCore {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  Channel: new () => TauriChannel
}
const tauri = (globalThis as { __TAURI__?: { core: TauriCore } }).__TAURI__
if (tauri === undefined) {
  throw new Error('Tauri globals unavailable — run inside the desktop shell (`npm run dev`).')
}
const { invoke, Channel } = tauri.core

const out = document.getElementById('out') as HTMLDivElement
const form = document.getElementById('composer') as HTMLFormElement
const input = document.getElementById('input') as HTMLInputElement

/** The Tauri Channel/invoke bridge as an injected ChannelPushSource (M42 ADR-0051 D2). */
const source: ChannelPushSource = {
  start(turn, { onLine, onClose, onError }) {
    const channel = new Channel()
    channel.onmessage = (line: string) => {
      // A Stdout event may carry multiple newline-delimited JSON lines.
      for (const part of String(line).split('\n')) {
        const trimmed = part.trim()
        if (trimmed) onLine(trimmed)
      }
    }
    void invoke('run_turn', { message: turn.message, onChunk: channel }).then(onClose, (err) => {
      // A Tauri command rejection is a real error — surface it, never swallow it as a clean close.
      onError?.(err instanceof Error ? err : new Error(String(err)))
    })
    // The Rust shell kills the prior sidecar on the next run, so no explicit abort is needed.
    return () => undefined
  },
  settle: async (id: string, decision: ApprovalDecision) => {
    await invoke('approve', { approvalId: id, approved: decision.approved })
  },
}

const client = createAgentClient(new ChannelTransport({ source }))

form.addEventListener('submit', (event) => {
  event.preventDefault()
  const message = input.value.trim()
  if (!message) return
  input.value = ''

  const echo = document.createElement('div')
  echo.textContent = `› ${message}`
  out.appendChild(echo)
  const bubble = document.createElement('div')
  out.appendChild(bubble)

  void (async () => {
    try {
      for await (const uiMessage of client.stream({ message })) {
        bubble.textContent = uiMessage.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('')
      }
    } catch (err) {
      const errLine = document.createElement('div')
      errLine.className = 'err'
      errLine.textContent = `⚠ ${err instanceof Error ? err.message : String(err)}`
      out.appendChild(errLine)
    }
  })()
})
