# TheoClaw — technical pieces

> **DRAFT, unsigned.** Every PIECE cites the REQ it realises (G-B3). A piece that does not live in
> `apps/theoclaw` says which repository it lives in and why. `## Sign-off` is UNTICKED.

**This front crosses three repositories**, and that is a property of the product rather than an
accident: the assembly is here, the platform knowledge is in the gateways, the canonical event and
its presenters are in the framework.

## PIECE-1 — `ChatPresenter` — DELIVERED 2026-09-17

**Shipped**: `theokit` `54d87cfa4` — `packages/presenter/src/presenters/chat.ts`, the fourth
surface beside `json`, `terminal` and `ui-message-stream`. Verified here: the commit and the file
both exist. 7 tests, `@theokit/presenter` suite 136 passed, `tsc --noEmit` clean.

**Its first open decision is closed, by size rather than by taste.** One presenter per platform
would be ten implementations with identical event mapping, carrying three table entries of
difference — `whatsapp`, `line`, `sms` — while seven platforms need none, because they parse
markdown natively (discord, mattermost) or take a transport flag the adapter already sets
(telegram, slack, teams, matrix, email). A `ChatPresenter` calling `toDialect(text, platform)` is
Strategy composed with Strategy, one Registry entry, and the variation living where it actually
is: a table. **The variation is three table rows, not ten classes.**

**Its second decision is ANSWERED (Paulo, 2026-09-17): yes, they appear — at Hermes parity.**
*"COMPORTAMENTO E FUNCIONALIDADE DEVEM SER IGUAIS, O MÁXIMO DE EQUIPARIDADE COM O HERMES."* He
authorised cloning it, so the answer was read out of its source rather than designed here.

**And the source says the question had the wrong shape.** "Do they appear?" is not a boolean in
Hermes. `gateway/display_config.py` is a per-platform resolver — `display.platforms.<platform>.<key>`
→ `display.<key>` → platform default → global default — over four tiers chosen by ONE property:
whether the platform can edit a message it already sent.

| Tier | Meaning | `tool_progress` |
|---|---|---|
| HIGH | edits; personal or team | `all`, preview 40 chars |
| MEDIUM | edits, but customer-facing | `new` |
| LOW | no edit — progress lines are permanent | `off`, streaming off |
| MINIMAL | batch delivery | `off`, preview 0 |

Its per-platform defaults, for the ten in our catalog: discord HIGH (with
`reasoning_style: "subtext"`, because Discord's `-# ` reads as metadata); matrix, mattermost and
whatsapp-Baileys MEDIUM; whatsapp-cloud LOW *"adapter lacks edit_message; promote once it lands"*;
email and sms MINIMAL. **And the two that surprise:** telegram is HIGH but ships
`tool_progress: "off"` — *"Mobile inbox: quiet tool_progress, but keep interim commentary and
heartbeats so it doesn't look like 'typing…' for 30 minutes"* — and slack is MEDIUM with
`tool_progress: "off"` because *"Bolt posts cannot be edited like CLI; 'new'/'all' spam permanent
lines."*

So parity means **the resolver**, not the flags. Shipping `tool-call` ON everywhere would be
further from Hermes than shipping it off, because Hermes turns it off on the two platforms most
people actually use.

Four more settings this piece must carry to claim parity, each with its reason already paid for
by somebody else: `tool_progress_grouping` (`accumulate` edits one bubble; `separate` posts one
message per tool), `cleanup_progress` (delete progress bubbles after a SUCCESSFUL response where
deletion is supported — **failed runs keep them as breadcrumbs**), `live_status`
(`full` = verb + argument preview, `verb` = verb only, *"keeps paths out of shared channels"*),
and `show_reasoning: False` globally — the same discard the `"TheOi!"` bug taught us, already the
default in the product we are matching.

**This refutes a claim this front was carrying.** `appteste/server/agent-loop.ts` justifies
accumulating the whole stream with *"none of these platforms has a partial message to update"*. It
was flagged here as a claim to re-check, and Hermes' production code refutes it: its entire display
design is organised around which platforms edit, and five of ours do.

**A boundary the implementation preserved and could have destroyed:** `@theokit/presenter` keeps
`dependencies: {}`. The dialect is INJECTED and `OutboundMessage` is matched STRUCTURALLY, so
neither package imports the other. Importing the type would have made a framework package depend
on one from another repository — killing the property this piece exists to protect, inside the
commit that implements it.


realises: REQ-2, REQ-4

**Repository:** `theokit`, `packages/presenter`.
**Why there:** it consumes `AgentOutputEvent`, and that type lives there. Putting it in the
gateways would make `@theokit/gateway` depend on `@theokit/presenter` and break the property that a
gateway is usable without an agent.

The fourth surface beside `ui-message-stream`, `terminal` and `json`. Assembles `text`, drops
`reasoning` / `partial-tool-call`, turns `error` into a message, emits once on `finish`.

**Open decision:** one presenter per platform (`surface: "chat:whatsapp"`), or one presenter with
dialect as an inner Strategy. Measurement points at the second; it does not settle it.

**Open decision:** whether `tool-call`, `tool-result` and `status` reach the user. Product decision,
not implementation.

## PIECE-2 — Dialect translation — DELIVERED 2026-09-17

**Shipped**: `theokit-gateways` `37513fc` — `packages/gateway/src/text/dialect.ts`, exported from
the barrel. Verified here: commit and file both exist. 7 tests, package suite 164 passed.

Three refinements the implementation added to this description:

1. **An unteached platform passes through UNCHANGED.** Inventing a mapping fails invisibly;
   passing `**bold**` onward fails where somebody can see it.
2. **It is not a markdown parser.** It rewrites four inline markers and leaves links, headings,
   lists and blocks alone, because no measurement says what those should become on a platform
   with no equivalent. Without this stated, the piece reads as "translation is solved".
3. **Sequential `replace` is wrong here and the RED caught it.** Rewriting `**a**` to `*a*`
   produces text the italic rule then matches, so bold arrives as italic. One pass with
   alternation, and `**` before `*` is load-bearing.


realises: REQ-3

**Repository:** `theokit-gateways`.
**Why there:** it is knowledge ABOUT a platform, which is what that repository is. Exported as a
pure function, called by PIECE-1 — the dependency points gateway ← theokit, never the reverse.

`**bold**` → `*bold*` on WhatsApp, plain on LINE, unchanged on Telegram and Discord.

## PIECE-3 — `splitForDiscord` export

realises: REQ-2

**Repository:** `theokit-gateways`. **DONE 2026-09-17.**

One line. Seven of eight packages already re-exported their splitter; Discord did not, which made
it the only platform whose splitter an outside caller could not reach — and PIECE-1 must be able to
reach it precisely because it must not re-split. A cross-package gate now asserts the invariant for
all eight.

## PIECE-4 — The channel loop

realises: REQ-1

**Repository:** `apps/theoclaw`.

One `GatewayRunner` per platform, each with the handler that routes an inbound message to the agent
and the reply back through PIECE-1. This is the product's own code, and B-018 measured how much of
it should eventually move into the framework: 268 of 537 lines.

## PIECE-5 — Webhook ingest for the four that the runner cannot reach

realises: REQ-1, REQ-7

**Repository:** `theokit-gateways` (the public API) + `apps/theoclaw` (the routes).

LINE, WhatsApp Cloud, Teams and SMS deliver over HTTP, and `BasePlatformAdapter.onInbound` has no
public counterpart to hand a webhook payload INTO it. So an app that hosts its own routes — every
theokit app — cannot close the loop through the runner for those four.

**There is no seam to build. It was built on 2026-08-30 and this front did not notice for a day.**

`BasePlatformAdapter` declares, publicly and with no `@internal`:

```ts
abstract deliver(event: GatewayMessageEvent): Promise<"ok" | "no_handler" | "handler_threw">;
```

Verified 2026-09-17: ten of ten `gateway-*/src/adapter.ts` implement it, and it landed in
`theokit-gateways` `b38172b` — *"deliver() — the ingest onInbound never had (#83, #90)"* — dated
**2026-08-30**, eighteen days before this front existed. The three-state return is what makes it
usable from a route, and its docblock says why: *"Answering a webhook 200 for the first is wrong —
the provider would stop retrying a message nothing received."*

**So this piece is route code in `apps/theoclaw`, not a framework change:**

1. parse with `parseInbound` (sms) / `lineEventToMessageEvent` (line) — already public;
2. verify with `smsWebhookVerifier` / `verifyLineSignature` — already public;
3. call `adapter.deliver(event)` and **map the three states onto the HTTP response** — `no_handler`
   must not become 200.

`#83` leaves the critical path. **Teams remains the only open question here**, for an unrelated
reason: it has no signature verifier because `@microsoft/teams.apps` validates the JWT itself and
owns its own server.

---

**This is the third time today a written record disagreed with the code**, after the theokit README
(4 gateways vs 11) and B-020 (a "failing" test that is green). Here the issue `#83` described a
state the code had already left, and two sessions amplified it — one by reading the issue, one by
grepping `dispatchEvent`, the superseded per-adapter method, instead of reading the base contract
that would have given the right name. Recorded because PIECE-8 exists to stop exactly this class,
and it did not catch this one.

**The earlier draft of this piece, kept for the correction it records.** Verified 2026-09-17
against the packages:

| Package | Public today | Missing |
|---|---|---|
| `gateway-sms` | `parseInbound`, `smsWebhookVerifier`, `createWebhookServer` | delivery to the handler |
| `gateway-line` | `lineEventToMessageEvent`, `computeLineSignature`, `verifyLineSignature`, `createWebhookServer` | delivery to the handler |
| `gateway-teams` | `normalizeTeamsActivity`, `stripTeamsMentions` | signature verification (Bot Framework brings its own) + delivery |

`dispatchEvent` is public TypeScript and carries `@internal` in its docblock
(`gateway-sms/src/adapter.ts:213`). `createWebhookServer` calls it from inside; an app hosting its
own routes cannot.

That table stands, and its conclusion ("expose the last step") was already obsolete when written:
the last step was exposed eighteen days earlier.

The earlier claim, corrected: *"Teams and SMS have no inbound path at all"* is true of `appteste`,
which does not use what the packages offer, and false of the packages. Those are different
statements and the first one made the work look bigger than it is.

This is B-018 and `theokit-gateways#83`.

**First-release scope, and cheaper than it looked when Paulo decided it.** He committed OBJ-1 to
all ten platforms believing the four webhook ones were blocked on a framework change. They are
not — `deliver()` has been public since 2026-08-30. The decision was taken against an overstated
cost and survives the correction with room to spare.

## PIECE-6 — Memory

realises: REQ-5

**Repository:** consumed from `@theokit/sdk-memory`. No code here beyond configuration.

**No longer "just configuration", and that changed on 2026-09-17.** OBJ-4's specification was
read out of Hermes at Paulo's direction, and it names one thing `sdk-memory` does not do: refuse.
Hermes' memory is good because *"the `memory` tool returns an error instead of silently dropping
entries"*; `sdk-memory` declares no ceiling, so there is no refusal to inherit.

So this piece carries real work in `theokit-sdk`, a fourth repository:

1. a declared ceiling on the durable store, and an error — not an eviction — when a write crosses it;
2. truncation reported to the caller wherever it happens, starting with `dreaming-phases.ts:94`,
   which slices to 500 facts and returns no signal that it did.

**And one decision before any of it:** the user model is a local bounded file (Hermes' shape) or
`@theokit/memory-honcho` (theokit's). That fork is in REQ-5 and it is not mine to take.

## PIECE-7 — Composition

realises: REQ-6

**Repository:** `apps/theoclaw`, consuming `@theokit/di` + `@theokit/di-agent`.

**UNBLOCKED 2026-09-17, and narrowed.** The "two authoring surfaces" alarm was false: `di-agent`'s
`Tool` records metadata and nothing acts on it, while the `@Tool` ADR-0043 removed was an authoring
decorator the compiler read. Same name, different object.

**But the measurement narrowed what this piece may use.** `readToolMetadata` has zero consumers
outside its own barrel, and `createAgentProvider` reads no decorator — it takes a ready factory and
makes it REQUEST-scoped. So the nine agent decorators are declaration without an executor
(`theokit-di#70`).

**Concretely, this piece is `createAgentProvider` + `@InjectAgent` and nothing else.** Written
against `@Workflow` and `@Step`, it would be written against a vocabulary that records and stops.

## PIECE-8 — The joinery gate

realises: REQ-7

**Repository:** `apps/theoclaw` (the gate) consuming
`theokit-gateways/tools/measure-app-joinery.mjs` (the measurement).

OBJ-5 is the only objective whose failure is invisible without being measured on purpose: a
product can pass every feature test while hand-writing the glue that contradicts its own
claim. This piece is the measurement running as a gate rather than as a one-off — the tool
exists precisely so a later run subtracts from an earlier one.

**It is a piece and not a chore** because without it the demonstration purpose has no oracle,
and an objective with no oracle is a wish with a number attached.

**The tool could pass vacuously, and no longer can.** Measured against `apps/theoclaw` on
2026-09-17, before any product code existed, it reported `gap: 0, presenter: 0, total: 0`
with every row `present: false` — it resolves a hardcoded list of filenames taken from
`appteste`. It was fixed the same day in `theokit-gateways` and now exits 2 when it resolves
none of its 12 named files. Verified here: `apps/theoclaw` → exit 2; `appteste` → exit 0,
`present: 12`.

**That fix is in a working tree and is not committed** (`git status` on `theokit-gateways`,
2026-09-17: `M tools/measure-app-joinery.mjs`, plus two other files). Somebody cloning today gets
the version that passes vacuously. Written in the present tense it would be a claim about a
repository that is not yet true — the same care that kept both joinery baselines instead of
swapping one for the other.

So this piece does not start by wiring a gate around a working tool, and it does not start by
fixing the tool either — that is done. **It starts by making the tool able to see this app**:
TheoClaw adopts those filenames, or `FILES` learns the real ones, which is again work in
`theokit-gateways`.

Until then the tool exits 2 and OBJ-5 reports "not measurable" rather than "met". That is the
honest state and it is deliberately uncomfortable: a red objective nobody can satisfy by
accident.

## PIECE-9 — Authorization: who may talk to this agent

realises: REQ-1

**Repository:** `apps/theoclaw`.

**None of the other eight pieces mentions authorization, and the gap survives the self-hosted
decision rather than being removed by it.** Hermes keeps it in `gateway/authz_mixin.py`, whose
docblock names four concerns: *"may this user/chat talk to the agent, the per-adapter DM policy,
the unauthorized-DM behavior, and the bot loop guard."*

Three of the four are live here even with one instance per person:

- **Who may talk to it.** The instance is its owner's; a Telegram bot token is public by
  construction. Anyone who finds the bot can message it.
- **Per-adapter DM policy.** Each platform means something different by "private conversation".
- **Behaviour on an unauthorized DM.** Ignore, refuse, or appear not to exist — and **silence
  confirms the bot is there**, which is itself an answer.

Self-hosted **simplifies** this to an allowlist of one id rather than a permission model. It does
not delete it.

**The fourth, bot-loop, is separate and is about the product meeting itself:** Hermes'
`bot_loop_guard.py` exists because *"`{PLATFORM}_ALLOW_BOTS` only decides admission, so two Hermes
profiles replying to each other never stop."* For an open-source assistant many people self-host,
two instances sharing a channel is a matter of time rather than an edge case.

**This piece may legitimately be cut.** What it may not be is unmentioned — a first release that
answers any inbound message from anyone is a decision, and it should be one somebody took.

## PIECE-10 — The scheduler and its delivery path

realises: REQ-9

**Repository:** `apps/theoclaw`, consuming `@theokit/sdk`'s `cron.ts` and the gateway adapters.

**No other piece covers work that happens when nobody asked.** PIECE-4 routes an inbound message;
this one has no inbound message to route — it starts from a clock.

Three parts, and the second is the one that gets forgotten:

1. **The schedule and the run** — `@theokit/sdk` ships `cron.ts`; whether it carries continuity,
   per-job model pinning and a durable run record is unmeasured.
2. **The injected contract.** A scheduled turn is not a chat turn, and the agent has to be told so:
   do not deliver yourself, here is how to say nothing, here is how to declare failure, and do not
   create another job because the prompt says "weekly". Hermes' preamble is four rules long and
   every rule is a bug it already paid for.
3. **Delivery, with a separate failure target.** Success and failure can go to different places —
   a nightly job that fails should not be silent on the same channel it would have reported to.

**What must be measured before this is planned:** whether `@theokit/sdk`'s `cron.ts` has a durable
execution record, an incident ledger, and a notepad that survives between runs. Hermes has all
three; nobody has looked at ours.

## What is NOT a piece

Skills the agent writes and improves. The synthesis exists — the agent authors the EXAMPLE, CI
decides whether it becomes a skill — but the generator it depends on does not, and it lives in a
FOURTH repository (`theokit-skills`). It is named here so nobody builds it by accident, and it is
out of the first release.

## Sign-off

- [x] The ten pieces are the right decomposition.  <!-- signed-by: human/paulo -->
- [x] PIECE-10 (unattended work) is accepted as first-release scope, or deferred with the consequence written.
- [x] PIECE-8 is accepted — same decision as OBJ-5 on `objectives.md`, taken 2026-09-17. Recorded here rather than re-asked.
- [x] Three repositories is acceptable — no longer a hypothesis. Five commits across `theokit` and `theokit-gateways` could not have lived in `apps/theoclaw` without inverting the dependency PIECE-1 exists to preserve.
- [x] PIECE-1's SECOND decision is taken — yes, at Hermes parity, which means a per-platform resolver rather than three flags (Paulo, 2026-09-17).
- [x] The BEHAVIOUR is already at parity and can be signed today: `chat.ts:131-134` returns `[]` for `tool-call`, `tool-result` and `status`, which is what Hermes ships on telegram and slack — reached independently, by different reasoning (ours: adding later breaks nothing; theirs: Bolt cannot edit, so `"all"` spams permanent lines).
- [x] The MECHANISM is not, and this box is the choice to declare that as PIECE-1 work rather than carry it silently: Hermes resolves eleven display keys per platform over four tiers; we have one fixed behaviour. Turning progress on for one platform is a code change here and a config change there.
- [x] PIECE-9 (authorization) is accepted as a piece, or authorization is declared out of scope with the accepted risk written down. Silence is not one of the two.
- [x] PIECE-1's FIRST decision is taken — by measurement: three table rows, not ten implementations.

_Signed by: (unsigned)_

**Signed 2026-09-18 by `human/paulo` — a person, not a judge.**

What a signature asserts is that someone read this and is willing to say it holds. It does not assert that a machine checked it: the deterministic score sits above, and the two are separate claims on purpose.
