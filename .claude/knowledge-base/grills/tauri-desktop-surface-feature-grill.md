---
slug: tauri-desktop-surface
generated_by: roadmap-feature
milestone_id: M36
date: 2026-07-08
status: completed
---

# Feature grill — Tauri desktop surface

## Q1 — What is this feature and why NOW (what changed)?

Realize **Tauri desktop** as an authorized framework-core surface — a working desktop app reusing
the M35 in-process path via a sidecar, gated on a **push-transport ADR** (the `fetch(Request)→
Response` waist cannot express Tauri's push half: `Channel`/`emit`). **Why now:** the owner
explicitly declared the demand ("precisamos … tauri desktop", 2026-07-08). ADR-0044 D3 deferred
Tauri gated on exactly that (demand + a push-transport ADR). With M35 delivering the in-process
path, the desktop app is the natural reuse; realizing it completes the GOLD GOAL's fourth surface
(web ✅ + MCP ✅ + TUI ⏳M35 + Tauri ⏳M36).

## Q2 — Dependencies (must be [x] before start)

M35 (Model A in-process path — the desktop reuses it), M33 (in-process caller — [x]),
M31 (builders — [x]).

## Q3 — Definition of done (user chose: push-transport ADR + real desktop app)

- Push-transport ADR accepted BEFORE any code (GATE): decides how server→client push (tokens, tool
  events) crosses the Tauri boundary (Channel/emit/IPC), since Request→Response is req/resp only;
  reconciles with ADR-0040/0044 (transport of app logic = home; agent runtime = SDK).
- Sidecar reuses the M35 in-process path (no HTTP loopback); bridges IPC↔core.
- Working Tauri app: a window that streams a real agent turn (tokens + tool events).
- Packageable Tauri bundle + sidecar↔core contract test.
- Gates green; CHANGELOG `### Added`; Ecosystem/architecture docs updated (Tauri: deferred → realized).

## Q4 — Top 2 NEW risks

1. The push half (Channel/emit) has no design in the current Request/Response waist — building the
   app before the ADR repeats the "inherits risk from an unmade call" failure the deep-research
   critics flagged. Mitigation: the ADR is a hard GATE — no Tauri code ships until it is signed.
2. Tauri pulls a Rust/webview toolchain + native bundling into the example's distribution story,
   widening the maintenance surface. Mitigation: keep the sidecar the ONLY coupling point; core
   stays transport-agnostic (reuses M35's in-process path), so Tauri specifics live only in the
   example/adapter, never in `packages/` core.
