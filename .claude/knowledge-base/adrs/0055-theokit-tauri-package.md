# ADR 0055 — `@theokit/tauri`: the desktop transport-glue package

**Status:** Accepted (2026-07-12) — design GATE for UI-track Step B. Owner-directed (2026-07-12): the
`theokit-tauri` package IS created (overriding the parsimony default in the UI plan's D2).
**Extends:** ADR-0045 (M36 Tauri sidecar/push), ADR-0051 (M42 `ChannelTransport`), ADR-0053 (M44
`createAgentClient` / `theokit/client/core`), ADR-0054 (M45 `--surface desktop`).

## Context

M45's `--surface desktop` webview hand-rolls the Tauri `Channel`/`invoke` → `ChannelPushSource` wiring
inline, and the sidecar hand-rolls the `streamAgentTurnInProcess → JSONL` loop. The owner wants a
dedicated `theokit-tauri` package so desktop apps install the glue instead of copying it. `@theokit/ui`
already covers the desktop webview's UI (a Tauri webview is a browser), and `theokit/client` covers the
transport (`ChannelTransport`) + the clients (`useAgent`/`createAgentClient`) — so the package's job is the
Tauri-SPECIFIC glue between them, both webview-side and sidecar-side.

## Decision

**D1 — `@theokit/tauri` is a package in the theokit MONOREPO (`packages/tauri/`), not a separate repo.**
It is tightly coupled to `ChannelTransport` (`packages/theo/src/client/`), so same-monorepo avoids a
cross-repo version dance and reuses the changesets release train. It is OPT-IN — an app installs
`@theokit/tauri` explicitly and `packages/theo` NEVER imports it — so ADR-0045 ("core stays Tauri-agnostic")
holds: the `@tauri-apps` optional peer lives in `@theokit/tauri`, never in `theokit`.

**D2 — Two entries: `.` (webview, browser) and `./sidecar` (node).** They target different runtimes and must
not be bundled together:
- `@theokit/tauri` (main, webview): `createTauriChannelSource(core, opts?)` → `ChannelPushSource`, and
  `createTauriAgentClient(core, opts?)` → the M44 no-React `AgentClientHandle` wired over `ChannelTransport`.
  Imports only `theokit/client/core` (React-free). No `@theokit/sdk`, no `theokit/server`.
- `@theokit/tauri/sidecar` (node): `runTurnToJsonl(mod, apiKey, message, write, awaitApproval?)` — the M45
  sidecar core (`streamAgentTurnInProcess → JSONL`), imported from `theokit/server`. Node-only.

**D3 — The Tauri primitives are INJECTED structurally (no `@tauri-apps` hard dep).** `createTauriChannelSource`
takes `{ invoke, Channel }` (structurally matching `@tauri-apps/api/core`), so `@theokit/tauri` adds no
`@tauri-apps` runtime dependency — the app passes its `@tauri-apps/api` in (same injected-source posture as
M42's `ChannelPushSource` and M45's ADR-0051 D2). `@tauri-apps/api` is an OPTIONAL peer for types.

**D4 — Configurable command names.** `runCommand` (default `run_turn`) + `approveCommand` (default `approve`)
match the M45 Rust scaffold's `#[tauri::command]` names; overridable for apps with different command names.

**D5 — Error handling matches M45's fix (Rule 8).** The `run_turn` invoke rejection routes to `onError`
(not `onClose`) — a Tauri command error is surfaced, never swallowed as a clean close (the M45 review LOW).
Malformed JSONL lines are split + trimmed; the transport's discriminant guard drops non-chunks.

**D6 — `theokit` is a peer dependency.** `@theokit/tauri` peer-depends on `theokit` (for `theokit/client/core`
+ `theokit/server`); the app already installs `theokit`. Same version train.

## Consequences

- A desktop app installs `@theokit/tauri` and writes `new ChannelTransport({ source: createTauriChannelSource(core) })`
  (webview) + `runTurnToJsonl(...)` (sidecar) — no hand-rolled glue. The M45 `--surface desktop` template
  (Step D) consumes it.
- `packages/theo` stays Tauri-agnostic (ADR-0045 preserved) — the tauri glue is an opt-in sibling package.
- No new repo/CI; reuses the monorepo build + changesets.

## Alternatives rejected

- **A separate `theokit-tauri` repo** (matching theokit-tui/theokit-ui) — heavier (new CI/publish/release
  train) and a cross-repo version dance with `ChannelTransport`. The monorepo package is the sound choice
  for tightly-coupled transport glue (D1).
- **Putting `createTauriChannelSource` in `theokit/client`** (the plan's original D4) — the owner wants a
  dedicated package; and it keeps `@tauri-apps` out of `theokit`'s peer surface entirely.
- **UI components in `@theokit/tauri`** — rejected; the webview is a browser and reuses `@theokit/ui`. This
  package is transport/glue only (no UI, no runtime).
