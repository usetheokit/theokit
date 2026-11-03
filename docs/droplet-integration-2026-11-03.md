# Droplet recovery integration

The owner requested one integration branch per repository containing the recovered
droplet work, including unfinished items. These branches are recovery checkpoints;
their existence does not approve a release or complete the sprint's reviews.

## Checkouts

All three checkouts use `integration/droplet-recovery`:

- `/home/paulo/Projetos/theo/theokit-framework/integration-droplet/theokit`
- `/home/paulo/Projetos/theo/theokit-framework/integration-droplet/theokit-sdk`
- `/home/paulo/Projetos/theo/theokit-framework/integration-droplet/theokit-gateways`

The original `workspace` checkouts and the `recovery/droplet-2026-11-03/*`
references remain available. No integration rewrites their history.

## Recovery coverage

Every saved branch tip is an ancestor of its repository's integration branch:

| Repository | Saved branch references covered |
| --- | --- |
| theokit | 430 / 430 |
| theokit-sdk | 7 / 7 |
| theokit-gateways | 3 / 3 |

These counts include aliases and historical references, not that many distinct
features. The framework integration also includes the current `origin/workspace`
history, which had 19 commits absent from the recovered checkout.

The framework's additional item branches supplied:

- `theoclaw-scheduler`: durable store, cancellation, parallel scheduling and runtime wiring fixes.
- `theoclaw-remote-access`: the remote-access test's chat factory and recorded verification dates.
- `theoclaw-usage-telemetry-backup`: usage reporting, opt-in telemetry, instance locking and backup/restore.
- `theoclaw-http-api`: OpenAI-compatible routes and explicit tool invocation.
- `theoclaw-agent-to-agent`: authenticated A2A JSON-RPC and peer tools.
- `B-651`: a historical B-418 side-by-side runner fix. Its final behavior was already
  present in the hardened runner, which was retained when joining the history.

The SDK integration joins the recovered trunk delivery and the pruning delivery's
generated-document history. The gateways integration joins the recovered `develop`
history. Their final source is unchanged by those history merges.

### Detached snapshots

Twenty-five framework commits existed only in detached snapshots rather than saved
branches. They reduce to three independent tips:

- `0eb0e8046c8b`: its patches are already represented in the integration.
- `1e4c85609a0a`: its patches are already represented in the integration.
- `28e054642c4e`: an earlier HTTP implementation. A range comparison against the final
  `theoclaw-http-api` branch accounts for its patches; the final version adapts the
  HTTP dispatch import, retains current dependencies and uses the chat-agent factory
  instead of the control-agent factory. The final branch also adds regression coverage
  proving chat completions hold no control tools. Generated capability maps were rebuilt
  from the combined package build instead of selecting an old snapshot's document.

The original snapshot references remain available for inspection.

## Conflict decisions

- HTTP and A2A coexist on the same listener with distinct bearer credentials.
- A2A's reserved paths return 404 when disabled rather than reaching the webhook router.
- Telemetry preserves hook approval, tool-less chat agents, output masking and device pairing.
- Per-conversation usage uses the existing session router's key; it does not introduce a second session implementation.
- Scheduler startup preserves configured-platform validation and the hardened worker boundaries.
- The parity ledger retains all 113 entries. New rows and prior verification evidence were
  merged by identifier; integration alone is not new live-model verification.

Two added regression tests cover the combined HTTP/A2A authentication boundaries and
telemetry with hook approval. A recovered remote-access test imports its agent options
type from the module that exports it. The telemetry test keeps its 1000 ms turn-latency
regression limit; its harness deadline now also allows the exporter's bounded shutdown.

## Continuing the backlog

S-005's backlog and records were recovered separately because `BACKLOG.md`, most of
`.squad/` and the installed `.claude/` kit are ignored by Git. Preserve those records;
old validation and review receipts refer to old commits and temporary reviewer outboxes.
They must not be presented as a review of this integration commit.

Resume unfinished items against this combined source, revalidate their current behavior,
and record findings against the new commit. Do not deliver the whole recovery branch
to `develop` or publish packages based solely on recovery coverage.

The installed kit assumes `workspace` for execution. Before running it on these
integration checkouts, reconcile that branch assumption through the kit's supported
workflow; do not modify an installed gate to make it accept another branch.

## Validation at the integrated source

| Check | Result |
| --- | --- |
| Full `pnpm build` in all three repositories | PASS |
| TheoClaw production, test and web TypeScript projects | PASS |
| SDK workspace and e2e TypeScript projects | PASS |
| Gateways workspace TypeScript projects | PASS |
| SDK Biome and subentry checks | PASS; five informational diagnostics |
| SDK capability map and error-code documentation | PASS; 1270 exports / 53 entries and 256 error codes |
| Selected TheoClaw integration and unit tests | 157 passed |
| Selected agents HTTP, A2A, scheduler and capability-map tests | 117 passed |
| TheoCode side-by-side runner tests | 25 passed |
| Gateway core tests | 339 passed |
| SDK tools goal, structured output and search-adapter tests | 37 passed |
| SDK core full default suite | 6306 passed, 6 failed, 21 skipped, 6 todo |
| Generated agent-node container (B-661 runtime evidence) | PASS; uid/gid 1000:1000, HTTP health 200, Docker HEALTHCHECK healthy |

The six SDK failures are in the real-provider integration tests, all routed through
OpenRouter: Anthropic tools, vision, streaming and structured output, plus reasoning
streaming and cancellation during reasoning. The structured-output failure explicitly
reports `quota_exceeded` (HTTP 402). The other failures report unsuccessful runs or
missing reasoning deltas; their individual causes are not established by those
assertions. They remain open, rather than being classified as integration regressions
or dismissed as environmental without evidence. No paid account was replenished and
no failing real-provider test was changed to skip or pass.

This validation is not a full framework-wide test run or a completed sprint review.

The B-661 container was rendered through the actual `scaffoldServices` implementation
and built with its unchanged Dockerfile. Startup succeeded while `/app`, `node_modules`
and the shared Corepack cache were root-owned and not writable to uid 1000; observed
writes were confined to `/tmp`. This proves that specific generated service and dependency
resolution on Linux amd64, not future resolutions or every supported platform. The local
runtime report and command logs are preserved under
`.squad/records/reviews/b661-container-runtime-2026-11-03.md` and its adjacent evidence
directory. No review finding or verdict was automatically closed by this measurement.
