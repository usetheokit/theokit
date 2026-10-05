# TheoKit - product vision

> **Rewritten 2026-10-05: one cascade, three products.** Until this date the cascade described
> TheoClaw alone and lived under `apps/theoclaw/.squad/`. Paulo, on reading it: *"temos dois
> produtos o theokit e theoclaw (esse prova que o theokit cumpri o que promete)"*, and then
> *"insira tambem o theocode no mesmo nivel que o theoclaw"*. So the product is theokit, and
> TheoClaw and TheoCode are the two products that prove it. One cascade and one backlog, because
> a backlog item can trace to only one set of objectives.
>
> The TheoClaw text signed on 2026-09-18 is kept below as a section, with its headings one level
> down and its wording unchanged. Objective, requirement and piece ids keep their numbers: OBJ-1 to
> OBJ-7, REQ-1 to REQ-12 and PIECE-1 to PIECE-15 are TheoClaw's as before, and the framework and
> TheoCode take the ids after them.

## What it is

TheoKit is a TypeScript framework for building agents and the app each agent lives in: the agent
runtime (`@theokit/agents`), routing, auth, real-time and deploy, wired. Its README states the
promise in one line: *"Build the app your agent lives in."*

**A promise is kept when a real product keeps it.** Two products in this repository exist to
show that, and each is held to an outside bar:

| Proof | What it is | Its bar |
|---|---|---|
| **TheoClaw** (`apps/theoclaw`) | an open-source, self-hosted personal assistant on every messaging surface | OpenClaw and Hermes, equal or better |
| **TheoCode** (`apps/theocode`) | a terminal coding agent with a TUI and a headless CLI | Codex and Claude Code, equal or better |

Both are built only on theokit's public surface. That rule is what turns them into evidence: a
capability theokit claims is done when one of the two uses it through a public API on a real run.
If a proof has to work around the framework, the framework failed that promise, and the fix goes
into the framework, not into the proof.

## Who it is for

**A developer building an agent in TypeScript** who wants the runtime, the tools, memory,
delegation, the surfaces and the deploy target from one framework instead of assembling them.

The two proofs have users of their own, and their bars are set by those users: anyone who
self-hosts TheoClaw (see its section below), and a developer working in a terminal with TheoCode.
Those users are why the bars are outside products rather than our own feature lists: a person
choosing between TheoCode and Codex compares the two, not TheoCode against a checklist.

## The problem

**The framework's claims are mostly proven by tests that never reach a real agent.** Measured in
the readiness audit of 2026-10-04, pillar by pillar across the 33 capabilities the framework
advertises:

| Finding | Evidence |
|---|---|
| the A2A client posts JSON and reads `res.json()`, while the route it talks to answers with SSE | `packages/agents/src/a2a/a2a-client.ts:61-69` |
| the ACP tool sends `session/prompt` with no `initialize` or `session/new` before it | `packages/theo/src/server/agent/acp-tool.ts:85` |
| `BudgetOptions.maxCostUsd` is declared and never read | `packages/agents/src/types.ts:99` |
| handoffs between agents do not exist | audit, 2026-10-04 |
| the cron `generate schedule` path is a stub | audit, 2026-10-04 |
| prompt caching never turns on | audit, 2026-10-04 |
| evals do not exist, and neither does an ACP server | audit, 2026-10-04 |
| suites import `src/` and mock the SDK; no test in CI calls a real model | audit, 2026-10-04 |

**The cost:** a developer adopting one of these pillars meets the failure first, because the suite
that should have met it never left the mock. Green CI says nothing about whether the A2A call
works.

**What the two proofs add to that.** TheoClaw carries two problems of its own, chosen by Paulo on
2026-09-17 and kept unchanged in its section: the pieces exist and nothing is assembled, and the
agent forgets between sessions. No separate problem was stated for TheoCode; it is held here as a
proof of the framework problem above, and that is recorded as an open question rather than filled
in.

## What it is NOT

- **Not a hosted service for TheoClaw.** There is no signup page; TheoClaw is software a person
  runs. Decided 2026-09-17, unchanged.
- **Not multi-tenant in TheoClaw.** One instance serves one person. Decided 2026-09-17, unchanged.
- **TheoClaw and TheoCode do not replace each other.** One is a personal assistant on any surface,
  the other a coding agent in a terminal. If they converge, that is a later decision, never a
  premise here. Decided 2026-09-17, unchanged, and now true in both directions.

No non-goal for the framework itself was decided in this rewrite. It is listed under the open
questions so it is not mistaken for "everything is in scope".

## Why now

**For TheoClaw: the competitive window**, answered by Paulo on 2026-09-17 and kept in its section.
OpenClaw and Hermes are defining the category now.

**For the framework, inferred and not yet confirmed:** the 2026-10-04 audit found that several
advertised pillars fail on first contact. Every week they stay that way is a week a developer can
adopt one and meet the failure. This paragraph is an inference from the audit and is listed as an
open question.

## Open questions

1. **The framework's non-goals.** None decided in the 2026-10-05 rewrite.
2. **TheoCode's own problem.** It is held as a proof; whether it has a user problem of its own,
   stated the way TheoClaw's two are, was not asked.
3. **Why now, for the framework.** The paragraph above is an inference.

## Proof 1 - TheoClaw

The TheoClaw vision as signed on 2026-09-18 and amended on 2026-10-04, wording unchanged.

### What TheoClaw is

TheoClaw is an open-source personal AI assistant, and a direct competitor to OpenClaw and
Hermes Agent. Anyone installs their own: it comes to live inside the messaging apps they
already use, in the terminal and on the desktop, with a single agent core behind every
surface, remembering what was said before on any of them.

And it is built entirely on theokit. That is the point: every capability TheoClaw has is a
theokit capability somebody can watch working and copy. The product is the proof that
assembling an assistant of this size on this ecosystem is easy.

**The second paragraph is not marketing attached to the first.** It changes what "done"
means: a capability that works but cannot be *seen* to be easy to build fails the purpose
even when it passes its own feature test. Two consequences follow, and they are
requirements rather than preferences:

- **Every line of joinery the product hand-writes is a line that contradicts the
  demonstration.** `theokit-gateways` B-018 measured 268 lines of channel joinery the
  framework should own, out of 537 non-blank lines across 12 files in a real consuming app.
  Under a private-assistant framing that is technical debt. Under this one it is the product
  failing at its purpose, and it ranks accordingly.
- **"Use the maximum of the ecosystem" stops being an engineering preference.** Hand-wiring
  what a package already does is the demonstration showing the framework not doing the work.

**Recorded because the discarded alternative was real:** Paulo was offered the same
substance ordered the other way — demonstration first, assistant second — and chose this
one. The rejected ordering would have said that when *the feature works* and *the feature
shows the framework* conflict, the second wins. This ordering does not say that. Later
phases must not assume it does.

### Who TheoClaw is for

**Anyone who installs it.** TheoClaw is open source and self-hosted: one instance, one
person. Paulo is a user of it, not *the* user.

This corrected a premise this front had been carrying. Asked in an open question rather
than from a menu, he said (2026-09-17):

> *"Ele não é o assistente do Paulo - qualquer um pode usar o TheoClaw - ele é opensource -
> ele é concorrente direto do OpenClaw e Hermes - mas no final ele tem como objetivo
> demonstrar as capacidades real do theokit - demonstrando como é fácil criar um assistente
> pessoal como o OpenClaw/Hermes usando o theokit."*

**Mechanically, self-hosted means:** the user clones it, configures their own credentials
and runs their own instance — the shape both competitors already have. No login, no
per-user isolation, no per-tenant credential vault, because there is no second user inside
an instance.

**The situation it is used in is both, not one.** Asked whether the user is away from the
keyboard or at it, he answered *"Longe e perto QUER TODAS AS CAPACIDADES IGUAIS OU SUPERIOR
AO HERMES"*. The capability bar is absolute rather than situational. A surface that cannot
do what another surface does is not an answer to this, which is what makes the presentation
layer a product requirement instead of a rendering detail.

### The problems TheoClaw answers

Two, stated as what the person does today and what it costs — both chosen by Paulo from
four candidates.

**One — the pieces exist and nothing is assembled.** Measured 2026-09-17:

| Capability | Where it already is |
|---|---|
| ten chat platforms, eight proven send-and-receive against the real API | `theokit-gateways` — 11 packages, `GatewayRunner` with lifecycle, drain, rollback, hooks |
| memory that survives sessions | `sdk-memory` — FTS5 + sqlite-vec + LanceDB, plus `memory-honcho` |
| memory the agent curates itself | `sdk-memory/internal/dreaming` — light / REM / deep consolidation sweep |
| one event, N surfaces | `@theokit/presenter` — `Presenter` Strategy (generic over its output) + `PresenterRegistry` |
| tools, MCP, delegation, budget, cron | `sdk-tools`, `@theokit/agents`, `sdk-budget`, `sdk/cron.ts` |
| composition with request-scoped agents | `@theokit/di-agent` v0.4.0 |

The only place these have ever been wired to an agent is `appteste`, a local tree with no
git remote. It proves the assembly works and reaches nobody. **The cost:** to talk to an
agent, a person opens a terminal or an app. The agent is not where they already write.

**Two — the agent forgets between sessions.** Every conversation starts from zero; what was
explained yesterday does not exist today. **The cost:** the context is re-explained every
time, and the agent never gets better for having known someone longer — which is precisely
what Hermes claims and this product must match.

**What he did NOT choose, recorded because it constrains phase 2.** Two other candidates
were offered and declined: *nothing happens unless you start it* (autonomy) and *the agent
gains no new capability* (self-authored skills). Both are Hermes differentiators, and the
bar he set is Hermes-or-better. These are not in contradiction and must not be smoothed into
one: **the problem he feels is assembly and memory; the capability bar he set is parity or
better.** A capability can be required by the bar without being the problem that motivates
the product, and the two rank differently.

### What TheoClaw is NOT

Three, chosen from four candidates. They are what make this a decision rather than a wish.

- **Not multi-tenant.** One instance serves one person. No login, no per-user isolation, no
  per-tenant credential vault. Neither competitor does this; doing it would be the most
  expensive item on any roadmap, and it is out.
- **Not a hosted service.** There is no signup page. It is software a person runs, which
  removes billing, quota, tenant support and the SaaS comparison — and keeps the comparison
  against OpenClaw and Hermes honest, since neither of them is one.
- **Not a replacement for TheoCode.** That is a coding agent in a terminal; this is a
  personal assistant on any surface. If they converge it will be a decision taken later,
  never a premise here.

**A fourth was offered and NOT chosen: "not the owner of the gateways".** It is recorded as
declined rather than omitted, because the difference matters downstream — with it declined,
how deeply TheoClaw may change `theokit-gateways` is an open scope question and not a
settled boundary. Under the demonstration purpose that is coherent: fixing the framework IS
the product working.

### Why TheoClaw now

**ANSWERED by Paulo, 2026-09-17: the competitive window.**

OpenClaw and Hermes exist now and are defining the category. Building after it stabilises is
building a clone. **The timing is external to theokit** and has nothing to do with the 13 open
framework milestones — which is a stronger reason than the one this paragraph carried before,
and a different one.

The discarded readings are recorded because they were plausible: *"it is orthogonal to the 13
milestones"* (true, but orthogonality is not urgency — it explains why the product does not
conflict, never why it must happen now) and *"the framework needs a demanding consumer to
decide which of the 13 matter"* (an argument about the framework's needs, where this one is
about the market's clock).

**What the answer commits us to.** A window closes. It makes elapsed time a cost the other
objectives do not carry, and it is the one reason in this document that gets worse while
nothing is done.

### Open questions from 2026-09-17

1. ~~**Which platforms actually matter.**~~ **ANSWERED 2026-09-17: all ten.** The four
   webhook-only ones (line, whatsapp, teams, sms) cost more than the other six — their
   packages export parse and verify publicly, but the step that hands a payload to the
   handler was believed to be `@internal`. **It is not** — `BasePlatformAdapter.deliver()` has
   been public since 2026-08-30 and all ten adapters implement it. Answering "all ten" is
   therefore cheaper than it looked when the answer was given. (In the one app that tried, `parseFor` returns `[]` for teams and sms while
   the loop reports them as `webhook_only` — a fact about *that app*, not about the packages;
   an earlier draft of this document conflated the two.)
2. **What the assistant must DO.** The concrete capabilities — which is what `objectives.md`
   must attach a metric and a horizon to (G-B2). Without this, an OBJ-N stays `_pending_`
   rather than receiving an invented number.
3. ~~**Whether hibernating is a requirement.**~~ **ANSWERED 2026-09-17: it is not.** With
   one self-hosted instance per person it solves a cloud cost nobody is paying. Named as
   admiration for the Hermes ops story and moved to the TRD's out-of-scope, which is what
   stops it from quietly shaping the architecture toward webhook-only gateways.

### TheoClaw's parity target

**Amended 2026-10-04: OpenClaw AND Hermes, equal or better.** Paulo, opening the backlog for this
product: *"criando um sistmea IGUAL OU SUPERIOR AO OpenClaw"*. The bar was Hermes alone; it is now
both. OpenClaw's surface is inventoried row by row in
`.squad/wiki/references/openclaw-capability-inventory.md` (106 rows, version `2026.9.8`, measured
2026-10-04), and `objectives.md` OBJ-6 holds the rule every row is judged by: shipped, or declared
out with the reason written.

Decided by Paulo on 2026-10-04, in one session:

- **Every channel OpenClaw ships in its repository is in scope**, not only the ten the gateways
  already have.
- **Three areas are declared out**: mobile apps and device nodes (OC-37 to OC-43), telephony and
  joining meetings (OC-15, OC-16), and the team or multi-user deployment (OC-29, which the first
  non-goal above already excludes).
- **Where TheoClaw must be better, not level**: skills the agent writes are verified by an
  executed check before they act (OBJ-7), and every capability is visibly the framework doing the
  work (OBJ-5).
- **The horizon is 2026-10-09** for everything kept.

The Hermes comparison below is kept as it was measured on 2026-09-17. Hermes Agent, or better:

| Hermes capability | Status here |
|---|---|
| agent-curated memory, cross-session recall | **exists** — dreaming sweep + FTS5 + vector + Honcho |
| 60+ tools, MCP, open skills | **exists** — `sdk-tools`, `@theokit/agents`, skills-resolver with per-request selection |
| CLI, desktop, 20+ messaging platforms, voice | **wiring** — theokit CLI, `theokit-tui`, `@theokit/tauri`, 10 gateways, `plugin-voice` |
| skills the agent writes and improves | **refused by doctrine** — `theokit-skills`: *"No line of code and no API signature in a generated skill is written by a model"* |
| runs anywhere, hibernates when idle | **open question 3** |

The refused row has a synthesis that would place TheoClaw *above* Hermes rather than level
with it: the agent authors the **example**, the example passes `theokit-check-example` and
CI, and only then becomes a skill by byte-for-byte copy — the pipeline `theokit-skills`
already defines. Self-created skills *with* an execution oracle; Hermes has the authoring
without the oracle.

Its cost, declared: the generator does not exist yet (an open plan in `theokit-skills`, a
third repository in this front), the loop has CI latency where Hermes improves during use,
and it assumes the guarantee transfers from tool-skills to runtime-skills — **which is a
hypothesis, not a measurement.**

## Proof 2 - TheoCode

**What it is.** A terminal coding agent with one agent core and two surfaces, the Ink TUI and a
headless CLI (`apps/theocode/README.md`). `@theocode/agent` composes `@theokit/agents` with this
product's policy, and the README is explicit that it is *"Not a library of agents - the SDK is
`@theokit/agents`"*.

**Its bar: Codex and Claude Code, equal or better.** Decided by Paulo on 2026-10-05. Two parts of
it already have instruments:

- **Codex, measured.** `apps/theocode/docs/parity/2026-08-25-codex-parity.md` runs both agents on
  the same prompt, in byte-identical seed directories, with the same provider, model and effort,
  and verifies each result by a command with a pass and fail count. Re-measured on 2026-09-02:
  equal on the tasks run. `tools/check-codex-parity.mjs` compares the Codex slash-command surface
  with ours and reports any Codex command this product answers with `unknown command`.
- **Claude Code, configuration only.** TheoCode reads `settings.json` under the same names and
  paths as Claude Code, and `theocode doctor` names every key it does not implement. Nothing yet
  measures Claude Code's other surface (hooks, skills, subagents, MCP, slash commands) against
  TheoCode. That inventory does not exist, which is the TheoCode equivalent of the OpenClaw
  inventory TheoClaw already has.

**Why it proves the framework.** A coding agent leans on the pillars a messaging assistant barely
touches: long sessions and compaction, the PTY, sandboxed file and shell tools, subagents, goals,
review, and an ACP entry (`dist/acp-entry.mjs`). TheoClaw proves theokit can reach a person; TheoCode
proves it can do sustained work for one.

## Sign-off

**2026-10-05:** the boxes below are the 2026-09-18 signature of the TheoClaw vision, now the
"Proof 1" section above. The signature that covers this rewritten cascade is the one in
`alignment.md`.

- [x] The user is anyone who self-hosts it, and Paulo is one of them rather than the one.  <!-- signed-by: human/paulo -->
- [x] The demonstration purpose is as load-bearing as written — a capability that cannot be seen to be easy fails it. **Confirmed by Paulo 2026-09-17**, over two weaker readings (drop it, or keep it as a non-blocking measurement). OBJ-5, REQ-7 and PIECE-8 rest on a decision now, not on an inference.
- [x] The two problems are the real problems, and leaving autonomy and self-authored skills out of them is correct.
- [x] The three non-goals are the right three, and declining "not the owner of the gateways" was deliberate.
- [x] "Why now" is answered — the competitive window, 2026-09-17. The inference is replaced.
- [x] The three open questions are answered: all ten platforms, hibernation out of scope, and OBJ-4 specified from Hermes.

_Signed by: (unsigned)_

**Signed 2026-09-18 by `human/paulo` — a person, not a judge.**

What a signature asserts is that someone read this and is willing to say it holds. It does not assert that a machine checked it: the deterministic score sits above, and the two are separate claims on purpose.

**Amended 2026-10-04**, after the signature above: OpenClaw joined the bar (Paulo, opening the
backlog), and the cascade was brought back to the alignment scorer's current criteria. The boxes in
this section record the 2026-09-18 signature of the earlier text; the signature that covers the
amended cascade is the one in `alignment.md`.
