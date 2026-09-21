# TheoClaw — technical requirements

> **DRAFT, unsigned.** Every REQ cites the OBJ it serves (G-B3). Requirements whose value depends
> on an unanswered question carry `_pending_` rather than a number. `## Sign-off` is UNTICKED.

## REQ-1 — The gateway runner is consumed, not reimplemented

serves: OBJ-1

The product SHALL drive `GatewayRunner` from `@theokit/gateway` for every platform that delivers
inbound in-process. It SHALL NOT write its own connection lifecycle.

Measured: the runner already owns adapter connection with rollback on partial failure, drains
in-flight handlers before disconnecting, and refuses to restart once stopped (`GatewayLifecycleError`).

**One runner per platform, not one for all six.** `start()` connects with `Promise.all` and rolls
back on partial failure, so with credentials of differing freshness the first stale token silences
every other platform. Per-platform runners cost one map and buy failure isolation — measured in
`appteste/server/gateway-agents.ts`.

## REQ-2 — Presentation is a presenter, never a loop

serves: OBJ-2, OBJ-3

Agent output SHALL reach a channel through a `Presenter<OutboundMessage>` registered in
`PresenterRegistry`, never through a hand-written stream loop.

`AgentOutputEvent` is a discriminated union of eight variants and the compiler enforces
exhaustiveness over it, so `reasoning` cannot be forgotten silently. That is the structural
argument, and it is why OBJ-2 is achievable by construction rather than by discipline.

The presenter SHALL emit exactly ONE `OutboundMessage` per turn and SHALL NOT split — the adapter
splits, as it already does (ADR D1 of B-019; 8 of 8 splitters already split inside `sendMessage`,
so a pre-splitting presenter would double-split).

## REQ-3 — Dialect translation is presentation, and it is new

serves: OBJ-3

The presenter SHALL translate markdown into the target channel's dialect before emitting.

Measured across every `adapter.ts` and `split.ts` in the ten packages: no package transforms a
single character of text. What exists is markdown escape, HTML escape, phone normalisation and
post-cut newline cleanup. The adapters refuse translation deliberately — `gateway-whatsapp` reads
`format` only to warn once, because emphasis there is inline in the text.

**Direction of dependency:** the translation is exported as a pure function BY `@theokit/gateway`
and CALLED by the presenter in `theokit`. `@theokit/gateway` must never depend on
`@theokit/presenter`, or a gateway stops being usable without an agent.

## REQ-4 — A failed run is told, not swallowed

serves: OBJ-2

An `error` event SHALL become a user-facing message. The event's `message` and `code` SHALL NOT
reach the channel — they may carry internal detail.

On a channel, silence is indistinguishable from an agent that ignored the user.

## REQ-5 — Memory is consumed from the SDK

serves: OBJ-4

The product SHALL use `@theokit/sdk-memory` and SHALL NOT implement its own store. The dreaming
sweep (light → REM → deep) is the consolidation mechanism.

Following OBJ-4's specification, read out of Hermes:

- The environment store SHALL declare a ceiling (Hermes: ~800 tokens) and the user model SHALL
  declare its own (Hermes: ~500 tokens).
- **A write that would exceed a ceiling SHALL fail with an error naming what must be
  consolidated, and SHALL NOT drop or evict silently.** This is the guarantee that makes a small
  memory good, and `sdk-memory` has no ceiling today, so it has nothing to attach the refusal to.
- Any truncation anywhere in the pipeline SHALL be reported to the caller. Today
  `dreaming-phases.ts:94` takes the leading 500 facts and says nothing.
- `session_search` over FTS5 SHALL reach sessions from every surface, not only the one that is
  running.

**RESOLVED 2026-09-17: local by default, adapter pluggable.** The product SHALL ship a local
bounded user-model file as the default and SHALL reach richer providers through the
`MemoryAdapter` contract (ADR D141), of which `memory-honcho`, `memory-mem0` and
`memory-supermemory` are already implementations.

The two ends were measured rather than weighed by taste:

| | local (`sdk-memory`) | external (`memory-honcho`) |
|---|---|---|
| required dependencies | none — `better-sqlite3`, `sqlite-vec` and `@lancedb/lancedb` are all `peerDependenciesMeta.optional` | `@honcho-ai/sdk@^2.1.0` |
| credential | none | `HONCHO_API_KEY`, required by the option type |
| degradation | declared — without `sqlite-vec`, `index.status().backend` reports `"fts-only"` and search stays text-only | `isAvailable()` returns false; the first call raises `MemoryAdapterError(code: "auth_failed")` — it degrades to *no memory*, not to lesser memory |

Three decisions already taken pushed this: the product is self-hosted and open source, so a
mandatory third-party account is an adoption barrier the `create-theokit` scaffold does not
have; REQ-7 makes "easy to build" a product criterion, and *"create a Honcho account and put the
key in .env"* is the demonstration showing the framework needing a third party for its most
differentiating capability; and it competes with Hermes.

**And a fourth reason, which arrived after the decision and is stronger than the three above:
Hermes already made this exact call.** Verified in its `pyproject.toml:245-250` — `honcho`,
`supermemory` and `mem0` are opt-in extras, lazy-installed at first use, and *"deliberately
excluded from `[all]` … so a quarantined upstream release can't break fresh installs."*

This corrects a framing this document carried. An earlier draft presented the fork as *"superior
capability with an install barrier"* against *"lesser capability that installs clean"*, with the
implication that choosing local was trading capability for reach. **It is not a trade the
competitor declined to make — it is the position the competitor holds**, for a reason we had not
considered: a third-party release going bad must not break a fresh install of our product. Default
local with a pluggable adapter is not our third way. It is the state of the art here.

**What this does NOT claim.** Honcho's advantage is real and named in its own README: *"recall
returns ONE synthesized answer about the user, not a list of raw facts"*, and a list of raw facts
is not a user model. The adapter seam is what keeps that reachable in one line rather than
discarding it. **The consequence to watch:** a default that ships and a path that does not is a
path nobody exercises, and the local default must therefore be the one that is tested.

## REQ-6 — Composition is declared, not wired by hand

serves: OBJ-1

Where the product composes an agent with its tools, memory and channels, it SHALL use
`@theokit/di` + `@theokit/di-agent` rather than hand-wiring, unless a measurement shows the
container costs more than it saves.

**The "two authoring surfaces" alarm was false, and the measurement dissolved it (2026-09-17).**
`@theokit/di-agent`'s `Tool` is a `PropertyDecorator` that calls `Reflect.defineMetadata` and
returns, and its own docblock says so: *"Records metadata only. Nothing in this package acts on
it."* The `@Tool` that ADR-0043 removed was an AUTHORING decorator read by theokit's compiler,
which produced an agent. Same name, different object. `AgentBuilder.create()` remains the single
authoring surface and nothing competes with it.

**What the measurement found instead is worse, and it narrows this requirement.** `readToolMetadata`
— the function that reads what `@Tool` writes — has zero consumers outside the barrel that
exports it, and `createAgentProvider` reads no decorator at all: it takes a ready factory and
makes it REQUEST-scoped. So `@Tool`, `@SubAgent`, `@Squad`, `@Workflow`, `@Step`, `@Cron`,
`@Hitl`, `@Retriever` and `@Reranker` are declaration without an executor. Filed as
`theokit-di#70`.

**Therefore, concretely:** the product SHALL use `createAgentProvider` + `@InjectAgent` for
request-scoped agents, and SHALL NOT build on the metadata decorators while nothing consumes
them. A requirement written against `@Workflow` and `@Step` would be written against a vocabulary
that records and stops.

## REQ-7 — The joinery the framework should own is not written here

serves: OBJ-5

Where a seam exists between the agent and a channel, the product SHALL consume a public API
of the framework or a gateway package. Where no such API exists, the product SHALL close the
gap IN the framework rather than route around it in application code.

This is the demonstration purpose expressed as a requirement, and it inverts the usual
trade-off: a local workaround that ships sooner is the wrong answer here, because the
product's claim is that the framework does this work.

Acceptance: `measure-app-joinery.mjs` reports 0 lines under `framework gap` and 0 under
`presenter` for `apps/theoclaw`.

**Known gaps this requirement points at, already filed by others:** `theokit-gateways#83`
(no public API to hand a webhook payload to `onInbound`), `#84` (reply addressing), B-018
(the descriptor that would remove the five hand-written joins per channel), B-019 (the
channel presenter).

## REQ-8 — What a consumer installs is what we reviewed

serves: OBJ-5

The product SHALL publish with exact dependency versions rather than ranges, and a new version of
any dependency SHALL reach a user only through an intentional update here.

**This is not hygiene, and the reason is a dated incident in the product we are matching.** Hermes'
`pyproject.toml:20-28` states it: ranges let the registry ship a fresh transitive at any time with
no review on our side. It was tightened on **2026-05-12** after the Mini Shai-Hulud worm hit
`mistralai 2.4.6` on PyPI — *"if that release had been captured by `mistralai>=2.3.0,<3` rather than
an exact pin, every install in the hours before the quarantine would have pulled it."* Verified: 29
exact pins against 6 ranges in its main `dependencies` block.

**It matters more here than there.** TheoClaw is open source and self-hosted, so every person who
installs it resolves our manifest on their own machine. A transitive compromised between our
release and their `install` is damage our pinning decides, for someone we will never meet.

**The policy has a second half, and it was measured on 2026-09-18.** `hermes security audit` on a
same-day fresh install of the product that wrote this policy reported **12 known vulnerabilities
across 109 components** — 3 HIGH, 3 MODERATE, 6 unscored — all in `httpx2`/`httpcore2` 2.7.0, all
fixed upstream in 2.10.0–2.12.0. The pin holds 2.7.0.

**So exact pinning buys protection from a compromised NEW release and costs sitting on a
KNOWN-vulnerable old one.** Neither pins nor ranges is safe on its own. What makes the policy
defensible is the audit that makes the debt visible: **the product SHALL also ship a command that
reports known vulnerabilities in what it pinned.** A pin without an audit is a vulnerability with a
changelog entry.

**Open, and it is a real question rather than a formality:** the monorepo's current policy is not
this one, and changing it is not this product's decision alone to make. What this requirement
forces is that the answer be stated — pins or ranges, plus what reports the debt — rather than
inherited by default.

## REQ-9 — Unattended work is a first-class path, not a chat that happens to repeat

serves: OBJ-6

The product SHALL be able to run a task on a schedule, without a person present, and deliver the
result to the surface the user chooses.

**This is row 4 of OBJ-6 and it is the row that says what an assistant is FOR.** Everything else
this TRD requires is about a message arriving and being answered well; this is about work happening
when nobody asked.

Four properties the reference implementation pays for, each one a defect somebody already hit:

1. **The scheduled run must be able to say nothing.** Hermes injects a literal `[SILENT]` token and
   instructs: *"never translate or rephrase it, whatever language the rest of your answer uses.
   Never combine [SILENT] with content."* A daily job that reports "nothing to report" every day is
   spam, and a multilingual model that translates its own control token breaks the suppression.
2. **The scheduled run must be able to declare its own failure** — Hermes uses `[CRON_FAILURE]` on
   the first line when a delegated child fails.
3. **The scheduled run must not schedule more of itself.** A prompt containing *"every Monday"* is
   context for this run, never a request to create another job. Hermes states this explicitly in
   every injected preamble.
4. **A run may see its previous run's output** (`--continuity`), which is what makes a job that
   accumulates possible rather than a job that repeats.

**Acceptance:** a job created from natural language runs unattended, delivers to a configured
platform, can suppress its own delivery, and a second run can see the first's output.

**Explicitly NOT required:** the scheduler does not need a hibernating host. That was decided out on
2026-09-17 and row 6 of OBJ-6 is answered by that decision.

## Out of scope

- Multi-tenancy, per-tenant credential vaults, onboarding. One instance serves one person;
  the product is open source and self-hosted, so "anyone can use it" is satisfied by anyone
  running their own rather than by tenancy inside one.
- A hosted service. There is no signup, no billing and no quota.
- Replacing TheoCode. That is a coding agent in a terminal; convergence would be a later
  decision, never a premise.
- **Hibernation and remote-host operation.** Decided out by Paulo on 2026-09-17: with one
  self-hosted instance per person, hibernating solves a cloud cost nobody is paying. It was
  admiration for the Hermes ops story, and naming it as such is what keeps it from quietly
  shaping the architecture — it would have forced durable state outside the process, fast
  cold start, and gateways that survive hibernation, which the three socket-holding ones
  (telegram long-poll, discord, matrix) do not. Running in serverless later is a new decision
  with a concrete case, not a premise here.

**Deliberately NOT out of scope: owning what happens in `theokit-gateways`.** An earlier
draft excluded it. Paulo was offered "not the owner of the gateways" as a fourth non-goal and
did not choose it, so how deeply this product may change that repository is an OPEN scope
question rather than a settled boundary. Under REQ-7 that is coherent: fixing the framework
is the product working.

## Sign-off

- [x] REQ-1..8 are the right requirements.  <!-- signed-by: human/paulo -->
- [x] REQ-7 is accepted, including that it forbids the faster local workaround — decided on the vision's sign-off, 2026-09-17, over dropping it and over keeping it non-blocking.
- [x] Leaving gateway ownership OPEN rather than excluded is deliberate.
- [x] REQ-6's open question is resolved — by measurement, not by choice: there are no two authoring surfaces.
- [x] No `_pending_` value remains in any requirement, objective or piece (verified 2026-09-17; the four remaining hits are header text explaining the convention).

_Signed by: (unsigned)_

**Signed 2026-09-18 by `human/paulo` — a person, not a judge.**

What a signature asserts is that someone read this and is willing to say it holds. It does not assert that a machine checked it: the deterministic score sits above, and the two are separate claims on purpose.
