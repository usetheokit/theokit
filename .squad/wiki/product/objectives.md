# TheoKit - objectives

> **Rewritten 2026-10-05: one cascade, three products** (see the note at the top of
> `product-vision.md`). OBJ-1 to OBJ-7 are TheoClaw's and keep their numbers and wording. OBJ-8 and
> OBJ-9 are the framework's own. OBJ-10 and OBJ-11 are TheoCode's. Every horizon is 2026-10-09,
> decided by Paulo for all three products on 2026-10-05.

> **DRAFT, unsigned.** Phase 2 of `cycle-brainstorm`. Every OBJ below is derived from a
> measurement recorded in `product-vision.md`; the ones that need an answer from Paulo carry
> `_pending_` rather than an invented number. `## Sign-off` is UNTICKED.

Each objective carries a metric and a horizon (G-B2). "First release" means the first tag a
person can clone, configure and run on their own host.

**Horizons dated 2026-10-04.** Every horizon read "first release", which names no date and so can
never be missed. Paulo set one date for everything kept: **2026-10-09**, five days after the
decision. That is the date each objective is judged on, and its risk is written once, under OBJ-6,
rather than repeated six times.

**Read the vision's split before ranking these.** The problem stated there is assembly and
memory; the capability bar set there is Hermes-or-better; and the purpose stated there is
demonstrating theokit. An objective can serve one without serving the others, and each one
below names which it serves.

## OBJ-1 — The assistant answers where its user already writes

metric: the agent replies on 25 surfaces, end to end, on real accounts: every channel OpenClaw
ships in its repository (OC-1 to OC-10, OC-12, and e-mail from OC-17).
horizon: 2026-10-09.
serves: the problem (assembly) and the purpose (demonstration).

**All ten, decided by Paulo on 2026-09-17** over two cheaper options (the six that already
listen, or six with WhatsApp swapped in). This is the most expensive answer available and it
was chosen deliberately, so the cost is written here rather than discovered later:

- **Six listen in-process today** — telegram, discord, slack, matrix, mattermost, email —
  and are already proven send-and-receive against real APIs.
- **Four are webhook-only** — line, whatsapp, teams, sms — and they close the loop through
  `BasePlatformAdapter.deliver()`, public since `b38172b` (2026-08-30) and implemented by ten of
  ten adapters. ~~Blocked on `theokit-gateways#83`.~~ **Corrected 2026-09-17**: the issue stayed
  open describing a state the code had already left, and this front believed it for a day. The
  work is route code in the app, not a framework change.
- **Teams** has no signature verification in its package (the Bot Framework brings its own)
  and needs a work tenant — personal Teams has no app catalog, so a custom bot cannot be
  installed at all.
- **SMS** needs paid credentials, and its live tests have never run for lack of them.

Against Hermes, which speaks 20+, ten is the strongest parity claim reachable from the
catalog that exists.

**Widened 2026-10-04 to every channel OpenClaw ships**, decided by Paulo over two cheaper options
(the ten plus the four largest, or the ten alone). The fifteen added are Signal, iMessage, Google
Chat, IRC, Nextcloud Talk, Nostr, Feishu/Lark, Synology Chat, Tlon/Urbit, Twitch, Zalo, Zalo
Personal, ClickClack, Buzz and a browser WebChat. None of them has a package in
`theokit-gateways` today, so each is a new package there before it is a route here. Two carry a
cost the others do not: iMessage needs a signed-in Mac to drive `imsg`, and Signal needs the
`signal-cli` binary.

**Not counted, with the reason:** WeChat, WeCom, Yuanbao, Zalo ClawBot and QQ Bot (OC-11). OpenClaw
does not ship them; its docs point at plugins maintained outside its repository, so they are not
part of the product being matched.

## OBJ-2 — Nothing reaches the user that was not meant for them

metric: 0 non-user-facing events delivered to a channel, covered by a test that fails on the
hand-written loop.
horizon: 2026-10-09.
serves: the capability bar.

The measurement that makes this an objective rather than a nicety: a reply arrived on a real
phone as `"TheOi! 👋"`, the `"The"` being a fragment of the model's own reasoning.

## OBJ-3 — Formatting arrives rendered, not literal

metric: 0 literal markdown characters delivered on a platform that cannot parse them.
horizon: 2026-10-09.
serves: the capability bar.

Measured: the agent answered `**Bom Sucesso (MG)**` and both LINE and WhatsApp delivered the
asterisks, on two real phones. No package in the ecosystem translates a single character of
text — this is new work, not misplaced work.

## OBJ-4 — It remembers across sessions

metric: 0 facts dropped without the caller being told, under a declared ceiling of 800
tokens of environment memory and 500 tokens of user model; `session_search` reaches 100% of
stored sessions across every surface.
horizon: 2026-10-09.
serves: the problem (memory) and the capability bar.

**The number is not invented and it is not mine.** Asked what "remembering well" means,
Paulo answered *"Lembra e memory - assim como o hermes - PENSE QUERO TODAS AS CAPACIDADES DO
HERMES ENTAO A RESPOSTA ESTA NELE"*. So the specification was read out of Hermes rather than
guessed. From its memory documentation, 2026-09-17:

| Hermes mechanic | Its wording |
|---|---|
| two bounded stores | `MEMORY.md` ~800 tokens / 2,200 chars — *"environment facts, conventions, things learned"*; `USER.md` ~500 tokens / 1,375 chars — *"your preferences, communication style, expectations"* |
| when it writes | *"User preferences, environment facts, corrections, conventions, completed work, explicit requests"* — proactively, plus a background review after each turn |
| how it recalls | a frozen snapshot rendered into the system prompt at session start, never changing mid-session so prefix caching holds |
| **what happens at the ceiling** | *"the `memory` tool returns an error instead of silently dropping entries"* — the agent consolidates in the same turn and retries |
| beyond active memory | a `session_search` tool over SQLite + FTS5 where *"all CLI and messaging sessions are stored"*, at no token cost until queried |

**The load-bearing clause is the fourth row, and it is the one a casual reading skips.**
Hermes' memory is good not because it is large — 800 tokens is small — but because it
**refuses** rather than forgets. A bounded store that evicts silently and a bounded store
that errors have the same size and opposite guarantees.

**And the mechanism is DECIDED (Paulo, 2026-09-17): a fork of the agent per turn, as Hermes does.**
`agent/background_review.py` — after every turn, a daemon thread replays the conversation snapshot
in a forked agent and asks *"should any skill/memory be saved or updated?"*. Verified: `enabled`
defaults to `true`, and the config read is fail-open — a broken config leaves automatic review
running.

Four properties of that design the product inherits, each one a decision rather than an
implementation detail:

1. **A fork, not the running agent.** The main conversation and the prompt cache are never touched,
   so curation cannot contaminate the turn that produced it.
2. **A daemon thread**, so the user's reply is not held behind the curation.
3. **It inherits the live runtime** — provider, model, credentials, cached system prompt — so it
   hits the same prefix cache. Curation is cheap because it reuses a prefix already paid for.
4. **A dispatch-side tool whitelist.** The reviewer does not get the agent's full toolset.

**And note what the question is: "skill/memory".** One pass decides both. That is the closed
learning loop in a single mechanism, and it means the synthesis this front sketched — the agent
writes an example, CI decides whether it becomes a skill — attacks only half of it.

**Measured against what theokit has, 2026-09-17:**

- **The shape already matches.** `sdk-memory` keeps `MEMORY.md` plus `notes/` and `wiki/`,
  indexed by FTS5 with vector recall — the same corpus Hermes describes.
- **There is no `USER.md` equivalent.** `grep` for a user-profile store in `sdk-memory/src`
  returns nothing; the dialectic user model exists only through `@theokit/memory-honcho`, an
  external service. Hermes keeps it as a local 500-token file. That is a design difference
  the TRD must settle, not a gap to close by reflex.
- **No declared ceiling, therefore no refusal.** Nothing in `sdk-memory` bounds the durable
  store, so the "errors instead of dropping" guarantee has nothing to attach to. Its one
  truncation is in the consolidation sweep — `dreaming-phases.ts:94`, *"take the leading
  window when facts exceed the budget"*, `facts.slice(0, 500)`. Those facts are not lost from
  `MEMORY.md`; they are silently excluded from that sweep, and **the caller is not told.**

**Correction to an earlier reading of my own:** I first counted
`active-memory-cache.ts`'s *"oldest entries evicted first"* as silent data loss. It is a
15-second search-result cache keyed by query hash. Evicting from it loses nothing durable and
it is not a finding. Recorded because the wrong version of this paragraph would have put a
fabricated defect into a product objective.

## OBJ-5 — The product shows the framework doing the work

metric: `measure-app-joinery.mjs` exits 0 with gap 0 and presenter 0.
horizon: 2026-10-09.
serves: the purpose (demonstration).

**This objective exists because the vision's purpose is not decoration.** If TheoClaw
hand-writes the joinery, it demonstrates the opposite of its claim — that building an
assistant on theokit takes 268 lines of glue the framework should have owned.

The oracle is not a judgement: `theokit-gateways/tools/measure-app-joinery.mjs` is a
committed baseline tool, written precisely so a later run can subtract from an earlier one.
Its own docblock records why it is a script rather than an ad-hoc count — a prior review
reported 973 lines by mixing two filters, *"and the error ran in the direction that
flattered the argument."*

Its baseline on `appteste`: 537 non-blank non-comment lines across 12 files — 268 framework
gap, 50 hand-written presenter, 86 mixed, 133 legitimate app concern. This objective targets
the first two categories. The remaining 219 are not a failure.

**The metric is one clause because the tool now carries the rest, and it did not always.**
Drafted 2026-09-17, this objective read "0 lines under gap and presenter". Run against
`apps/theoclaw` that same day — before a line of product code existed — the tool answered
`{gap: 0, presenter: 0, total: 0}`, every row `present: false`. It resolves a hardcoded list
of filenames taken from `appteste`, so **the objective was already met, by an empty
directory.**

That is a fail-open gate, and the same defect the ecosystem's own B-020 test guards against
by asserting `examined === 10` before checking offenders, with its reason written down: *"an
empty offender list means two different things: ten adapters read the field, or the gate read
nothing."*

The tool was fixed in `theokit-gateways` the same day and now exits 2 rather than 0 when it
resolves none of its 12 named files, saying so: *"The zeros above are the absence of the
query's targets, not the absence of joinery."* **Verified here by running both cases**:
`apps/theoclaw` → exit 2 with the refusal; `appteste` → exit 0, `present: 12, missing: 0`.

**Two baselines, and they must not be merged.** B-018 registered 537 total / 268 gap on
2026-08-30. The same tool on 2026-09-17 reports **573 total / 292 gap**. The figures are kept
separate and dated rather than swapped, for the reason the tool's own docblock gives: *"an
ad-hoc recount is a new measurement wearing the old one's name."*

**And the two deltas are different numbers: total +36, gap +24.** Stated here because an
earlier version of this paragraph said "the 36-line delta" while discussing the gap, which is
the exact conflation the docblock was written about — a review once *"reported 973 lines by
counting raw lines against a table built from a looser filter, and the error ran in the
direction that flattered the argument."* Both deltas are evidence; only one of them is the
gap.

**Consequence for the work:** the metric is not measurable against this product until the
tool can see it — TheoClaw adopts those filenames, or `FILES` learns the real ones. Until
then the tool exits 2 and OBJ-5 reports "not measurable", which is the honest state. That is
the first task of PIECE-8, not an afterthought.

## OBJ-6 — It does what an assistant is for, not just what a chat is for

metric: all 113 rows are answered (the 106 of OpenClaw's inventory of 2026-10-04 and the 7 of
Hermes' headline list), each one shipped and verified on a real run, or declared out of scope with
the reason written. 0 silently dropped.
horizon: 2026-10-09.
serves: the capability bar, and the problem it turned out to be hiding.

### Amended 2026-10-04: OpenClaw joins the bar

Paulo widened the bar from Hermes to OpenClaw and Hermes. The 106 OpenClaw rows are in
`.squad/wiki/references/openclaw-capability-inventory.md`, each with the path in OpenClaw's source
that shows it. The rule is the one this objective already had for Hermes: a row is shipped or
declared out, and nothing disappears.

**Declared out by Paulo on 2026-10-04, with the reasons:**

| Rows | What | Why out |
|---|---|---|
| OC-37 to OC-43, and the iOS/Android part of OC-36 | native mobile apps and device nodes (camera, screen, location, node file transfer) | a native app per OS is a product of its own; the desktop stays in through `@theokit/tauri` |
| OC-15, OC-16 | telephony (Twilio, Telnyx, Plivo) and joining Meet, Zoom, Teams or FaceTime calls | real-time voice over phone and meeting infrastructure is a different product from a messaging assistant |
| OC-29 | team server, roles, shared sessions | the first non-goal in `product-vision.md`: one instance serves one person |
| OC-11 | WeChat, WeCom, Yuanbao, Zalo ClawBot, QQ Bot | OpenClaw does not ship them; see OBJ-1 |

Every other row is in, including the ones that look far from a chat: browser control, canvas,
computer use, media generation, code mode, typed workflows, cloud workers, backup, telemetry and
voice.

**The risk of the date, written once.** 2026-10-09 is five days after the decision. On
2026-10-04 TheoClaw is one file (`src/composition.ts`); the gateways cover 10 of the 25 channels;
and the framework audit of the same day found A2A broken, handoffs, prompt caching, evals and an
ACP server absent, and scheduled agent runs stubbed. A row that misses the date is reported as
missed, not quietly moved: the date is the instrument, and moving it would make it measure
nothing.

**This objective exists because the other five never said what the assistant DOES.** OBJ-1 says it
answers on ten platforms; nothing said what it answers. Asked, Paulo pointed at Hermes — and Hermes
answers in one sentence and seven rows.

**Its claim:** *"the only agent with a built-in learning loop."* Its seven rows, verbatim enough to
be checkable:

| # | Hermes' row | What it actually promises |
|---|---|---|
| 1 | a real terminal interface | TUI with multiline editing, slash autocomplete, **interrupt-and-redirect**, streaming tool output |
| 2 | lives where you do | six surfaces **from a single gateway process**, voice-memo transcription, cross-platform conversation continuity |
| 3 | a closed learning loop | curated memory with nudges, **autonomous skill creation after a complex task**, skills that improve during use, FTS5 recall, Honcho, the agentskills.io standard |
| 4 | scheduled automations | cron delivering to any platform — *"daily reports, nightly backups, weekly audits, all in natural language, running unattended"* |
| 5 | delegates and parallelizes | isolated subagents; Python scripts calling tools by RPC, *"collapsing multi-step pipelines into zero-context-cost turns"* |
| 6 | runs anywhere | seven terminal backends; Daytona and Modal **hibernate when idle** |
| 7 | research-ready | batch trajectory generation and compression, for training tool-calling models |

**Row 4 is the answer to the question this front could not answer.** What the product DOES is not
"reply to messages" — it is **run your recurring work unattended and reach you wherever you are**.
The messaging surfaces are how it reaches you; they are not the product.

### What this reverses, stated plainly

Paulo twice declined, as PROBLEMS, *"nothing happens unless you start it"* (autonomy) and *"the
agent gains no new capability"* (self-authored skills). Those are rows 3 and 4 — the core of what
Hermes sells.

Confirmed 2026-09-18: **the capability set comes from Hermes, so autonomy and self-authored skills
are IN SCOPE as capabilities**, even though neither was the problem that motivated the product.
`product-vision.md` anticipated exactly this in one sentence — *"a capability can be required by the
bar without being the problem that motivates the product"* — and it is now confirmed rather than
hypothetical. The two rank differently and phase 2 must keep them apart.

### Where each row already stands, measured

| row | status here |
|---|---|
| 2 surfaces | **six of ten proven**; gateway core exists; two identity models already differ (Telegram id vs WhatsApp LID) |
| 3 learning loop | memory **exists** (FTS5 + vector + dreaming + Honcho); **skill authoring does not** |
| 4 scheduled | **nothing.** No PIECE covers cron, delivery-on-schedule, or `[SILENT]`-style suppression |
| 5 delegation | `@theokit/agents` has delegation and A2A/ACP — unmeasured against theirs |
| 1 terminal | `theokit-tui` exists; interrupt-and-redirect unmeasured |
| 6 runs anywhere | hibernation **already declared out of scope** (2026-09-17) — one row is answered |
| 7 research | undecided, and the likeliest honest "out of scope" |

**Two rows are the real work: 3 (skill authoring) and 4 (unattended automation).** Row 6 is already
answered. The rest is assembly or measurement.

## OBJ-7 - Skills the agent writes are proven before they act

metric: 100% of the skills the agent authors pass an executed check before they become loadable;
0 activated without a passing run.
horizon: 2026-10-09.
serves: the capability bar, above it rather than level with it.

**This is where TheoClaw must be better, chosen by Paulo on 2026-10-04.** Both competitors let the
agent write skills: OpenClaw through `skill_workshop` and `/learn` (OC-73), Hermes through its
background review (row 3). Neither runs what was written before using it. The synthesis already in
`product-vision.md` is the one taken: the agent authors the skill with an example, the example is
executed, and only a passing run makes the skill loadable.

**What this reverses.** `technical-pieces.md` put skill authoring out of the first release
because the generator it relied on did not exist. Keeping OC-73 in OBJ-6 brings authoring back, so
the question left is only whether it has an oracle, and this objective answers yes.

**The second axis of superiority is OBJ-5**, also chosen on 2026-10-04: each capability is a public
theokit API a reader can copy, and the joinery measurement proves it.



## OBJ-8 - Every pillar the framework advertises works on a real run of a proof

metric: 33 of 33 pillars named in the readiness audit of 2026-10-04 are exercised end to end by
TheoClaw or TheoCode through a public theokit API on a run against a real model, or declared out
with the reason written; 0 pillars proven only by a suite that mocks the SDK.
horizon: 2026-10-09.
serves: the framework problem.

**This is the objective the two proofs exist for.** The audit read the framework pillar by pillar
(agents, file-based config, providers and models, prompts, reasoning, tools, streaming, workflows,
squad, memory, sessions, context, compaction, structured output, goals, tasks, subagents, A2A,
handoffs, guardrails, permissions, resilience, hooks, schedules, cache, personalities, evals, cost,
observability, MCP, sandbox, filesystem, ACP server) and found that a green suite says little about
a real call. A pillar counts here when a proof uses it, not when a unit test covers it.

**A pillar neither proof needs is a real outcome, not a failure to hide.** It is declared out with
its reason, or a proof grows a use for it. What is forbidden is a pillar that is neither.

## OBJ-9 - The audit's findings are closed, and CI meets a real model

metric: 8 of 8 rows of the finding table in `product-vision.md` closed, each one by a test that
failed before its fix; at least 1 job in CI calls a real model on every push to `develop`.
horizon: 2026-10-09.
serves: the framework problem.

**The last row is the one that keeps the other seven closed.** The suites import `src/` and mock
the SDK, so they cannot see a wire format that drifts, which is exactly how the A2A client came to
read JSON from a route that answers with SSE. A job that calls a real model is the instrument that
would have caught it, and its absence is why it was not caught.

**The cost, declared:** a live job spends tokens on every push and depends on a provider being up.
A provider outage must show as the job being unable to run, never as the job passing.

## OBJ-10 - TheoCode answers every row of the Codex and Claude Code bar

metric: 100% of the rows of a Codex and Claude Code capability inventory are answered, each one
shipped and verified on a real run or declared out with the reason written, 0 silently dropped;
and `apps/theocode/tools/check-codex-parity.mjs` reports 0 Codex commands answered with
`unknown command`.
horizon: 2026-10-09.
serves: TheoCode's bar.

**The rule is the one OBJ-6 already applies to TheoClaw**, moved to the other proof. Codex has an
instrument and Claude Code does not: TheoCode reads Claude Code's `settings.json` and names the keys
it ignores, and nothing compares the rest of Claude Code's surface (hooks, skills, subagents, MCP,
slash commands). The inventory is therefore the first deliverable, in the way the OpenClaw inventory
came before OBJ-6 could be counted.

## OBJ-11 - TheoCode does as well as Codex and Claude Code on the same task

metric: 0 tasks lost on the side-by-side set in `apps/theocode/docs/parity/`: run with the
method of 2026-08-25 (same prompt, byte-identical seeds, a pass and fail count from a command),
TheoCode passes every task that Codex passes and every task that Claude Code passes.
horizon: 2026-10-09.
serves: TheoCode's bar.

**Codex is already measured: equal on the tasks run**, re-measured on 2026-09-02 across a major of
the framework. Claude Code is not. The method requires the same provider, model and effort on both
sides; where that cannot be arranged against Claude Code, the run is reported as not like for like
rather than counted.

## Sign-off

**2026-10-05:** the boxes below are the 2026-09-18 signature of OBJ-1 to OBJ-6. The signature
that covers this rewritten cascade, OBJ-1 to OBJ-11, is the one in `alignment.md`.

- [x] These six are the objectives, and each serves what it says it serves.  <!-- signed-by: human/paulo -->
- [x] OBJ-6 is accepted, including that it puts autonomy and self-authored skills back IN scope as capabilities after they were declined as problems.
- [x] Rows 7 (research-ready) and 1 (terminal parity) are decided — kept or declared out, with the reason written.
- [x] OBJ-4's specification is supplied — read out of Hermes at Paulo's direction, 2026-09-17.
- [x] The user model fork is taken — **local by default, adapter pluggable** (Paulo, 2026-09-17). Measured rationale in `trd.md` REQ-5.
- [x] OBJ-1's platform selection is answered — all ten, with the cost above accepted.
- [x] OBJ-5 is accepted as a product objective and not filed as engineering hygiene (2026-09-17).

_Signed by: (unsigned)_

**Signed 2026-09-18 by `human/paulo` — a person, not a judge.**

What a signature asserts is that someone read this and is willing to say it holds. It does not assert that a machine checked it: the deterministic score sits above, and the two are separate claims on purpose.

**Amended 2026-10-04**, after the signature above: OpenClaw joined the bar (Paulo, opening the
backlog), and the cascade was brought back to the alignment scorer's current criteria. The boxes in
this section record the 2026-09-18 signature of the earlier text; the signature that covers the
amended cascade is the one in `alignment.md`.
