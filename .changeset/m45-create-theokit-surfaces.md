---
"create-theokit": minor
---

**M45 — `create-theokit --surface web|tui|desktop`: scaffold the three surfaces on the unified client.**

`create-theokit` can now generate a terminal (Ink) or desktop (Tauri) agent app, not just web.
`--surface` is a flag (mirrors `--backend`): `--surface tui` scaffolds an Ink app whose component drives
`useAgent(new InProcessTransport({ run: (i) => streamAgentTurnInProcess(mod, apiKey, i) }))` (M41);
`--surface desktop` scaffolds a Tauri app — a Node **sidecar** (`streamAgentTurnInProcess` → JSONL, the
M35/M36 server seam), a Rust `src-tauri` shell that pushes sidecar lines over a `Channel`, and a
vanilla-JS webview that consumes them via `createAgentClient(new ChannelTransport({ source }))` from the
React-FREE `theokit/client/core` (M42 + M44). Each scaffolded surface uses the UNIFIED client (the
DX-track payoff — TUI exercises M41, Desktop exercises M42 + M44's no-React client), NOT the raw seam.
`--surface web` (default) is unchanged. The Ink/Tauri/Rust boilerplate lives entirely in the scaffolder
templates — framework core stays Tauri/Ink-agnostic (ADR-0045 preserved), and `--surface` is a flag, not
a new top-level template (ADR-0023 default-only preserved). `--bare` refuses to combine with a
non-web surface (it strips the agent deps those surfaces need). ADR-0054.

> Evidence boundary (honest): the scaffold correctness (files present, unified-client wiring, web-only
> deps dropped, `{{name}}` substituted) is validated by the test suite. The generated TUI's real run
> (needs an LLM key + a TTY) and the Desktop's full Tauri **Rust build + GUI** are toolchain/key-gated —
> the Rust boilerplate mirrors the proven `theo-code-v2/apps/desktop` reference.
