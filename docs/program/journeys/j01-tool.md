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

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side.** This is the TheoKit half of the contrast. The Next.js half is
measured in the section that follows it, and the two are put side by side in the section after that.
Metric 4 is unmeasured on both sides.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **3** | `agents/chat.ts` edited, `agents/tools/order-lookup.ts` added, `agents/tools/weather.ts` deleted. The deletion counts because the metric section above defines this journey as *replacing* the scaffolded tool |
| Glue lines | **8** | of 15 added lines; 5 are business logic and 2 are blank |
| Concepts required | **5** | `tool`, the builder's ordering rule, `z.object`, the agent builder's `.tool()`, and the `agents/<name>/tools/` folder convention - the list fixed in advance above |
| Time to first green run | **not measured** | needs a live model call; see below |

**The 15 added lines, classified.** Published because the glue/logic split is the metric most open to
being argued after the fact, and a table nobody can check is not evidence.

Glue (8): the two imports in the tool file, `tool('order_lookup')`, `.describe(...)`, `.input(...)`,
`.build()`, the import in `chat.ts`, and `.tool(orderLookupTool)`.

Business logic (5): the `SHIPPING_REFERENCES` table and the `.execute` body - the data the answer
comes from and the code that produces it.

**One judgement call, stated rather than buried.** `const SHIPPING_REFERENCES: Record<string, string>`
carries a type annotation, and the metric definition lists type ceremony as glue. It is counted as
business logic because the line's substance is the lookup table, not the annotation. Counting it as
glue would move the split to 9/4 and does not change the shape of the result. The Next.js side must
be counted by the same rule, and the diffs are published so the rule can be checked rather than
trusted.

## Measured - Next.js side, metrics 1-3 (2026-08-20)

**The other half, measured the same day by the same rule.** From a real diff in a throwaway app that
is not committed here: the instrument is disposable, the evidence is what gets versioned
(`.claude/rules/northstar-app.md` records the same split for the north-star app). The app builds and
typechecks; it was never run against a model, and § What is still unmeasured says so.

### The three version-specific facts, confirmed against the source

§ The Next.js side above deferred three questions to implementation time. All three were checked
against the packages actually installed and against Vercel's own documentation, and the answers are
recorded here including where they diverged from what the section supposed.

| Deferred question | Answer | Checked against | Diverged from the supposition? |
| --- | --- | --- | --- |
| The exact field name for a tool's input schema | `inputSchema` | the `tool()` declaration in `@ai-sdk/provider-utils`, re-exported by `ai@7.0.70`, plus the v7 tool-calling page | **No.** It was `parameters` through v4 and `inputSchema` from v5 on, so "renamed between majors" was right, and the current name is the later one |
| Whether `useChat` still ships from the React binding package under that name | Yes - `@ai-sdk/react@4.0.73` exports `useChat` | the installed package's own export list | **Partly.** The name survived; the shape did not. `useChat` no longer owns the input field, so the official example pairs it with `useState` and calls `sendMessage({ text })`. The hook is where the section expected it and does less than it used to |
| Which official example is the current canonical one for a tool call | the AI SDK **Next.js App Router quickstart**, `https://ai-sdk.dev/docs/getting-started/nextjs-app-router`, source of truth `content/docs/02-getting-started/02-nextjs-app-router.mdx` in `vercel/ai` | fetched from the repository that publishes the docs site | **No** - and it is the implementation this file predicted: a Route Handler at `app/api/chat/route.ts` calling `streamText` with a `tools` map, each tool carrying a Zod schema and an `execute`, plus a client component using `useChat` |

Two things the quickstart settles that the prediction did not reach. First, the provider: v7 resolves
a bare model string through the Vercel AI Gateway, so `model: 'openai/gpt-4o-mini'` needs no provider
import - the same string the TheoKit scaffold passes to `.model()`. Second, and more consequential,
the quickstart has a **third** stage after the tool: `stopWhen`. Its default is one step, so a tool
call ends the generation and the result never reaches the answer. The docs open that section with the
symptom - the model "isn't using this information to answer your original query" - which is precisely
this journey's criterion 2 failing. One line fixes it, and a developer who does not know the line has
a tool that fires and an answer that ignores it.

Versions under test: `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `zod@4.4.3`, Node 22.

### The baseline, and the argument for it

`create-next-app` emits no agent at all, so there is no scaffolded tool to replace and the choice of
starting point decides the result. Three candidates were considered:

| Candidate baseline | What it makes free | Rejected / chosen because |
| --- | --- | --- |
| Raw `create-next-app` | nothing | **Rejected as the headline.** The TheoKit measurement got a working chat agent *and* a working client for free from its scaffold. Charging Next.js for both while TheoKit is charged for neither measures the two scaffolds, not the two ways of declaring a tool |
| The `vercel/chatbot` template (formerly `ai-chatbot`), which does ship tools to replace | an entire deployable product: auth, Postgres, artifacts, in-browser code execution | **Rejected.** It is a product, not a scaffolder's output. Excluding it as "scaffold output nobody edited" would make the measured delta a function of how much of somebody's application already existed |
| The official quickstart's **pre-tools stage** - the streaming chat route handler and the `useChat` page, copied verbatim from the docs and committed untouched | a running chat app with no journey-specific tool | **Chosen.** It is the structural mirror of what `create-theokit` hands the developer, and it is official example output rather than something written for this measurement |

So the Next.js baseline is: `create-next-app` (TypeScript, App Router, Tailwind), then
`npm install ai @ai-sdk/react zod`, then `app/api/chat/route.ts` and `app/page.tsx` pasted verbatim
from the quickstart's chat stage. That state is committed untouched. J1 is the delta from there.

**One formatting control.** Line counts move with the printer. The quickstart ships at Prettier's
80-column default with semicolons; the `create-theokit` template ships `printWidth: 100, semi: false`
(`packages/create-theokit/templates/default/.prettierrc`). Both the Next.js baseline commit and the
Next.js J1 commit were formatted with the **TheoKit** config, so both sides are counted with the same
ruler. Left at the docs' own 80 columns the same change reads 25 added lines instead of 20 - a
difference produced entirely by wrapping, which is why the ruler is stated rather than assumed.

### Metrics 1-3

| Metric | Next.js + AI SDK | How it was counted |
| --- | --- | --- |
| Files touched | **2** | `app/api/chat/route.ts` edited, `app/page.tsx` edited. Nothing added, nothing deleted - the tool lives inline in the route file, which is where the official example puts it |
| Glue lines | **14** | of 20 added lines; 5 are business logic and 1 is blank |
| Concepts required | **6** | `tool`, `isStepCount`, `stopWhen`, `z.object`, the `tools` map on `streamText`, and the `tool-${toolName}` part-type convention |
| Time to first green run | **not measured** | needs a live model call, on both sides; see below |

### The diff, published

The same reason the TheoKit diff is published: the glue/logic split is the metric most open to being
argued after the fact, and a table nobody can check is not evidence. This is `git diff` between the
baseline commit and the J1 commit, verbatim.

```diff
diff --git a/app/api/chat/route.ts b/app/api/chat/route.ts
@@ -2,9 +2,17 @@ import {
   streamText,
   UIMessage,
   convertToModelMessages,
+  tool,
+  isStepCount,
   createUIMessageStreamResponse,
   toUIMessageStream,
 } from 'ai'
+import { z } from 'zod'
+
+const SHIPPING_REFERENCES: Record<string, string> = {
+  'A-1001': 'SHIP-7F3K-2210',
+  'A-1002': 'SHIP-9Q4M-8871',
+}

 export async function POST(req: Request) {
   const { messages }: { messages: UIMessage[] } = await req.json()
@@ -12,6 +20,16 @@ export async function POST(req: Request) {
   const result = streamText({
     model: 'openai/gpt-4o-mini',
     messages: await convertToModelMessages(messages),
+    stopWhen: isStepCount(5),
+    tools: {
+      orderLookup: tool({
+        description: 'Look up the shipping reference for an order id.',
+        inputSchema: z.object({
+          orderId: z.string().describe('The order id, e.g. "A-1001"'),
+        }),
+        execute: async ({ orderId }) => SHIPPING_REFERENCES[orderId] ?? `No order ${orderId}.`,
+      }),
+    },
   })

   return createUIMessageStreamResponse({
     stream: toUIMessageStream({ stream: result.stream }),
   })
 }

diff --git a/app/page.tsx b/app/page.tsx
@@ -15,6 +15,8 @@ export default function Chat() {
             switch (part.type) {
               case 'text':
                 return <div key={`${message.id}-${i}`}>{part.text}</div>
+              case 'tool-orderLookup':
+                return <pre key={`${message.id}-${i}`}>{JSON.stringify(part, null, 2)}</pre>
             }
           })}
         </div>
```

**The 20 added lines, classified.**

Glue (14): in `route.ts`, the three import lines (`tool`, `isStepCount`, `import { z }`),
`stopWhen: isStepCount(5)`, `tools: {`, `orderLookup: tool({`, `description: ...`,
`inputSchema: z.object({`, the `orderId` field line, and the three closing lines that finish the tool
literal and the map; in `page.tsx`, the `case 'tool-orderLookup':` label and its `return`.

Business logic (5): the `SHIPPING_REFERENCES` table and the `execute` body - deliberately the same
five lines of substance as the TheoKit side, computing the same answer from the same data, so that
what the two counts differ by is the ceremony and nothing else.

Blank (1).

**The tool is typed, and the typing was checked rather than assumed.** `execute` receives
`{ orderId: string }` inferred from the Zod `inputSchema`; assigning it to a `number` is a compile
error, and `next build` typechecks the route. A schema violation is refused before the body runs -
the SDK raises `InvalidToolInputError`, the same guarantee the TheoKit side gets from parsing the
schema on every call. Criterion 4 is therefore gradeable on both sides.

### Counting judgements, stated rather than buried

Five, each with the effect of deciding it the other way. Two of them change which side wins a metric.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | Does the client edit belong to J1? Criterion 1's oracle reads the captured event stream, not the rendered surface, so the `case 'tool-orderLookup':` branch is not what makes the criteria pass - the tool result already reaches the answer text without it | **Counted anyway.** The official example includes it, and § Why the protocol comes before the measurement says the official example must be used where one exists. This is the judgement most favourable to TheoKit in the whole count | Files 2 to **1**, glue 14 to **12**. Next.js would then win metric 1 by 3x - outside the noise bar, an outright loss for TheoKit rather than a tie |
| 2 | Is `const SHIPPING_REFERENCES: Record<string, string>` glue or logic? | **Logic** - the same call the TheoKit side declared, applied identically | Both sides move together: Next.js 15/4, TheoKit 9/4. No effect on the comparison |
| 3 | Are `stopWhen` and `isStepCount` one concept or two? | **Two.** One is an imported symbol, the other is the rule that without it a tool result never reaches the answer - the same shape as counting `tool` and the builder's ordering rule separately on the TheoKit side | Concepts 6 to **5**, an exact tie with TheoKit |
| 4 | Does installing `zod` belong to J1? | **No** - the quickstart installs `ai`, `@ai-sdk/react` and `zod` together in its dependency step, before the tool exists, so all three sit in the baseline commit | Files 2 to **3**, an exact tie with TheoKit on metric 1 |
| 5 | Does the `app/api/<name>/route.ts` App Router convention count as a concept? | **No** - the diff edits that file, it does not create it, whereas the TheoKit diff creates a file under the `agents/<name>/tools/` folder convention and is charged for knowing it | Concepts 6 to **7** |

## The two sides compared

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | 3 | **2** | Next.js | 1.5x | **Tie** - inside the 2x bar, and TheoKit is the worse side |
| Glue lines | **8** | 14 | TheoKit | 1.75x | **Tie** - inside the 2x bar |
| Concepts required | **5** | 6 | TheoKit | 1.2x | **Tie** |
| Time to first green run | not measured | not measured | - | - | not applicable |

**J1 is a tie, and it is the metric TheoKit loses that decides it.** The winning rule requires
TheoKit to be better on all three countable metrics by at least 2x. It is better on two of them, by
1.75x and 1.2x - both inside the bar - and it is **worse** on files touched. No reading of the rule
turns that into a win, and the tie is reported as a tie.

The absolute gaps say the same thing more plainly than the ratios. Six glue lines separate the two
sides. Judgement 1 alone moves four of them, and it moves them toward Next.js. A gap a single
counting decision can halve is not a gap a re-implementation could not close, which is exactly the
test § What counts as winning applies.

**Where the comparison is not apples to apples.** Named rather than adjusted for, because adjusting a
count until it evens out is the failure the protocol was written to prevent:

- **The deletion.** TheoKit's 3 files include deleting `agents/tools/weather.ts`, which exists only
  because its scaffold ships a tool. Next.js has nothing to delete. Excluding the deletion makes it
  2 against 2 - which is arguably the truer comparison of authoring cost, and is still not a win.
- **One file or two.** The TheoKit tool must be its own file under a folder convention; the AI SDK
  tool sits inline in the route handler. That costs TheoKit a file and buys it somewhere obvious to
  put the second one. The count reflects the design on both sides rather than a defect on either.
- **The client edit has no TheoKit counterpart.** TheoKit's published count touches no client file at
  all: its scaffolded surface renders tool events through the shared presenter, so a new tool shows
  up without the developer writing anything. The AI SDK's typed `tool-${toolName}` parts give the
  client a typed view of the specific call, which is a real capability, and the official pattern is
  a branch per tool. Two designs, and the two lines are what the second one costs here.
- **`stopWhen` is a tax with no TheoKit counterpart.** The AI SDK stops after one step by default;
  the TheoKit agent loop does not need to be told to continue. It costs one glue line and, by
  judgement 3, two of the six concepts.
- **Neither side was run.** Metrics 1-3 come from the diffs, which is what the counting rule
  specifies, and no claim here depends on a model having answered.

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache, on
both sides. That spends real credits, and the figure is only meaningful measured identically on each
side - so it is recorded as not measured rather than estimated. Nothing in the tie above depends on
it: the rule requires TheoKit to be *better on the three countable metrics and not worse on time to
green*, and it already fails the first half.

**Neither implementation was executed.** The Next.js app builds, typechecks, and its tool's input
type is inferred from the schema; it was never pointed at a model, because no gateway key was
available in this environment. The four acceptance criteria therefore remain graded as a design, not
as a run. This is stated because the criteria have oracles and the oracles were not run - not because
metrics 1-3 needed them.

**Neither application is committed.** `../dx-benchmark.md` § Evidence asks for both implementations
under `docs/program/evidence/jN-<journey>/`; that directory does not exist and this measurement did
not create it. The diffs and the counts are published here instead, which satisfies the checkability
the clause exists for and does not satisfy the clause. Recorded as an open gap rather than resolved
by editing the protocol to match what was done.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines above
need `@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet. Note that this is a dimension the
Next.js side does not have at all, and the comparison above silently gives it away: a route handler
serves one target, and J1 was counted against TheoKit's Web path only.

**So: J1 is measured on three metrics, on both sides, and it is a tie.** It is not won. Reporting it
as won would be the failure the winning rule names, and the first real contrast this programme has
produced says the framework's advantage on this journey is smaller than a single counting decision.

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

## Metric 4 — measured 2026-08-21

Three runs per lane, alternating lane by lane, on the two committed trees this journey's counts came
from:

| | Next.js | TheoKit |
| --- | --- | --- |
| install | 4.53 ± 0.25 | 4.83 ± 0.70 |
| build | 9.40 ± 1.56 | **5.10 ± 0.53** |
| start | 0.57 ± 0.06 | 1.03 ± 0.06 |
| **total, mean ± 1σ** | **14.47 ± 1.76** → [12.71, 16.23] | **10.97 ± 1.10** → [9.87, 12.06] |

**The intervals do not overlap and TheoKit is the faster side, so the "not worse" clause holds.**
Install is level within noise — 4.83 s against 4.53 s — on the simplest pair of the ten, where
neither side installs anything the other does not.

Warm npm cache, and no measurement in this programme has ever timed a cold one. The Next.js lane's
first run is its slowest build by 2.6 s and is kept rather than discarded, because the lanes
alternate and dropping the least-warm run on one column only is how a protocol acquires a handicap.
Both notes are in [the evidence file](../evidence/j01-metric4-2026-08-21.txt).

**The verdict does not move, and metric 4 could not have moved it.** J1 is a tie in which TheoKit
touches *more* files than the Next.js side — 3 against 2 — and § What counts as winning asks for
better on all three countable metrics before time-to-green is reached. A journey already behind on a
countable metric is not rescued by the fourth one.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey that adds a second, dependent call: `j05-multi-step.md`
- The journey that gates a call on a human: `j02-hitl.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
