# J4 — Thread

The fourth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J4 in the first batch to be
implemented and measured — and the measurement below predicts it will fail on the first run, which
is a legitimate outcome and not a reason to reschedule it.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J4 | **Thread** | A conversation survives a page reload and continues with its history |

Two obligations, and the second is the one that is easy to half-satisfy: **continues with its
history**. Rendering old messages while the model is given none of them is a UI that lies, so the
criteria below grade the model's behaviour as well as the rendering.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] after a full browser reload (a new document, not a client-side route change), the rendered
      message list contains every message from before the reload, in order, compared as a sequence
      against the transcript captured before reloading
- [ ] the model receives the history, not just the renderer: a turn issued after the reload
      references a randomized value that appeared only in a message sent before it, asserted by
      substring match — this is the criterion a "render from local cache" implementation fails
- [ ] the continuation is the same thread and not a new one: the identifier the client sends after
      the reload equals the one it sent before, read from the request rather than from any
      client-side variable
- [ ] the history survives the client entirely: clearing all browser storage for the origin and then
      reloading with the same thread identifier still yields criteria 1 and 2 — so persistence is
      demonstrably server-side
- [ ] two threads do not bleed: a second thread created in the same session shows none of the first
      thread's messages, asserted by set intersection over message ids
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: relaunching the desktop shell resumes the same thread over the in-process path, with
      criteria 1 through 3 applied to that run
- [ ] TUI: restarting the terminal client resumes the same thread. *Not applicable* is not available
      here — a terminal has no page to reload, but it has a process to restart, and that is the same
      question

**What resisted an oracle.** "Survives a reload" is ambiguous about what may legitimately be lost —
scroll position, a half-typed input, an in-flight run. No phrasing made those gradeable without
inventing product decisions the journey has no standing to make, so they are excluded and the
exclusion is stated: J4 grades message history and thread identity, nothing else. An implementation
that restores the scroll and loses the history fails; one that restores the history and loses the
scroll passes.

## The Next.js side

**An equivalent exists, and it is a recipe plus a database rather than a primitive.** Neither
Next.js nor the AI SDK persists a conversation for you: the documented pattern is to give the chat
an id, save the messages when a run finishes, and load them when the page renders.

The reference implementation: the official chat template, which already carries a database, a schema
for chats and messages, and a server component that loads a chat by id. Where an official example
exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement) — and here the example is
strong enough that using it is clearly the right call rather than a concession.

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* which persistence layer the current official template uses, the
current name of the callback that fires when a run finishes, and whether the template's message
schema already covers criterion 5's second-thread case or whether that needs adding.

**The comparison is fair, and it is fair in a direction worth naming.** The Next.js side pays for a
database it must set up; our side pays nothing for storage and, as measured below, currently pays
everything for identity. Two different costs for the same journey — which is precisely the shape the
benchmark exists to price, and the report must show both rather than netting them.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: any file the developer edits or creates to make the thread survive — the
client entry that restores an identifier, any route that lists or loads history, the schema and
migration if one is needed, and the config that points at the store. Migrations count as files: a
schema the developer had to write is work, and excluding it would hide the difference between the
two sides.

**Glue lines.** Business logic here is the empty set once more — J4 changes no answer. Every line is
glue: identity threading, storage calls, schema, loading, hydration. Reported as an **absolute
count** per the rule J8 states. One counting decision is recorded explicitly so it is applied the
same way twice: on the Next.js side the ORM schema definition is glue, and on our side any config
naming a storage location is glue. Neither side gets to call its own persistence code "business
logic".

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Ours currently
includes the thread identifier and where it is generated, the session base directory
(`packages/theo/src/server/agent/mount-agent.ts:202`), and — because there is no history endpoint —
whatever the developer has to invent to read history back. Concepts a developer must invent are
counted, and the report says which side had to invent them.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass, including the reload and the storage clear. Cold cache, at least three runs, mean
and standard deviation. Database provisioning time counts on the side that needs a database; it is
part of the journey, not setup outside it.

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side, and the journey does not pass.** What follows is a floor, not a
total: it counts the work that CAN be written in a scaffolded app, and § What is still unmeasured
names the half that cannot be written at all. Metric 4 and the whole Next.js side are unmeasured.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

**Read the numbers with the failure attached to them.** The diff below satisfies criterion 3 - the
identifier sent after the reload is the one sent before - and, through it, plausibly criteria 2 and
5. It does not satisfy criterion 1, and cannot: there is no endpoint that returns past messages
(`packages/theo/src/server/agent/serve-aux-routes.ts:92` lists what the auxiliary routes are, and
history is not among them). Criterion 4 inherits that failure, because it is criteria 1 and 2 re-run
after a storage clear. A cost of 3 files for a journey that still fails is a different fact from a
cost of 3 files for a journey that passes, and reporting the first as the second would be the
failure this programme exists to stop.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **3, and criterion 1 still fails** | `app/lib/thread-id.ts` and `app/lib/pinned-transport.ts` added, `app/hooks/use-transcript.ts` edited |
| Glue lines | **24** of 25 added, 1 blank | this journey declares business logic the empty set; the diff did not contradict it |
| Concepts required | **4** | `HttpTransport`, the `AgentTransport` seam, `chatId` as the server's session key, and `useAgent`'s transport binding with its memoization rule |
| Time to first green run | **not measured** | there is no green run to time; see below |

**Why the identifier costs a wrapper and not an argument.** The client mints its thread id in its
constructor and exposes no way to supply one - `readonly #chatId = crypto.randomUUID()`
(`packages/agents/src/client/agent-client.ts:68`), with the options object carrying only an emit
interval (`packages/agents/src/client/agent-client.ts:56`). The id does reach the server as the
session key (`packages/agents/src/client/http-transport.ts:92`), so the only place an application
can substitute its own is the transport seam (`packages/agents/src/client/transport.ts:44`), which
is public (`packages/theo/src/client/index.ts:44`). The three files are: an id that survives a
reload, a transport that pins it, and the hook that binds the two.

**The 25 added lines, classified.** Published because the glue split is the metric most open to
being argued after the fact, and a table nobody can check is not evidence.

Glue (24): in `app/lib/thread-id.ts`, all 10 - the doc comment, the signature, the `URL`
construction, the read of the `thread` parameter, the early return, the minted id, the parameter
write, the `replaceState`, the return and the closing brace. In `app/lib/pinned-transport.ts`, 9 of
10 - the import, the doc comment, the signature, the inner transport, the returned object literal,
its two delegating methods and the two closing braces. In `app/hooks/use-transcript.ts`, all 5 - the
`useMemo` import, the two local imports, the memoized transport, and the `useAgent` call rewritten
to take it.

Blank (1): the separator line in `app/lib/pinned-transport.ts`.

Business logic (0): J4 changes no answer. The counting rule fixed that in advance, and it also fixed
that neither side may call its own persistence code business logic - a rule with nothing to bite on
here, because our side writes no persistence at all.

**Four judgement calls, stated rather than buried.**

1. **The half that can be built was counted, rather than reporting no number.** The alternative was
   to record J4 as unmeasurable and stop. Counting it says something the refusal would not - that
   thread identity alone costs 3 files and 24 lines of pure glue - as long as the number is never
   quoted as the journey's cost. It is a floor. The rest is unbounded, because it has no supported
   API to be bounded by.
2. **Platform globals were not counted as concepts.** `URL`, `crypto.randomUUID` and
   `history.replaceState` appear in the diff and are not framework concepts; counting them gives 7
   and starts measuring the browser. Both sides pay them identically, which is the reason they carry
   no signal.
3. **The id lives in the URL rather than in local storage.** Criterion 4 requires it to survive a
   storage clear, so a `localStorage` version fails that criterion outright while costing about the
   same three files. The choice is forced by the criteria, not preferred.
4. **The concepts list written above did not survive the measurement.** § How the four metrics are
   counted here named the thread identifier and where it is generated, the session base directory
   (`packages/theo/src/server/agent/mount-agent.ts:202`), and whatever must be invented to read
   history back. Measured: the session directory never appears in the diff, because the framework
   resolves it and the developer never names it; the invented history reader is not in the count
   because it could not be written; and the list did not anticipate the transport seam, because it
   did not anticipate that the identifier is unreachable through the supported binding. Counting
   `useAgent`'s transport binding and its memoization rule as two concepts rather than one gives 5.

### What is still unmeasured, and why

**Criterion 1 has no implementable path, so its cost is not a large number - it is not a number.**
Reading history back would mean inventing a reader over the SDK's own transcript, whose format lives
outside this repository and was not read (§ Current state and blockers records the same limit).
Writing a figure for work whose shape is unknown would be an estimate wearing a measurement's
clothes.

**Metric 4 (time to first green run) has no green run to time.** Even setting aside that it needs a
live model call on both sides, the run it would time does not exist on this one.

**Criteria 2 and 5 are inferred from source, not observed.** The identifier reaches the server and
the server continues a session by it; whether the model then receives the prior turns depends on the
SDK's transcript, which was not read and about which this measurement makes no claim.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the
winning rule cannot be applied. § The Next.js side already named the asymmetry worth watching: that
side pays for a database and ours pays for identity, and the report must show both costs rather than
netting them into one.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet.

**So: J4 is not won, not tied, and not run.** It is the one journey in this batch that a scaffolded
application cannot finish, and the count above is the price of getting partway.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J4 is a
**thread identifier that changes on reload** — which, as § Current state records, is not a break we
have to inject.

| | |
| --- | --- |
| Names the action | `agent client generated a new thread id on construction; the previous conversation is stored under "th_4c1". Pass a threadId to restore it.` — names what happened, names the id that was orphaned, names the call that would have kept it |
| Does not name the action | Nothing at all: a fresh, empty, entirely successful conversation. No status is wrong, no exception is thrown, no log line is emitted |

**This journey is where the fifth metric's phrasing is most strained, and the strain is a finding.**
A lost conversation produces no error site, so there is nothing to grade for whether it names an
action. Per the rule stated in J8, a silent wrong outcome is scored **fail** rather than
unmeasurable — and here that scoring is not a technicality: the developer's actual experience is
discovering the loss by hand, later, with nothing to search for.

A second break is graded in the same transcript because it does produce an error: **a thread id that
does not exist.** Names the action: `no thread "th_zzz" for agent "chat"; start a new thread or list existing ones.`
Does not: `500` with a stack, or an empty 200 that silently becomes a new thread — the second being
the same silent-success failure again, one layer down.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**Server-side persistence exists and is wired. The web client throws the key away on every reload,
so the journey fails today at criterion 3 and, through it, at criteria 1 and 2.**

What exists:

- Transcripts are persisted by the underlying SDK, and the framework threads a root directory into
  it (`packages/theo/src/server/agent/mount-agent.ts:156`, resolved to `.data/agent-sessions` at
  `:202`). The previously pluggable storage adapter was removed in favour of the SDK's native
  transcript (`packages/agents/src/bridge/sdk-adapter.ts:100`), and continuation is by session id
  (`:512`).
- The server reads a session id off the request and falls back to a fresh UUID when absent
  (`packages/theo/src/server/agent/mount-agent.ts:61`, `:68`).
- The client does send one, and says so in the code: the transport posts the chat id as the
  conversation key (`packages/agents/src/client/http-transport.ts:88`).

**The blocker, stated precisely: the client's thread id is minted in the constructor and cannot be
supplied.** It is `readonly #chatId = crypto.randomUUID()`
(`packages/agents/src/client/agent-client.ts:68`), and the options object exposes only an emit
interval (`packages/agents/src/client/agent-client.ts:56`). A reload constructs a new client, mints
a new id, and the prior turns remain on disk, unreachable. The React binding does not close the gap
either — it has no mount-time load and no thread option
(`packages/agents/src/client/use-agent.ts:75`).

**And there is no history endpoint to load from even if the id survived.** The auxiliary agent
routes are approvals, run reconnect, MCP, and thread stream/message
(`packages/theo/src/server/agent/serve-aux-routes.ts:92`); none returns past messages. The reconnect
route is a live-run resume, not history: its cache is an in-process map evicted minutes after the
run ends (`packages/theo/src/server/agent/run-event-cache.ts:11`), and the client can only
reconnect to a run it personally started (`packages/agents/src/client/http-transport.ts:104`) — so
it is dead after a reload too.

**The primitives that would close this exist and have zero callers.** The session barrel exports
identifier load/persist helpers (`packages/agents/src/session/index.ts:1`) whose only production
consumer anywhere is the transcript garbage collector
(`packages/theo/src/cli/commands/sessions-gc.ts:89`). This is the pattern Wave 0.5 was created for:
built, tested, never connected.

**So J4's blocker is small and specific** — an injectable thread id plus a way to read history back
— which is worth stating because it is a very different kind of blocker from J2's (an undecided
design) or J8's (a missing noun). It needs no ADR.

**Not measured:** the SDK's own durability guarantees behind the transcript. The framework supplies
a directory and an id; what the SDK does with them was not read, and no claim is made about it.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey that isolates these threads between tenants: `j08-tenant.md`
- The journey whose in-process durability boundary this shares: `j02-hitl.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
