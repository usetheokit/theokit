# J1 — Tool

The first of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J1 in the first batch to be
implemented and measured.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J1 | **Tool** | An agent calls a typed tool and uses its result in the answer |

Three claims, each separately falsifiable: the tool is **typed** (a declared input contract, not a
free-form string), the agent **calls** it (not the developer), and the result **reaches the answer**
(not just the log).

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] a run whose prompt requires the tool produces a transcript containing a tool-call event whose
      name equals the declared tool name and whose recorded input parses against the declared
      schema — read from the captured event stream, not inferred from the final text
- [ ] the assistant's final message contains a value that is present in the tool's returned payload
      and absent from the prompt and from the system instructions, so the answer demonstrably came
      from the call; asserted by substring match against a value the test itself randomized before
      the run
- [ ] a run whose prompt does not require the tool emits no tool-call event for it — the same
      transcript oracle, asserting absence, so criterion 1 cannot be satisfied by a tool that always
      fires
- [ ] an input that violates the declared schema is refused before the tool body executes: the
      body's side effect is absent and the refusal names the failing field, verified by injecting a
      malformed call and observing both the side-effect counter and the error text
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same tool is called over the in-process path with no HTTP hop, and the transcript
      oracle above passes unchanged against that run
- [ ] TUI: the same run renders through the terminal presenter and the tool-call event is visible in
      that rendering — the presenter is shared, not re-implemented
      (`packages/presenter/src/presenters/ui-message-stream.ts:45` has the sibling that proves the
      split)

**What resisted an oracle.** "The agent used the result *sensibly*" is not gradeable, and no
phrasing rescued it. Criterion 2 replaces judgement with a randomized token: the value only exists
in the tool's return, so its presence in the answer is mechanical evidence of a data path, and
nothing more. That is less than "sensibly" and it is what can be checked.

## The Next.js side

**A fair equivalent exists.** Next.js has no agent runtime, so the honest comparison is Next.js as
the host plus the Vercel AI SDK as the agent layer — which is what Vercel itself documents and
templates, so it is neither a strawman nor a stretch.

The reference implementation: a Route Handler at `app/api/chat/route.ts` calling `streamText` with
a `tools` map, each tool carrying a Zod input schema and an `execute` function, and a client
component using the React `useChat` hook. Where an official example exists it must be used and
cited (`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the exact field name for a tool's input schema (it was renamed
between AI SDK major versions), whether `useChat` still ships from the React binding package under
that name, and which official example is the current canonical one for a tool call.

The comparison is fair because both sides end up describing the same three things — a schema, a
function body, and a registration — and the metric is how much else each side demands around them.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Scaffolder output nobody edited does not count on either side, and that
exclusion is load-bearing here: `create-theokit` already emits a working tool
(`packages/create-theokit/templates/default/agents/tools/weather.ts:35`) wired into a scaffolded
agent (`packages/create-theokit/templates/default/agents/chat.ts:25`). Counting those as work would
hand this journey a win the developer did not do. So J1 is measured by **replacing** the scaffolded
tool with a new one whose behaviour the criteria above can randomize, and the count is the files
the developer edits to do that.

**Glue lines.** The tool's body — the code that computes the answer — is business logic. Everything
else is glue: the schema declaration, the registration on the agent, any route or handler file, any
client wiring, any type ceremony. The schema is deliberately counted as glue on both sides, because
both sides need one and the journey is about the cost of arriving at a working call, not about who
invented Zod.

**Concepts required.** Derived mechanically from the imports and APIs the committed diff uses.
On our side that means each of `tool` (`packages/theo/src/server/define/tool-builder.ts:131`), the
builder's ordering rule, `z.object`, the agent builder's `.tool()`
(`packages/agents/src/bridge/agent-builder.ts:157`), and the reserved `agents/<name>/tools/`
folder convention (`packages/theo/src/server/scan/agent-scan.ts:22`) counts as one concept each —
a folder that changes routing behaviour is a name the reader must know, whether or not it is
imported.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all four
criteria assertions pass. Cold cache, at least three runs, mean and standard deviation. Model
latency is inside the measurement on both sides and is not subtracted: it is part of what a
developer waits for.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J1 is the
**missing model API key** — the first wall every developer hits, and the one where a bad message
costs the most because nothing has run yet.

| | |
| --- | --- |
| Names the action | `agent "chat" needs a model API key. Set ANTHROPIC_API_KEY in .env.local, or pass apiKey when mounting the agent.` — names the agent, the variable, the file, and the second option |
| Does not name the action | `401 Unauthorized`, `fetch failed`, `Cannot read properties of undefined (reading 'messages')` — all true, none actionable |

A second break is recorded in the same transcript because it is the one a *typed* tool ought to
catch: **a tool declared without an input schema.** The builder already refuses this at both the
type level and at runtime (`packages/theo/src/server/define/tool-builder.ts:106`), so what the
transcript grades is whether the runtime message names the missing call rather than merely
reporting a bad state. The house style to match is the plugin loader's, which names the index and
the missing member (`packages/theo/src/server/plugins/load-plugins.ts:7`) — good on both counts
except that it stops short of naming what to write.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**Nothing blocks J1.** The path exists end to end and has production callers:

- Authoring is a fluent builder, `tool(name).describe().input(schema).execute(fn).build()`, exported
  from the public `theokit/server/define` subpath
  (`packages/theo/src/server/define/tool-builder.ts:131`, barrel at
  `packages/theo/src/server/define/index.ts:33`). Ordering is enforced twice — at the type level and
  at runtime (`packages/theo/src/server/define/tool-builder.ts:106`).
- Typing is Zod, and the root must be an object schema
  (`packages/theo/src/server/define/define-agent-tool.ts:160`). The schema is converted to JSON
  Schema once at declaration (`:171`) and parsed on every call before the body runs (`:183`) —
  which is what makes criterion 4 gradeable rather than aspirational.
- Attachment is `.tool()` / `.tools()` on the agent builder
  (`packages/agents/src/bridge/agent-builder.ts:157`, `:177`), and the tool names accumulate into a
  phantom union so the surrounding types know them (`:74`).
- The scaffold ships a working example of exactly this journey
  (`packages/create-theokit/templates/default/agents/tools/weather.ts:35`), which is why the metric
  note above excludes it from the count.

**Two adjacent surfaces are implemented and unwired, and neither blocks this journey** — recorded
so the benchmark does not later mistake them for part of it:

- `ToolboxCapability` (`packages/agents/src/capability/toolbox.ts:67`) is the class-based
  alternative to the builder; its own header records that a method was removed for having zero
  callers (`:140`).
- The tool-scope binder (`packages/agents/src/tools/index.ts:11`) has no caller inside either source
  package; it is a consumer-facing primitive only.

**Not measured:** whether the scaffolded tool actually returns useful data against a live model.
The path was measured; a run was not.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey that adds a second, dependent call: `j05-multi-step.md`
- The journey that gates a call on a human: `j02-hitl.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
