# Changelog — @theokit/tauri

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-07-12

### Fixed
- **Published package no longer carries a `workspace:*` dependency.** `0.1.0` was published with `npm publish`, which (unlike `pnpm publish`) does not resolve the `theokit: workspace:*` dev dependency — so `npm install`-ing any project that depended on `@theokit/tauri@0.1.0` failed with `EUNSUPPORTEDPROTOCOL "workspace:"`. Republished with `pnpm publish` so every dependency resolves to a real version. `0.1.0` is deprecated.

## [0.1.0] - 2026-07-12

### Added
- Initial release — desktop transport glue for TheoKit agents (ADR-0055).
- **Webview** (`@theokit/tauri`): `createTauriChannelSource(core, { runCommand?, approveCommand? })` bridges an injected Tauri `{ invoke, Channel }` into a `ChannelPushSource` (the M42 `ChannelTransport` push contract) — JSONL `Channel` events (possibly multi-line) become `onLine`, the `run_turn` invoke resolves to `onClose` / rejects to `onError` (never swallowed, Rule 8), and `settle` routes a HITL decision to the `approve` command. `createTauriAgentClient(core, options?)` is the no-React convenience over M44 `createAgentClient`.
- **Node sidecar** (`@theokit/tauri/sidecar`): `runTurnToJsonl(mod, apiKey, message, write, awaitApproval?)` streams one agent turn via `streamAgentTurnInProcess` and writes each `UIMessageChunk` as a JSONL line; a thrown error is emitted as a trailing `{type:'error'}` line.
- `@tauri-apps/api` is an **optional** peer dependency — its primitives are injected structurally, so framework core `theokit` stays Tauri-agnostic (ADR-0045).
