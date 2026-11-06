# 0034: TheoClaw adopts server primitives where their contracts fit

- Status: Accepted
- Date: 2026-11-06
- Issue: B-728 (#1199)

## Decision

Evaluate the published modules against the daemon's current behavior, including its HTTP and
optional desktop surfaces. An import for its own sake is not adoption. Preserve the existing
channel identity, local durability, cancellation, and unpriced-usage contracts. These are scope
decisions for TheoClaw, not claims that the modules cannot run in Node.

The discovery document named in the issue is absent from this checkout. The scheduler already
uses `@theokit/agents/tools` for its store, scheduler and tools (`src/scheduler/scheduler-wiring.ts`);
WebChat already uses `@theokit/agents/bridge` (`src/webchat/routes.ts`). Their remaining code wires
product behavior, rather than implementing another timer engine or streaming protocol.

Paths in the adoption column are relative to `apps/theoclaw/`. Framework citations are repository
paths at this decision's head. Every module named by the issue, including the two existing core
imports and the two sibling packages, appears below.

| Module | Status | Evidence and decision |
| --- | --- | --- |
| `theokit/server/agent` | adopted | `src/tools/acp-transport.ts` imports the ACP transport contract; `src/tools/tool-registry.ts` imports `createACPTool`. Retain the existing adoption and its ACP tests. |
| `theokit/server/webhook` | adopted | `src/triggers/trigger-route.ts` imports `github` and `VerifyFn`. Retain signature verification and its trigger tests. |
| `theokit/server/cron` | not adopted | `packages/theo/src/server/cron/cron-runtime-node.ts:38` exposes only start/stop over the fixed definitions supplied at line 50. TheoClaw adds and cancels durable schedules while running, and awaits shutdown of running jobs through its existing agents scheduler. The validator at `packages/theo/src/server/cron/cron-validate.ts:34` also rejects the `@daily`/`@hourly` forms TheoClaw supports. Replacing the heartbeat validator would change accepted configuration; retaining its SDK compatibility tests is intentional. |
| `theokit/server/jobs` | not adopted | `packages/theo/src/server/jobs/index.ts:33` and `:35` publish memory and Postgres backends. Neither replaces the daemon's durable workspace schedule file: memory loses schedules on restart, Postgres adds an external service. `packages/theo/src/server/jobs/job-backend.ts:74` models enqueue/dequeue/ack, not recurring schedules or agent sessions. Keep the already adopted agents job store. |
| `theokit/server/auth` | not adopted | `packages/theo/src/server/auth/session.ts:41` takes HTTP requests and responses for cookie sessions. The daemon's sessions are channel-keyed agent leases, not browser identities; authorization uses authenticated gateway sender IDs, pairing, owners and group activation. Cookies cannot establish these identities. The other auth helpers (OAuth/TOTP/encryption) do not replace that policy or the control plane's constant-time bearer digest comparison. |
| `theokit/server/storage` | not adopted | `packages/theo/src/server/storage/use-unstorage.ts:64` constructs optional unstorage KV storage; `packages/theo/src/server/storage/use-database.ts:99` constructs an optional db0 database. Neither contract provides the existing synchronous validated workspace snapshot load, atomic file replacement and agent-lease generation semantics. `packages/theo/src/server/storage/storage-manager.ts:89` caches a supplied factory; wrapping existing file stores in it would delete no persistence implementation. Keep the local stores and their restart/corruption tests. |
| `theokit/server/realtime` | not adopted | `packages/theo/src/server/realtime/channel-manager.ts:7` subscribes WebSockets to rooms and `:29` broadcasts JSON to all room subscribers. WebChat streams one authorized turn over SSE through agents/bridge; the control plane also uses per-turn streams. A shared room broadcast neither replaces that protocol nor preserves per-turn isolation. |
| `theokit/server/rate-limit` | not adopted | `packages/theo/src/server/rate-limit/rate-limit.ts:56` buckets Node requests by socket address; `:141` exposes a string-keyed Web checker. TheoClaw has no local request counter to replace. Applying IP buckets to chat would conflate users behind a gateway, while its existing admission rules concern sender authorization and concurrent agent leases, not requests per time window. Adding a new throttling policy is outside this adoption. |
| `theokit/server/observability` | not adopted | `packages/theo/src/server/observability/middleware.ts:56` returns a TheoPlugin for framework request hooks, which the standalone daemon does not host. `packages/theo/src/server/observability/adapters/types.ts:4` explicitly assigns agent/tool/LLM spans to the SDK adapter. TheoClaw's `src/telemetry/otel.ts` owns the SDK's OTel providers, opt-in exporters, Prometheus endpoint and secret masking; the request adapter does not replace those lifecycle/exporter contracts. A second logger would not replace the injected product output port. |
| `theokit/server/cost` | not adopted | `packages/theo/src/server/cost/track-agent-run.ts:9` requires numeric `costUsd`. TheoClaw preserves absent/nonfinite prices as `costUnpriced`, including in stream frames and chat footers (`src/usage/turn-usage.ts`). Recording such a run as zero would report it free; dropping it would lose token usage. The module's storage/query and tool tracking APIs do not replace the current formatting or SDK run accounting. |
| `theokit/server/security` | adopted | `src/daemon-launchd.ts` and `src/daemon-schtasks.ts` import `escapeHtml` for XML text. Remove `escapeXml` from `src/daemon-common.ts`. The five escaped characters are shared by XML text and HTML text; the framework emits the XML-valid numeric apostrophe reference `&#39;` instead of `&apos;`. Move the plist escaping regression to `tests/daemon-security.test.ts` and cover Windows principal, arguments and working directory there too. No untrusted HTML or script context is introduced. |
| `@theokit/tauri` | not adopted | `packages/tauri/src/index.ts:26` requires injected Rust `invoke`/`Channel` primitives, unavailable in the daemon. The optional desktop sidecar forwards turns to the running daemon to preserve its authorization/session ownership; `packages/tauri/src/sidecar.ts:27` instead runs an AgentModule in-process with an API key and generates a fresh session at line 41. Adopting it would create a second agent runtime. The existing dev dependency exercises the transport in `tests/live/surfaces.live.test.ts`; that test-only import is not daemon runtime adoption. |
| `@theokit/agents-pty` | not adopted | `packages/agents-pty/src/index.ts:31` exports `PtyInteractiveBackend`, a native interactive-terminal backend. `src/tools/tool-registry.ts` deliberately registers the confined noninteractive shell and withholds interactive shell/stdin tools. A PTY cannot replace that backend while preserving the current read-only and approval boundaries, and no terminal session is needed by the daemon. |

No row is a **framework gap**: the non-adoptions above preserve current product requirements using
existing primitives, or decline an unused capability. This decision registers no new framework
work and requires no invented B-number. Revisit a row when its stated product requirement changes.

## Verification

Build the workspace packages and TheoClaw CLI before running the suite (subprocess tests use the
built CLI). The package build, TheoClaw build, typechecks, changed-file lint and citation checks
passed. The focused daemon suite passed 20 tests across three files.

The full `pnpm --filter theoclaw test` run had 1,681 passing tests, 81 skipped tests and 15 failures
in two existing host-dependent files: `tests/sandbox-confinement.test.ts` requires working Linux
user namespaces/bubblewrap, unavailable in this container; `tests/lan-publisher-conflict.test.ts`
requires real multicast probe/announce delivery, which timed out here. These tests remain unchanged.
The offline run excludes those two files explicitly:

```sh
NODE_NO_WARNINGS=1 pnpm --filter theoclaw test \
  --exclude tests/sandbox-confinement.test.ts \
  --exclude tests/lan-publisher-conflict.test.ts
```

That run exited 0: 141 files passed, 1,671 tests passed and 81 tests skipped.

`NODE_NO_WARNINGS=1` suppresses the sandbox's injected Node proxy warning, which otherwise breaks
existing empty-stderr assertions. It does not supply either missing host capability.

The daemon XML tests generate both service definitions without invoking an OS service manager.
Existing scheduler, session, authorization, WebChat, ACP and trigger tests remain at their existing
paths because those implementations were not replaced. No parity ledger entry is changed. Actual
launchd/Task Scheduler registration, sandbox confinement, multicast delivery and live
model/account/desktop interaction are not established by these offline tests.
