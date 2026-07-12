---
"theokit": minor
---

**M42 — Tauri desktop on the unified client: `ChannelTransport` (push) + reconnect parity.**

The Tauri desktop webview now consumes agents through the SAME `useAgent` as web + terminal. Ships
`ChannelTransport` — a `ChatTransport<UIMessage>` (the M41 seam) over an INJECTED Tauri-`Channel`-shaped
push source (`{ start(turn, { onLine, onClose, onError }), settle? }`), so core imports no `@tauri-apps/*`
and the transport is unit-tested with a fake. `sendMessages` bridges pushed JSONL `UIMessageChunk` lines
into a `ReadableStream` (a malformed line is skipped, never fatal); `abortSignal` tears down the source;
`reconnectToStream` returns `null` — the honest parity for a single-process push surface (the M36 sidecar
runs the turn directly; durable `runId` reconnect stays web-only, M37); `approve` routes to the injected
`settle`. `useAgent(channelTransport)` drives the desktop webview with the same return shape — no bespoke
`channel.onmessage` reader. The shared `extractLastUserText` helper is factored out (DRY across the
in-process + channel transports). Runtime/definition/compile untouched (G2). ADR-0051.
