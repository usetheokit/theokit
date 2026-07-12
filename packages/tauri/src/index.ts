import {
  ChannelTransport,
  createAgentClient,
  type AgentClientHandle,
  type ApprovalDecision,
  type ChannelPushSource,
  type CreateAgentClientOptions,
} from 'theokit/client/core'

/**
 * `@theokit/tauri` (ADR-0055) — the desktop transport glue for TheoKit agents.
 *
 * The webview consumes the agent via the unified client (`ChannelTransport` M42 + `createAgentClient` M44 /
 * `useAgent` M41). This module turns the Tauri `Channel`/`invoke` push into a `ChannelPushSource` so the
 * webview app writes one call instead of hand-rolling the bridge. The UI is `@theokit/ui` (the webview is a
 * browser); the runtime is `@theokit/sdk` (in the sidecar — see `@theokit/tauri/sidecar`). Core `theokit`
 * stays Tauri-agnostic — the `@tauri-apps/api` primitives are INJECTED here (ADR-0055 D3), never a hard dep.
 */

/** A Tauri `Channel<string>` — structurally matches `@tauri-apps/api/core`'s `Channel` (no hard dep). */
export interface TauriChannel {
  onmessage: (line: string) => void
}

/** The Tauri `core` primitives injected into the source (structurally matches `@tauri-apps/api/core`). */
export interface TauriCore {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  Channel: new () => TauriChannel
}

export interface TauriChannelSourceOptions {
  /** The Rust `#[tauri::command]` that runs one agent turn (default `run_turn`, matching the M45 scaffold). */
  runCommand?: string
  /** The Rust `#[tauri::command]` that settles a HITL approval (default `approve`). */
  approveCommand?: string
}

/**
 * Build a {@link ChannelPushSource} bridging a Tauri `run_turn` `Channel` + `approve` `invoke` (ADR-0045 D3).
 * Pass it to `new ChannelTransport({ source })` (M42) and drive it with `useAgent(transport)` (React webview)
 * or `createAgentClient(transport)` (see {@link createTauriAgentClient}).
 */
export function createTauriChannelSource(
  core: TauriCore,
  options: TauriChannelSourceOptions = {},
): ChannelPushSource {
  const runCommand = options.runCommand ?? 'run_turn'
  const approveCommand = options.approveCommand ?? 'approve'

  return {
    start(turn, { onLine, onClose, onError }) {
      const channel = new core.Channel()
      channel.onmessage = (line: string) => {
        // A Stdout event may carry multiple newline-delimited JSON lines (ADR-0045 D2).
        for (const part of line.split('\n')) {
          const trimmed = part.trim()
          if (trimmed) onLine(trimmed)
        }
      }
      // Forward the M43 per-request context alongside the message — the sidecar receives it via the Rust
      // command args (the ChannelPushSource contract obliges the invoke to carry `turn.context`, not drop it).
      void core
        .invoke(runCommand, { message: turn.message, context: turn.context, onChunk: channel })
        .then(onClose, (err: unknown) => {
          // A Tauri command rejection is a real error — surface it, never swallow it (Rule 8 / M45 review LOW).
          onError?.(err instanceof Error ? err : new Error(String(err)))
        })
      // The Rust shell kills the prior sidecar on the next run, so no explicit abort is needed.
      return () => undefined
    },
    settle: async (approvalId: string, decision: ApprovalDecision) => {
      await core.invoke(approveCommand, { approvalId, approved: decision.approved })
    },
  }
}

/**
 * Convenience: a standalone (no-React) agent client wired to the Tauri desktop transport. Equivalent to
 * `createAgentClient(new ChannelTransport({ source: createTauriChannelSource(core, opts) }), { context })`.
 * A React webview should instead use `useAgent(new ChannelTransport({ source: createTauriChannelSource(core) }))`
 * from `theokit/client` (so it can render with `@theokit/ui`).
 */
export function createTauriAgentClient<TInput = unknown>(
  core: TauriCore,
  options: TauriChannelSourceOptions & CreateAgentClientOptions = {},
): AgentClientHandle<TInput> {
  const { runCommand, approveCommand, ...clientOptions } = options
  const source = createTauriChannelSource(core, { runCommand, approveCommand })
  return createAgentClient<TInput>(new ChannelTransport({ source }), clientOptions)
}
