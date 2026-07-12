# ADR 0054 — M45: `create-theokit --surface web|tui|desktop`

**Status:** Accepted (2026-07-12) — design GATE for M45 (accepted BEFORE code).
**Extends:** ADR-0023 (default-only template set), ADR-0045 (M36 Tauri sidecar/push — Tauri specifics stay out of core), ADR-0050/0051/0053 (the M41/M42/M44 unified client).

## Context

`create-theokit` scaffolds only the **web** app (the `default` template). M41-M44 gave all three
surfaces ONE client (`useAgent` / transports / `createAgentClient`), but a user still cannot GENERATE a
terminal (TUI) or desktop (Tauri) agent app. The reference apps (`theo-code-v2/apps/{tui,desktop}`)
prove the surfaces work, but they consume the agent via the RAW seam (`streamAgentTurnInProcess` +
manual `applyChunk`; `channel.onmessage` + manual `render`) — exactly the fragmentation M41/M42/M44
removed. M45 adds `--surface` and makes the scaffolded apps the LIVING PROOF the DX track pays off.

## Decision

**D1 — `--surface web|tui|desktop` is a FLAG (mirrors `--backend`), not new top-level templates.**
`parseSurfaceFlags(args): SurfaceKind` mirrors `parseBackendFlags` (fail-fast on unknown; default
`web`). A `--surface tui|desktop` copies a template FRAGMENT (`templates/surfaces/<kind>/`) onto the
scaffolded `default` and mutates `package.json` — mirroring `scaffoldServices` (`--backend` copies
`templates/services/agent-node` → `services/worker`). This respects ADR-0023 (default-only): web stays
the single canonical top-level template; surfaces are a flag, like polyglot backends.

**D2 — The scaffolded TUI/Desktop consume the agent via the M41/M42/M44 UNIFIED client (the payoff).**
NOT the raw seam. Specifically:
- **TUI** (Ink = React): the Ink component uses `useAgent(new InProcessTransport({ run: (i) =>
  streamAgentTurnInProcess(mod, apiKey, i) }))` (M41). The InProcessTransport's runner binds the M35
  in-process seam.
- **Desktop webview** (vanilla JS, no bundler): uses `createAgentClient(new ChannelTransport({ source }))`
  from the React-FREE `theokit/client/core` (M42 + M44 — the no-React consumer built for exactly this).
  The `source` wires the Tauri `Channel`/`invoke`.
- **Web** (default): `useAgent('/api/agents/chat')` — unchanged.
This is the whole point: the scaffolder demonstrates M41 (TUI), M42 (ChannelTransport), and M44's
no-React client (desktop webview). A test asserts the wiring string is present.

**D3 — The sidecar (server side) keeps `streamAgentTurnInProcess → JSONL` (M35/M36).** The desktop
sidecar is the server-in-a-process; it runs the agent and emits JSONL to stdout (ADR-0045 D2). The
UNIFIED client applies to the CLIENT side (the webview), not the sidecar. HITL over stdin stays as the
reference proved.

**D4 — The Tauri/Ink boilerplate lives in `create-theokit` TEMPLATE fragments; framework core stays
Tauri/Ink-agnostic.** No `@tauri-apps/*`, `ink`, Rust, or `tauri.conf.json` enters `packages/theo`.
ADR-0045 D5 said "Tauri specifics live ONLY in the example" — a scaffolder template fragment IS
example-grade (it is the code the USER gets, not framework code). So the fragment carries `src-tauri/`,
the sidecar, the Ink entry, and the surface deps; `packages/theo` is untouched. This reconciles M45
with ADR-0045.

**D5 — Honesty boundary on evidence (Rule 3).** The scaffolder's job is to GENERATE correct files. M45
validates in-env: the files are present, the agent-consumption uses the unified client (asserted by a
wiring grep), no web-only deps leak, and the generated TS is consistent. The generated TUI's real run
(needs an LLM key + a TTY) and the Desktop's full **Tauri Rust build + GUI** are toolchain/key-gated —
documented as such (the Rust boilerplate mirrors the reference `theo-code-v2/apps/desktop` EVIDENCE.md,
proven live 2026-07-09), NEVER falsely claimed as executed here.

## Consequences

- `create-theokit my-app --surface tui` / `--surface desktop` generate agent apps on those surfaces,
  each wired to the unified client — the DX-track payoff at the scaffolder.
- No new top-level template (ADR-0023 preserved); no Tauri/Ink in framework core (ADR-0045 preserved).
- The generated apps are the living proof of M41 (InProcessTransport), M42 (ChannelTransport), M44
  (no-React `createAgentClient`).

## Alternatives rejected

- **Separate top-level templates (`--template tui|desktop`)** — breaks ADR-0023 default-only and
  duplicates the agent + config across templates. `--surface` as a fragment-copy flag is DRY + consistent
  with `--backend`.
- **Scaffold the raw seam (copy the reference apps verbatim)** — misses the entire point; the templates
  must consume via the unified client to prove M41-M44 pay off (D2).
- **Put Tauri scaffolding in `packages/theo`** — ADR-0045 breach; the boilerplate is example-grade and
  belongs in the scaffolder template (D4).
- **Claim the Desktop app "runs" in-env** — dishonest without the Rust toolchain/GUI; D5 draws the
  evidence boundary explicitly.
