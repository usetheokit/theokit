# ADR 0051 — M42: Tauri `ChannelTransport` on the M41 seam (push transport + reconnect parity)

**Status:** Accepted (2026-07-12) — design GATE for M42 (accepted BEFORE code, per the ROADMAP DoD).
**Extends:** ADR-0045 (M36 Tauri sidecar + `Channel` push), ADR-0050 (M41 `ChatTransport` seam), ADR-0040 (runtime-vs-home).

## Context

M41 unified the agent client behind `ai`'s `ChatTransport` for web (`HttpTransport`) + terminal
(`InProcessTransport`). M36 (ADR-0045) shipped Tauri desktop as a real surface: a Node sidecar runs
`streamAgentTurnInProcess` and writes each `UIMessageChunk` as one JSONL line to stdout; the Rust shell
reads the lines and pushes each via Tauri `Channel<String>.send(line)`; the webview wires
`channel.onmessage`. But the webview consumes those pushed frames BY HAND (a bespoke `onmessage` reader)
— the exact fragmentation M41 removed for web + TUI, still present for the third surface.

## Decision

**D1 — `ChannelTransport implements ChatTransport<UIMessage>`.** The Tauri webview gets the SAME
`useAgent` by shipping a `ChannelTransport` on the M41 seam. Do NOT invent a parallel interface
(M41 D1) — it implements `ai`'s `ChatTransport` + the optional `approve` (`AgentTransport`).

**D2 — The push source is INJECTED (core stays Tauri-agnostic).** `ChannelTransport` takes a structural
`ChannelPushSource` — `start(turn, { onLine, onClose, onError }): teardown` (+ optional
`settle(approvalId, decision)`). The Tauri app wires it (`new Channel()`, `channel.onmessage = onLine`,
`invoke('run_agent', { message, channel })`, return an abort teardown). Core adds NO `@tauri-apps/*`
dependency and the transport is unit-tested with a FAKE source — exactly as `InProcessTransport` injects
its `InProcessRunner` (ADR-0050 D4). This honors ADR-0045 D5 (Tauri specifics live only in the example).

**D3 — Push-based `ReadableStream` via `start` (not `pull`).** A Tauri `Channel` is push (`onmessage`
fires on the sidecar's cadence), so the transport builds the stream in the `start` callback: `onLine` →
JSON-parse → `controller.enqueue(chunk)`; `onClose` → `controller.close()`; `onError` →
`controller.error`. The ReadableStream's internal queue buffers pushed frames when the consumer has no
demand. (Web/TUI differ: web parses SSE via `parseJsonEventStream`; TUI pulls an AsyncGenerator. All
three converge on `ReadableStream<UIMessageChunk>` — the seam.)

**D4 — Malformed / non-chunk JSONL is skipped, never fatal.** A corrupt pushed line (parse failure) OR
a structurally valid JSON that is not a `UIMessageChunk` (a **discriminant guard**: an object with a
string `type`) is skipped, so one bad frame never crashes the webview (Rule 8, fail-safe for a display
stream). This mirrors the web path, where `parseJsonEventStream` filters frames that fail the chunk
schema. The trust boundary here is the LOCAL sidecar (not the network), so a discriminant check — not
the full `ai` chunk schema, which `ai` does not expose as a standalone `safeParse`-able validator — is
proportionate: it rejects structureless / wrong-shape payloads before they reach `readUIMessageStream`.

**D5 — `reconnectToStream → null` (honest parity for a single-process push surface).** The M36 sidecar
runs the turn DIRECTLY via `streamAgentTurnInProcess` (no HTTP, no `RunEventCache`) — a dropped stream
means the sidecar turn is gone. So `reconnectToStream` returns `null`, identical to `InProcessTransport`
and `ai`'s `DirectChatTransport`. The durable `runId` reconnect (M37) stays WEB-ONLY. "Reconnect parity"
here means CONSISTENT modeling across in-process/push surfaces (both no-op reconnect), NOT a stub
pretending to resume a stream that does not exist.

**D6 — `approve` routes to the injected `settle`.** HITL settle on Tauri is another `invoke`; the
transport calls `source.settle?.(approvalId, decision)`. Absent `settle` (an agent with no gated tools)
→ `approve` throws a typed error (never a silent resolve, Rule 8).

**D7 — Runtime / definition / compile UNCHANGED (G2).** M42 touches only `packages/theo/src/client/`.
No `server/` change, no `@theokit/sdk` change, no new dependency. Client/boundary only (ADR-0040).

## Consequences

- Tauri joins web + TUI on ONE `useAgent` — "one client, every surface" for all three shipped surfaces.
- Core stays Tauri-agnostic (injected source); the example wires the real `Channel`/`invoke`.
- Adds no dependency, no runtime code; a pure client-side transport testable without Rust/webview.

## Alternatives rejected

- **Import `@tauri-apps/api` in core** — couples the framework to Tauri; rejected (ADR-0045 D5 posture).
  Injection keeps core clean and the transport testable.
- **Make `ChannelTransport` reconnect via the durable cache** — the M36 sidecar is direct in-process
  (no HTTP/cache); wiring durable reconnect for Tauri is a sidecar/example change, out of the core seam.
  `null` is the honest answer (D5).
- **A `pull`-based bridge** — a Tauri `Channel` is push; `pull` would need a manual buffer that the
  ReadableStream `start`-queue already provides. `start` is the natural fit (D3).
