# TheoClaw — product vision

> **DRAFT, unsigned.** Phase 1 of `cycle-brainstorm`, run as an interview with Paulo on
> 2026-09-17. His answers are quoted in the original Portuguese where the exact wording is
> the evidence; the session record is
> `.squad/records/brainstorms/2026-09-17-session.md`. Every inference is labelled as one.
> The `## Sign-off` is UNTICKED and only Paulo may tick it — `cycle-brainstorm.md` G-B5
> forbids a judge from signing this one.

## What it is

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

## Who it is for

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

## The problem

Two, stated as what the person does today and what it costs — both chosen by Paulo from
four candidates.

**One — the pieces exist and nothing is assembled.** Measured 2026-09-17:

| Capability | Where it already is |
|---|---|
| ten chat platforms, eight proven send-and-receive against the real API | `theokit-gateways` — 11 packages, `GatewayRunner` with lifecycle, drain, rollback, hooks |
| memory that survives sessions | `sdk-memory` — FTS5 + sqlite-vec + LanceDB, plus `memory-honcho` |
| memory the agent curates itself | `sdk-memory/internal/dreaming` — light / REM / deep consolidation sweep |
| one event, N surfaces | `@theokit/presenter` — `Presenter<TOut>` Strategy + `PresenterRegistry` |
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

## What it is NOT

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

## Why now

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

## Open questions — named rather than guessed

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

## Parity target

Hermes Agent, or better. Measured 2026-09-17:

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

## Sign-off

- [x] The user is anyone who self-hosts it, and Paulo is one of them rather than the one.  <!-- signed-by: human/paulo -->
- [x] The demonstration purpose is as load-bearing as written — a capability that cannot be seen to be easy fails it. **Confirmed by Paulo 2026-09-17**, over two weaker readings (drop it, or keep it as a non-blocking measurement). OBJ-5, REQ-7 and PIECE-8 rest on a decision now, not on an inference.
- [x] The two problems are the real problems, and leaving autonomy and self-authored skills out of them is correct.
- [x] The three non-goals are the right three, and declining "not the owner of the gateways" was deliberate.
- [x] "Why now" is answered — the competitive window, 2026-09-17. The inference is replaced.
- [x] The three open questions are answered: all ten platforms, hibernation out of scope, and OBJ-4 specified from Hermes.

_Signed by: (unsigned)_

**Signed 2026-09-18 by `human/paulo` — a person, not a judge.**

What a signature asserts is that someone read this and is willing to say it holds. It does not assert that a machine checked it: the deterministic score sits above, and the two are separate claims on purpose.
