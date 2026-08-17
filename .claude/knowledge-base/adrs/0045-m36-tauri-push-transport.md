# ADR-0045 — M36 Tauri desktop: sidecar + push transport

**Status:** Accepted (2026-07-08) — the GATE for M36 (no Tauri code ships before this is signed; roadmap M36 DoD #1).
**Extends:** ADR-0040 (runtime-vs-home), ADR-0044 (multi-surface transports are framework-core), M35 (`streamAgentTurnInProcess`).

## Context

M36 realizes **Tauri desktop** as an authorized framework-core surface (GOLD GOAL's 4th surface: web ✅ + MCP ✅ + TUI ✅ + Tauri). The multi-surface waist is `fetch(Request) → Response` (request/response). A desktop agent turn is a **stream** of tokens + tool events pushed to the UI — the waist cannot express that push half. ADR-0044 D3 deferred Tauri precisely on this unmade decision.

The deep research (Tauri v2 docs, `v2.tauri.app`) surfaced the exact primitives; this ADR picks among them.

## Decision

**D1 — Architecture: Rust shell + webview UI + Node sidecar.** The Tauri app is a Rust binary hosting a webview (the UI) plus a **Node.js sidecar** that runs the agent. The agent runs IN the sidecar via M35's `streamAgentTurnInProcess` — a SINGLE Node process, no HTTP server, no port, no CSRF. The sidecar is the reuse point: Tauri does not re-run the agent; it hosts + streams it. (Runtime stays SDK-owned per ADR-0040; the desktop shell is home.)

**D2 — Sidecar↔shell wire: JSONL over stdout.** The sidecar writes each `UIMessageChunk` as one `JSON.stringify(chunk)\n` line to stdout (the Codex shape). The Rust shell reads `CommandEvent::Stdout` line-by-line. Rationale: newline-delimited JSON is the simplest ordered streaming contract; Node `console.log` flushes per line.

**D3 — Push transport shell→webview: Tauri `Channel<T>` (NOT events, NOT invoke-return).** The Rust `#[tauri::command]` receives a `Channel<String>`; for each sidecar stdout line it calls `channel.send(line)`; the webview wires `channel.onmessage`. Rationale (docs, `v2.tauri.app/develop/calling-frontend/`): the Tauri **event** system is *"not designed for low latency or high throughput"*; **Channels** are *"designed to be fast and deliver ordered data"* for *"child process output"* — literally this use case. `invoke` alone is request/response (the waist we're escaping). **This is the push-transport answer the Request/Response waist could not give.**

**D4 — Sidecar packaging: `externalBin` with the `-$TARGET_TRIPLE` suffix.** `tauri.conf.json bundle.externalBin` + a `node` launcher named `<name>-x86_64-unknown-linux-gnu` (per-triple), scoped in `capabilities` via `shell:allow-spawn` with `"sidecar": true`. The bundling detail lives in the example; the framework ships no Tauri-specific code.

**D5 — Framework core stays transport-agnostic.** No `packages/` change for M36 beyond this ADR + docs. The sidecar imports the EXISTING `streamAgentTurnInProcess` (M35). Tauri specifics (Rust command, Channel, tauri.conf, externalBin) live ONLY in the example (`theo-code-v2/apps/desktop`). This honors the "core stays transport-agnostic; adapters live in the example" boundary (roadmap M36 risk #2 mitigation) — there is NO `adapter-tauri` in `packages/`, and `build --target` stays emit-only (ADR-0044 D6).

## Alternatives rejected

- **Tauri events (`emit`/`listen`) for streaming** — docs explicitly say events are not for high-throughput; per-token streaming would drop/lag. Channel is the documented streaming path.
- **`invoke` returning the whole turn** — collapses the stream to one response; no live tokens. Defeats the purpose.
- **An `adapter-tauri` build target in `packages/`** — a category error (ADR-0044 D6: `build --target` is emit-only; Tauri is a serve-shaped sidecar host, not an emit format). Would also pull the Rust/webview toolchain into framework core (roadmap M36 risk #2).
- **Compiling the sidecar with `@yao-pkg/pkg`** — the agent sidecar pulls `@theokit/sdk` (+ native `better-sqlite3`); a `node` launcher over the installed `node_modules` is simpler + avoids native-bundling fragility for the example. `pkg` remains an option for a shippable single-file bundle later.

## Consequences

- Tauri gets a first-class, streaming desktop surface reusing M35 with zero framework coupling to Tauri.
- The push-transport question is answered once (Channel) and documented — future push surfaces (mobile, etc.) inherit the reasoning.
- The example carries the Rust/webview maintenance; core stays clean.
