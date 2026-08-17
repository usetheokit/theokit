---
slug: m36-tauri-desktop
milestone_id: M36
created_at: 2026-07-08
goal: Realize Tauri desktop as a framework-core surface — a working desktop app that streams a real agent turn, reusing the M35 in-process seam via a Node sidecar, gated on the push-transport ADR.
---

# Plan — M36 Phase 4: Tauri desktop surface

## Goal

A working Tauri desktop app whose webview streams a real agent turn (tokens + tool events), driven by
a Node **sidecar** that runs the agent via M35's `streamAgentTurnInProcess` (single process, no HTTP),
with the push transport = Tauri `Channel<String>` (ADR-0045). Core stays transport-agnostic; all Tauri
specifics live in the example (`theo-code-v2/apps/desktop`).

## Coverage Matrix (DoD → task)

| DoD (roadmap M36) | Task |
|---|---|
| Push-transport ADR accepted BEFORE code (GATE) | ✅ ADR-0045 |
| Sidecar reuses the M35 in-process path | T1 — sidecar-core (`streamAgentTurnInProcess` → JSONL) |
| Working Tauri app (window streaming a turn) | T2 — src-tauri (Rust command + Channel + sidecar spawn) + webview |
| Packageable desktop artifact + sidecar↔core contract test | T3 — contract test + `tauri build` |
| Gates green; CHANGELOG; docs (Tauri deferred → realized) | T4 — docs + gates |

## Tasks

### T1 — Sidecar core (reuses M35 seam) — `theo-code-v2/apps/desktop/`
- `sidecar-core.ts`: `runTurnToJsonl(mod, apiKey, message, write, deps?)` — iterate
  `streamAgentTurnInProcess(mod, apiKey, { message })` and `write(JSON.stringify(chunk) + '\n')` per
  chunk; catch thrown errors → write an `{type:'error',errorText}` line (Rule 8). Injectable stream for tests.
- `sidecar.mjs`: entry — load `.env`, read message from argv, run `runTurnToJsonl(codeMod, key, msg, s => process.stdout.write(s))`.
- **TDD RED:** contract test — given a mocked chunk sequence, `runTurnToJsonl` writes exactly one JSONL
  line per chunk, each `JSON.parse`-able back to the original chunk (the sidecar↔core contract); a thrown
  stream error becomes a trailing `{type:'error'}` line.

### T2 — Tauri shell — `theo-code-v2/apps/desktop/src-tauri/` + webview
- `tauri.conf.json` (externalBin sidecar, identifier, window), `Cargo.toml` (tauri + tauri-plugin-shell),
  `capabilities/default.json` (`shell:allow-spawn` sidecar-scoped), `src/lib.rs` + `src/main.rs`:
  `#[tauri::command] run_turn(app, message, on_chunk: Channel<String>)` spawns the sidecar, reads
  `CommandEvent::Stdout` lines, `on_chunk.send(line)` each (ADR-0045 D3).
- `index.html` + `main.ts`: input → `invoke('run_turn', { message, onChunk })`; `onChunk.onmessage`
  JSON.parse + render (text-delta appends, tool-* shows). Reuses the SAME chunk shape as the TUI.
- Sidecar launcher `binaries/theo-sidecar-<triple>` (a `node` wrapper over `sidecar.mjs`, ADR-0045 D4).

### T3 — Contract test + build
- Contract test green (T1). `tauri build` (or `cargo build`) compiles the Rust shell (proves it's real).

### T4 — Docs + gates
- Update `docs/architecture/multi-surface-architecture.md` (Tauri: deferred → realized) + Ecosystem note.
  CHANGELOG. typecheck + tui/desktop tests green.

## Test Plan
- Contract (T1): sidecar JSONL round-trips the chunk stream; error → trailing error line.
- Build (T3): `cargo build` of src-tauri succeeds.
- Live: `DISPLAY=:0 tauri dev` — the window streams a real turn (tokens visible); evidence captured.

## Drawbacks & Risks
1. Push half has no design in the Request/Response waist → mitigated: ADR-0045 (Channel) signed FIRST (gate).
2. Tauri pulls Rust/webview toolchain into the example → mitigated: sidecar is the ONLY coupling; core untouched; no `adapter-tauri` in `packages/`.

## Unresolved Questions
(none — architecture fixed by ADR-0045; toolchain verified present: cargo 1.91, webkit2gtk-4.1, DISPLAY=:0.)

## Prior Art
Tauri v2 sidecar + `Channel<T>` streaming (`v2.tauri.app/develop/sidecar/`, `.../calling-frontend/`).
Codex's JSONL-over-stdout sidecar shape. M35's in-process seam (the reuse point).
