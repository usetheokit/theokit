# J5 — Multi-step

The fifth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J5 in the first batch to be
implemented and measured.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J5 | **Multi-step** | The agent chains two tool calls where the second depends on the first |

The word doing the work is **depends**. Two calls that happen to occur in sequence prove nothing;
the second call's *input* must carry a value that only the first call's *output* could have
supplied, and the criteria below are built so that a coincidence cannot satisfy them.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] the transcript contains two tool-call events, in order, and the second call's recorded input
      contains a value that the first call's recorded output contained — where that value is
      randomized by the test before the run, so it cannot have come from the prompt, the system
      instructions, or the model's training
- [ ] the second tool's body observes the dependency at execution time, not only in the transcript:
      the tool records the input it actually received, and the recorded value matches the first
      call's randomized output
- [ ] the final answer contains a value produced by the **second** call, so the chain is used rather
      than merely performed — asserted against a second randomized token that only the second tool
      returns
- [ ] a declared step ceiling is honoured: with the ceiling set to one, the run stops after the first
      tool call and reports a step-limit outcome the caller can read, rather than silently completing
      or silently continuing
- [ ] the ceiling declared by the application is the one the served run uses, verified by observing
      the stop at the declared number rather than at a framework default — this criterion exists
      because § Current state records that it does not hold today
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same two-call chain over the in-process path, with the criterion-1 randomized-value
      oracle applied unchanged
- [ ] TUI: the same chain rendered through the shared terminal presenter, with both tool-call events
      visible in that rendering

**What resisted an oracle.** "The agent decided to chain" is not observable — a model may chain for
reasons the transcript cannot expose, and a prompt engineered hard enough turns any single-step
system into an apparent chainer. The criteria therefore grade **data flow**, which is mechanical,
and say nothing about reasoning. That is a real narrowing and it is deliberate: the alternative is a
criterion whose result depends on prompt wording, which would make the benchmark measure the prompt.

## The Next.js side

**A direct equivalent exists, and on this journey it is likely the shortest code on either side.**
The AI SDK treats multi-step as a first-class option: a single generate/stream call takes a stopping
condition, and the loop that feeds tool results back to the model is the SDK's, not the developer's.

The reference implementation: the same Route Handler as J1, with a stop condition set to allow more
than one step, and a second tool whose schema takes a field the first tool returns. Where an official
example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current spelling of the step ceiling — the option was a plain
maximum-steps number in one major version and a composable stopping condition in the next — and
whether the default permits more than one step without configuration. That default matters for this
journey's fifth-metric transcript and must be read, not remembered.

The comparison is fair because both sides delegate the loop to a runtime and both sides express the
ceiling as configuration. The measurable difference is how many places the developer has to touch to
make the declaration take effect — which, on our side, is currently more than zero more than it
should be.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the second tool's file, the agent declaration that registers it and
declares the ceiling, and anything else the ceiling required touching. Not counted: J1's first tool,
reused unchanged — and if it had to change to be chainable, that change is counted and the reason is
recorded.

**Glue lines.** The second tool's body is business logic. The schema field that carries the
dependency is glue, on both sides. The ceiling declaration is glue. Any code the developer writes to
feed a tool result back to the model is glue — and if a side needs none because its runtime does it,
that is the finding, recorded as a zero rather than as an absence.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. The ceiling's
name counts as a concept on both sides. On ours, so does whichever loop surface the developer ends
up on — the repository currently ships two, and § Current state explains why that matters for the
count.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass. Cold cache, at least three runs, mean and standard deviation. Runs where the model
declines to chain are retried and the retries are reported: a flaky journey is a finding about the
journey, and hiding retries would turn it into a finding about the framework.

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side, and three of five criteria.** Criteria 1 to 3 - the chain itself -
were implemented and counted. Criteria 4 and 5 - the declared step ceiling - have no implementable
path, so they contribute no number and the reason is stated below rather than averaged away. Metric
4 is unmeasured; the Next.js half is measured in the section that follows, and the two are put side
by side in the section after that.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim and committed
as an untouched baseline, J1's implementation was applied on top as a second uncounted commit - per
§ How the four metrics are counted here, J1's first tool is reused unchanged and does not count here
- and J5 was implemented over that. The counts are `git diff --numstat` over the third commit.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **2** | `agents/tools/shipment-eta.ts` added, `agents/chat.ts` edited to register it |
| Glue lines | **8** | of 15 added lines; 5 are business logic and 2 are blank |
| Concepts required | **5**, none of them new | `tool`, the builder's ordering rule, `z.object`, the agent builder's `.tool()`, and the `agents/<name>/tools/` folder convention |
| Time to first green run | **not measured** | needs a live model call; see below |

**Zero lines feed a tool result back to the model, and the counting rule asked for that zero
explicitly.** § How the four metrics are counted here says that a side whose runtime closes the loop
records a zero rather than an absence. Ours does: the per-turn loop is the SDK's
(`packages/agents/src/bridge/sdk-adapter.ts:357`), so the second call's dependency on the first
costs the developer a schema field and nothing else. The concepts count says the same thing from the
other direction - all five are the five J1 already required, so a developer who has done J1 learns
nothing new to chain a second call.

**The 15 added lines, classified.** Published because the glue split is the metric most open to
being argued after the fact, and a table nobody can check is not evidence.

Glue (8): the two imports in the tool file, `tool('shipment_eta')`, `.describe(...)`, `.input(...)`,
`.build()`, the import in `chat.ts`, and `.tool(shipmentEtaTool)`.

Business logic (5): the `ETA_DAYS` table and the `.execute` body - the data the second answer comes
from and the code that produces it.

**Four judgement calls, stated rather than buried.**

1. **J1's diff was applied as the baseline, and it is not counted.** § How the four metrics are
   counted here says J1's tool is reused unchanged, which only has meaning if it is present. It was
   reconstructed from J1's own published classification, and the reconstruction reproduces J1's
   published numbers exactly - 3 files, 15 added lines, 8 glue, 5 business logic - which is the check
   that it is faithful rather than convenient. Measuring J5 from the bare scaffold instead would add
   3 files and 15 lines already counted once, in another journey.
2. **`.input(...)` is glue.** The rule fixed this in advance: the schema field that carries the
   dependency is glue on both sides. Counting the expression of the dependency as business logic -
   arguable, since it is what makes the chain a chain - gives 7 glue and 6 logic.
3. **`const ETA_DAYS: Record<string, number>` is business logic despite its type annotation**, which
   the general rule lists as glue. Counted the same way J1 counted its own lookup table, for the same
   reason: the line's substance is the data, not the annotation. Counting it as glue gives 9 and 4.
   The call matters less than the fact that it is now the second journey to make it identically, and
   the Next.js side owes the same treatment.
4. **Concepts are what the diff uses, not what is new since J1.** Counting only the newly required
   ones gives 0, which is true and useless as a total; the 5 is the cost of reading this diff cold.

**Criteria 4 and 5 cost nothing to write because nothing can be written.** This is not a small
number, and it must not be reported as one. The fluent builder that the scaffold uses
(`packages/create-theokit/templates/default/agents/chat.ts:21`) has no step-ceiling method anywhere
in its surface (`packages/agents/src/bridge/agent-builder.ts:125` opens the interface,
`packages/agents/src/bridge/agent-builder.ts:291` closes it with `build`), so there is no declaration
for an application to make. The ceiling that does exist on the compiled agent
(`packages/agents/src/bridge/agent-compiler.ts:287`) is never read by the adapter that serves the
run, which builds its send options from scratch and sets only a tool choice and an event callback
(`packages/agents/src/bridge/sdk-adapter.ts:525`). So the criteria fail at zero developer cost, and
the honest entry for them is "no path", never "0 lines".

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache.
That spends real credits, and the number is only meaningful measured identically on both sides - so
running one side alone would produce a figure with nothing to compare it to. This journey's own rule
also requires reporting the retries when the model declines to chain, and a retry count cannot exist
without runs.

**Criteria 1 to 3 were implemented, not observed.** The diff registers a second tool whose input is
the first tool's output; whether a model actually chains them, and whether the randomized value
survives into the second call's recorded input, needs a run. § What resisted an oracle already
narrowed these criteria to data flow for exactly this reason, and data flow still has to be watched
flowing.

**Criteria 4 and 5 are graded from source, not from a run.** The reading above is that the declared
ceiling never reaches the served run; the run that would show it stopping at the framework default
instead of the declared number was not performed, and the SDK's default is itself unread.

**The Next.js side did not exist when this half was written.** It does now - measured the same day,
in § Measured - Next.js side, metrics 1-3 - so the comparison this paragraph deferred is in
§ The two sides compared rather than outstanding. What the paragraph got right is that a 2-file,
8-glue-line count settles nothing on its own; what it expected, that the other stack would write the
least code here, is not what the diff showed.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet.

**So: this half is measured and not run.** Three of its five criteria have a measured cost; the other
two have no path at all, which is a finding about the framework rather than a number about the
benchmark. Whether the journey is won is settled against the other side, below.

## Measured - Next.js side, metrics 1-3 (2026-08-20)

**The other half, measured the same day by the same rule**, on the same throwaway app the J1
Next.js measurement used - so the J5 delta sits on a committed J1 state rather than on a
reconstruction, which is the mirror of what the TheoKit side did with its own J1 commit. The app
builds and typechecks; it was never run against a model, and § What is still unmeasured says so.

### The version-specific facts, confirmed against the source

§ The Next.js side above deferred two questions to implementation time, both about the step ceiling.
Both were read - from the installed package's own type declarations and from the quickstart the docs
site publishes - rather than remembered.

| Deferred question | Answer | Read from | Diverged from the supposition? |
| --- | --- | --- | --- |
| The current spelling of the step ceiling - a plain maximum-steps number, or a composable stopping condition | A composable stopping condition. `stopWhen` takes a `StopCondition`, and `isStepCount(n)` is the built-in that expresses a count. The same function is also exported under the alias `stepCountIs`, so both spellings compile against `ai@7.0.70` | the installed `ai` package's declaration of `isStepCount`, and its export list, which re-exports it as `stepCountIs` | **No.** The section predicted the two shapes and named the later one correctly; what it did not predict is that the older-sounding alias still resolves |
| Whether the default permits more than one step without configuration | **It does not.** `stopWhen` defaults to `isStepCount(1)` on both `generateText` and `streamText`, so a tool call ends the generation and the result never reaches the answer. The `Agent` class defaults to `isStepCount(20)` instead - a different default on a different surface | the `@default` annotations on the `stopWhen` field of each options type in the installed package | **No**, and it matters more than the spelling: the quickstart opens its multi-step section with the symptom, "the model isn't using this information to answer your original query", which is this journey's criterion 3 failing |

**The official example for this journey exists and is the one used.** The AI SDK Next.js App Router
quickstart - the same document J1 cited - carries a section titled *Enabling Multi-Step Tool Calls*
and, immediately after it, *Add another tool*, whose whole point is a second tool that consumes the
first tool's output: the weather tool returns a Fahrenheit temperature, and
`convertFahrenheitToCelsius` takes `temperature` as its input. That is J5, written by the vendor of
the other side, and § Why the protocol comes before the measurement requires it be used rather than
improved on. The implementation below is that section with the two tools renamed to the ones this
journey's criteria randomize.

Versions under test are J1's, unchanged: `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`,
`zod@4.4.3`, Node 22.

### The baseline, declared

The same three-commit ladder as the TheoKit side, and for the same reason - a journey measured from
a bare scaffold re-counts work another journey already counted:

1. `create-next-app` (TypeScript, App Router, Tailwind) plus `npm install ai @ai-sdk/react zod`,
   untouched.
2. The quickstart's pre-tools chat stage - `app/api/chat/route.ts` and `app/page.tsx` pasted
   verbatim - reformatted with the `create-theokit` Prettier config
   (`packages/create-theokit/templates/default/.prettierrc`, `printWidth: 100`, `semi: false`) so
   both sides are counted with one ruler. This is J1's declared baseline and its argument for
   choosing it is not re-litigated here.
3. J1's own diff: the `orderLookup` tool, `stopWhen: isStepCount(5)`, and the client's
   `case 'tool-orderLookup':` branch. **Uncounted**, exactly as the TheoKit side leaves its J1
   commit uncounted.

J5 is the delta from commit 3. That placement decides one number and is declared as judgement 6
below: `stopWhen: isStepCount(5)` was written in J1, was counted in J1, and does not change here, so
it is not charged again.

### Metrics 1-3

| Metric | Next.js + AI SDK | How it was counted |
| --- | --- | --- |
| Files touched | **2** | `app/api/chat/route.ts` edited, `app/page.tsx` edited. Nothing added, nothing deleted - the second tool lives inline in the route file beside the first, which is where the official example puts it |
| Glue lines | **8** | of 14 added lines; 5 are business logic and 1 is blank |
| Concepts required | **6** | `tool`, `z.object`, the `tools` map on `streamText`, the `tool-${toolName}` part-type convention, plus `stopWhen` and `isStepCount` - the last two charged by this journey's own rule, see judgement 2 |
| Time to first green run | **not measured** | needs a live model call, on both sides; see below |

**Zero lines feed a tool result back to the model here too, and the zero is not free.** § How the
four metrics are counted here asks for that zero explicitly, and the AI SDK earns it the same way
ours does: the loop that sends the first tool's result back for the second call is the SDK's. The
difference is that the AI SDK charges one line of configuration for permission to run that loop at
all, and J1 already paid it.

### The diff, published

`git diff` between the J1 commit and the J5 commit, verbatim.

```diff
diff --git a/app/api/chat/route.ts b/app/api/chat/route.ts
@@ -14,6 +14,11 @@ const SHIPPING_REFERENCES: Record<string, string> = {
   'A-1002': 'SHIP-9Q4M-8871',
 }

+const ETA_DAYS: Record<string, number> = {
+  'SHIP-7F3K-2210': 2,
+  'SHIP-9Q4M-8871': 5,
+}
+
 export async function POST(req: Request) {
   const { messages }: { messages: UIMessage[] } = await req.json()

@@ -29,6 +34,14 @@ export async function POST(req: Request) {
         }),
         execute: async ({ orderId }) => SHIPPING_REFERENCES[orderId] ?? `No order ${orderId}.`,
       }),
+      shipmentEta: tool({
+        description:
+          'Get the delivery ETA in days for a shipping reference returned by orderLookup.',
+        inputSchema: z.object({
+          shipmentRef: z.string().describe('A shipping reference, e.g. "SHIP-7F3K-2210"'),
+        }),
+        execute: async ({ shipmentRef }) => ETA_DAYS[shipmentRef] ?? `No ETA for ${shipmentRef}.`,
+      }),
     },
   })

diff --git a/app/page.tsx b/app/page.tsx
@@ -16,6 +16,7 @@ export default function Chat() {
               case 'text':
                 return <div key={`${message.id}-${i}`}>{part.text}</div>
               case 'tool-orderLookup':
+              case 'tool-shipmentEta':
                 return <pre key={`${message.id}-${i}`}>{JSON.stringify(part, null, 2)}</pre>
             }
           })}
```

**The 14 added lines, classified.**

Glue (8): in `route.ts`, `shipmentEta: tool({`, the two lines the `description` occupies,
`inputSchema: z.object({`, the `shipmentRef` field line, and the two closing lines that finish the
schema and the tool literal; in `page.tsx`, the `case 'tool-shipmentEta':` label, which falls
through to the branch J1 already wrote.

Business logic (5): the `ETA_DAYS` table and the `execute` body - deliberately the same five lines
of substance as the TheoKit side, mapping the same shipping references to the same day counts, so
that what the two counts differ by is ceremony and nothing else.

Blank (1).

**The dependency is typed, and the typing was checked rather than assumed.** `execute` receives
`{ shipmentRef: string }` inferred from the Zod `inputSchema`; annotating that parameter as
`{ shipmentRef: number }` is a compile error (`TS2769`, the overload rejects the schema/handler
pair), and `next build` runs the typecheck. So the field that carries the chain - the one criterion 1
randomizes a value through - is a declared contract on this side, as it is on ours.

### Counting judgements, stated rather than buried

Six. Three of them change which side leads a metric. None of them produces a TheoKit win, which is
the fact this table exists to make checkable rather than assertable.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | The `description` occupies two lines on the Next.js side and one on ours, because the tool literal is nested four levels inside `streamText` while the TheoKit tool file is top-level, and Prettier wraps at 100 columns | **Counted as two glue lines** - what the diff contains, under the shared ruler both baselines were formatted with | Next.js glue 8 to **7**, and Next.js *leads* glue lines 7 to 8. This is the judgement most favourable to TheoKit in the whole count, and it is an artefact of indentation depth rather than of authoring effort |
| 2 | `stopWhen` and `isStepCount` are charged to the Next.js concept count although neither appears in the J5 diff - both were written in J1 | **Charged.** § How the four metrics are counted here says, in advance, that *the ceiling's name counts as a concept on both sides*. The clause presumes both sides have a ceiling to name; only one does, and the clause is applied to the side that does | Counting only what the J5 diff textually uses gives Next.js **4**, which *leads* concepts 4 to 5 - flipping the only metric TheoKit currently leads, and by 1.25x rather than 1.2x |
| 3 | Is `const ETA_DAYS: Record<string, number>` glue or logic? | **Logic** - J1's judgement 2, applied for the third time across two journeys and now on both sides of this one | Both sides move together: Next.js 9/4, TheoKit 9/4. No effect on the comparison |
| 4 | Does the client edit belong to J5? Criterion 1's oracle reads the transcript, not the rendered surface, so `case 'tool-shipmentEta':` is not what makes the criteria pass | **Counted anyway**, for J1's reason: the official example includes it, and the protocol requires the official example be used | Next.js files 2 to **1**, and Next.js *leads* files touched by exactly 2x - the bar § What counts as winning sets, reached from the wrong side |
| 5 | Criteria 4 and 5 are reported on the TheoKit side as *no path*, not as a large number | **Kept as no path**, per the TheoKit section's own reasoning: a cost nobody can pay is not a cost | See § The ceiling, and the path that is not a number - the alternative is not a bigger number, it is an unbounded one |
| 6 | Is `stopWhen: isStepCount(5)` a J5 glue line? It is what makes the chain legal, and this journey is the chain | **No** - it was written and counted in J1, and this journey's rule excludes J1 work reused unchanged. The same rule excludes TheoKit's `orderLookupTool` | Next.js glue 8 to **9**, and TheoKit leads glue lines 8 to 9 by 1.125x - still inside the bar, still a tie |

## The ceiling, and the path that is not a number

Criteria 4 and 5 are two of this journey's five, and they are the reason § Current state predicted
this measurement would be interesting. They are also where the two sides stop being comparable, so
the asymmetry is named here rather than folded into a metric.

**On the Next.js side the ceiling is the same option that enables the chain.** `stopWhen` is a
first-class argument to `streamText`; setting it to `isStepCount(1)` is criterion 4's configuration,
and the default already *is* `isStepCount(1)`, read from the installed package. Criterion 5 - that
the ceiling the application declares is the one the served run uses - is satisfied because there is
exactly one place the value is read. The marginal cost for J5 is zero because J1 paid it, and the
absolute cost is one line.

**On the TheoKit side there is no declaration to make on the path the scaffold generates.** The
fluent `AgentBuilder` interface (`packages/agents/src/bridge/agent-builder.ts:125` through its
closing `build` at `:291`) carries no ceiling method, and the scaffold writes that builder
(`packages/create-theokit/templates/default/agents/chat.ts:21`). The TheoKit section above already
recorded this. What this measurement adds is the answer to the question
[#363](https://github.com/usetheokit/theokit/issues/363) left open, because the benchmark needed it:

**the ceiling does not reach a served run from either authoring path.** The decorator path does
declare it (`packages/agents/src/capability/agent-capabilities.ts:238`) and the compiled agent does
carry it (`packages/agents/src/bridge/agent-compiler.ts:287`). But an HTTP run reaches
`streamAgentUIMessages` (`packages/agents/src/bridge/agent-endpoint.ts:219`), which assembles its
runtime overrides field by field (`:225` onward) and calls `createSdkAgentStream` directly (`:239`);
the adapter then builds the SDK's create-options from scratch
(`packages/agents/src/bridge/sdk-adapter.ts:512`) and its extras helper
(`packages/agents/src/bridge/sdk-adapter.ts:143`) never mentions `maxIterations`. The enforcement
lives in the reflective loop (`packages/agents/src/loop/run-reflective-loop.ts:537`, with the
`step_limit` reason at `packages/agents/src/loop/loop-strategy.ts:23`), and `runReflectiveLoop` has
**zero references anywhere in `packages/theo/src`**. So the served path never touches the code that
enforces a ceiling, and the effective limit on `POST /api/agents/<name>` is whatever the underlying
SDK does by default - which was not read here, and does not need to be: criterion 5 grades that the
*declared* number is the observed one, and nothing declared reaches the run.

**A path that honours a ceiling does exist, and using it means leaving the framework's own mount.**
`AgentRunner` is public (`packages/agents/src/loop/index.ts:10`, re-exported from the package root
at `packages/agents/src/index.ts:21`), it drives the reflective loop, and it takes a per-run ceiling
(`packages/agents/src/loop/agent-runner.ts:127`, applied at `:271`). But it yields a stream of
events, not an HTTP response, and `streamAgentUIMessages` offers no seam to inject it - it
constructs its own source. An application that wants criteria 4 and 5 must therefore write the
transport that `mountAgent` (`packages/theo/src/server/agent/mount-agent.ts:167`, 279 lines) and
`streamAgentUIMessages` (300 lines) already provide: the wire format, the HITL pause, the session
plumbing.

That is why judgement 5 refuses to turn this into a glue-line number. A number implies a developer
could pay it and get the journey; what they would get is a second serving path to maintain, and the
framework's own one unused. **The honest entry is that the framework can cap a loop and cannot cap a
served one**, and that is a finding about the framework rather than a figure about the benchmark.

## The two sides compared

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | 2 | 2 | neither | 1.0x | **Tie** - an exact tie, not a narrow one |
| Glue lines | 8 | 8 | neither | 1.0x | **Tie** - an exact tie, and judgement 1 moves it to Next.js |
| Concepts required | **5** | 6 | TheoKit | 1.2x | **Tie** - inside the 2x bar, and judgement 2 moves it to Next.js |
| Time to first green run | not measured | not measured | - | - | not applicable |
| Criteria satisfied | **3 of 5** | 5 of 5 | Next.js | - | not a countable metric, and the most important line in the table |

**J5 is a tie on cost that TheoKit cannot cash.** The three countable metrics come out at 1.0x,
1.0x and 1.2x - inside the noise bar on every one, so the winning rule's first condition fails
before its 2x threshold is even reached. And unlike J1, where both sides satisfied every criterion
at different prices, here the prices are the same and only one side satisfies the journey.

The prediction in § The Next.js side was that this would be *the shortest code on either side* for
Next.js. It was wrong about the code and right about the reason: the AI SDK's chain costs the same
eight glue lines ours does, because both runtimes close the loop for the developer. Where the two
sides actually diverge is not the chain at all - it is the containment around it, which the
countable metrics were never going to see.

**Where the comparison is not apples to apples.** Named rather than adjusted for:

- **The ceiling is a metric on one side and an absence on the other.** Next.js spends one line
  (in J1) and two concepts; TheoKit spends nothing and gets nothing. A reader who takes the concepts
  row at face value reads TheoKit as 1.2x leaner, when one of the two concepts it saves is the one
  that would have made criteria 4 and 5 pass.
- **One file or two, again.** The TheoKit tool must be its own file under a folder convention; the
  AI SDK tool sits inline beside the first. On J1 that cost TheoKit a file; on J5 it costs nothing,
  because both sides touch two files - ours a new tool file plus the agent, theirs the route plus
  the client.
- **The client edit still has no TheoKit counterpart.** Ours renders a new tool through the shared
  presenter with no client change; theirs adds a case label per tool. One line here, two in J1, and
  the same two designs behind both numbers.
- **Neither side was run.** Metrics 1-3 come from the diffs, which is what the counting rule
  specifies. Criterion 1's randomized-value oracle has still never been watched flowing on either
  side.

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache, on
both sides. That spends real credits, and the figure is only meaningful measured identically on each
side. This journey additionally requires reporting the retries when the model declines to chain -
and a retry count cannot exist without runs. Nothing in the result above depends on it: the winning
rule needs TheoKit better on all three countable metrics, and it is better on none of them by a
margin outside noise.

**Neither implementation was executed.** The Next.js app builds, typechecks, and its second tool's
input type is inferred from the schema; it was never pointed at a model, because no gateway key was
available in this environment. Criteria 1 to 3 therefore remain graded as a design on both sides,
and criteria 4 and 5 are graded from source rather than from a stopped run.

**Neither application is committed.** § Evidence asks for both implementations under
`docs/program/evidence/jN-<journey>/`; that directory does not exist and this measurement did not
create it. The diffs and the counts are published here instead, which satisfies the checkability the
clause exists for and does not satisfy the clause - recorded as an open gap, identically to J1, and
now twice rather than once.

**The three-target criteria cannot be exercised in this repository**, for the reason the TheoKit
section already gave. Note again what the comparison silently gives away: a route handler serves one
target, and J5 was counted against TheoKit's Web path only.

**So: J5 is a tie on the three countable metrics, and it is not won.** It is a worse result than J1,
which was also a tie - because there the framework merely cost more than expected, and here it costs
the same and does two-fifths less.

## Re-measured — TheoKit side, after the ceiling shipped (2026-08-20)

**The same journey, the same criteria, a different TheoKit.** The measurement above reported the
second tie and named its cause: two of the five criteria failed because no authoring path could cap
a served run. Hours later that capability shipped — `3762c7d0f`, closing
[#363](https://github.com/usetheokit/theokit/issues/363) — and this section re-runs the TheoKit half
against it.

Everything above is left exactly as it was written. It records what was true when it was written,
and the sequence — measured, found lacking, fixed, re-measured, on one day — is the most useful
thing this file carries. **The criteria did not move**
(`../dx-benchmark.md` § Why the protocol comes before the measurement): the target is the same, the
framework is not.

**The Next.js side is not re-measured and not re-argued.** Nothing on it changed, its numbers are
reused verbatim from § Measured - Next.js side, metrics 1-3, and re-deriving a published count to
fit a new comparison is precisely what publishing the diffs was meant to make impossible.

### What changed in the framework

| | Before `3762c7d0f` | After |
| --- | --- | --- |
| The fluent builder the scaffold writes (`packages/create-theokit/templates/default/agents/chat.ts:21`) | no ceiling method anywhere in its surface | `.maxIterations(n)` (`packages/agents/src/bridge/agent-builder.ts:158`) |
| The functional surface | no field | `defineAgent({ maxIterations })` (`packages/agents/src/bridge/define-agent.ts:56`) |
| The decorator path (`@Agent`, `@MainLoop`) | declared a ceiling nothing read | the same declaration, now read |
| `CompiledAgentOptions.maxIterations` (`packages/agents/src/bridge/agent-compiler.ts:287`) | written by every path, read by none on the served path | lowered onto the SDK send (`packages/agents/src/bridge/sdk-adapter.ts:207`, applied at `:563`) |
| The handle `toAgentFactory` gives ACP | sent uncapped | carries the ceiling as a default a caller may still override (`packages/agents/src/bridge/sdk-adapter.ts:778`, wired at `:730`) |
| An invalid value | rejected by the SDK at the first send, naming a surface the author never wrote | rejected where it was written (`packages/agents/src/bridge/define-agent.ts:183`) |

**The seam chosen, and the one refused.** The ceiling lowers to `SendOptions.maxIterations` — the
SDK's documented per-send cap on tool-calling turns, validated at the SDK's own boundary, ending the
run with `stoppedAtIterationLimit`. It is *not* built on `Agent.create({ budgetTracker })`, which
looks like the seam: the published `.d.ts` describes that option as wired to the type surface only,
and a tracker is state living on an agent that `Agent.getOrCreate` returns from cache, so its count
would accumulate across a session's turns rather than cap each one — and its limit marks the run
`error`, which a ceiling that is *reached* is not. The reasoning is recorded at
`packages/agents/src/bridge/sdk-adapter.ts:183` rather than in a commit message alone.

**What the 14 tests in `packages/agents/tests/integration/step-ceiling.test.ts` prove, and what they
do not.** They assert the declared number crossing the adapter's boundary into the SDK's `send`,
from every authoring path and on both served paths — the builder chain the scaffold writes
(`packages/agents/tests/integration/step-ceiling.test.ts:119`), the served entry point `mountAgent`
calls (`:146`), the ACP handle (`:162`), a caller's own value winning for one turn (`:172`) — plus
the two negative shapes that keep the change from being a default in disguise: an agent that
declares nothing sends no key at all (`:189`), and the value is never smuggled into the agent-create
options (`:211`). Seven of them fail against the pre-fix adapter.

They do not prove the SDK stops. The suite drives a fake that captures the send, so what is
established is that *the declared value arrives*; whether the run halts at it, and whether
`maxIterations: 1` is counted before or after the first tool call, lives outside these two packages
and was not read here. That distinction is load-bearing below.

### The diff, re-classified

The measured diff is the one § Measured - TheoKit side classified, **plus exactly one line**. The
throwaway app was not rebuilt for this re-run — the delta from the measured state is a single
builder call, and inventing a fresh `git diff --numstat` around it would add ceremony, not evidence.
The added line, verbatim, in `agents/chat.ts`:

```diff
   .tool(orderLookupTool)
   .tool(shipmentEtaTool)
   .tool(currentTimeTool)
   .tool(sendNotificationTool)
+  .maxIterations(5)
```

**The 16 added lines, classified.** The first fifteen are the earlier section's, unchanged and
listed again so this table stands on its own rather than by reference.

| Class | Count | The lines |
| --- | --- | --- |
| Glue | **9** | in `agents/tools/shipment-eta.ts`: the two imports, `tool('shipment_eta')`, `.describe(...)`, `.input(...)`, `.build()`; in `agents/chat.ts`: the tool import, `.tool(shipmentEtaTool)`, and **`.maxIterations(5)`** |
| Business logic | 5 | the `ETA_DAYS` table (4) and the `.execute` body (1) |
| Blank | 2 | |

The new line is glue by the rule this journey fixed in advance: *the ceiling declaration is glue*
(§ How the four metrics are counted here). It was written before either side existed, and it now
charges the side that finally has something to declare.

### Metrics 1-3, re-counted

| Metric | TheoKit (re-measured) | How it was counted |
| --- | --- | --- |
| Files touched | **2** | unchanged — `agents/tools/shipment-eta.ts` added, `agents/chat.ts` edited. The ceiling lands in a file the diff already touches, which is the one thing about it that costs nothing |
| Glue lines | **9** | of 16 added lines; 5 are business logic and 2 are blank |
| Concepts required | **6** | the five J1 already required — `tool`, the builder's ordering rule, `z.object`, `.tool()`, the `agents/<name>/tools/` folder convention — plus `.maxIterations()` |
| Time to first green run | **not measured** | needs a live model call, on both sides; unchanged and stated below |

**The sixth concept is a method on an object the diff already imports.** `AgentBuilder` is in scope
from J1, so `.maxIterations()` adds a name to learn and no import to write. That is a real
difference from the other side, where the ceiling is two names (`stopWhen` and `isStepCount`) both
imported from `ai` — and it is a difference the concepts count cannot show, because the two sides now
land on the same total for opposite reasons.

### Before and after, on one table

| Metric | First measurement | Re-measurement | Next.js (unchanged) | Moved |
| --- | --- | --- | --- | --- |
| Files touched | 2 | **2** | 2 | no |
| Glue lines | 8 | **9** | 8 | **yes** — an exact tie becomes a one-line Next.js lead |
| Concepts required | 5 | **6** | 6 | **yes** — TheoKit's only lead becomes an exact tie |
| Criteria satisfied | 3 of 5 | **4 of 5** | 5 of 5 | **yes** — and this is what the two rows above were bought with |

**Gaining the capability cost the only metric TheoKit led.** The first measurement recorded concepts
5 against 6 and called it a 1.2x lead inside the noise bar; it read that way partly *because the
framework had no ceiling to name*. Naming one costs a concept and a line, and the lead is gone. The
trade is worth stating without softening: the framework spent its single leading metric to stop
failing two of five criteria. It was the right trade and it is a worse-looking table, and a
benchmark that reported only the first half of that sentence would be the instrument this program
exists to prevent.

### The five criteria, re-graded

| # | Criterion | First measurement | Now |
| --- | --- | --- | --- |
| 1 | two tool calls, the second's input carrying the first's randomized output | implemented, not observed | **unchanged** — nothing in `3762c7d0f` touches the chain |
| 2 | the second tool's body observes the dependency at execution time | implemented, not observed | **unchanged** |
| 3 | the final answer carries a value only the second call returns | implemented, not observed | **unchanged** |
| 4 | ceiling honoured: the run stops **and reports a step-limit outcome the caller can read** | **fails — no path to declare** | **still open, for a different reason** — see below |
| 5 | the ceiling the application declares is the one the served run uses | **fails — no path to declare** | **implemented, not observed**, at the same standard as 1-3 and with a stronger boundary proof |

**Criterion 5 is the one the fix closes.** The declared number reaches the served send from the
builder the scaffold writes, through `streamAgentUIMessages` — the entry point `mountAgent` calls
(`packages/agents/src/bridge/agent-endpoint.ts:219`, reaching the adapter at `:239`) — and the
assertion is made against what crosses the boundary rather than against what a helper returns. It is
still *implemented, not observed*: watching a run stop at the declared number needs a model, and
§ What is still unmeasured says why there was not one. That is the same standing criteria 1 to 3
have had since they were written, and grading criterion 5 more harshly than its neighbours would be
choosing a standard by its result.

**Criterion 4 remains open, and the reason moved from the front of the sentence to the back.** Its
first half — a declared ceiling that the run honours — is now the same claim as criterion 5. Its
second half is not, and it is what fails:

> *reports a step-limit outcome the caller can read, rather than silently completing*

The served stream always ends on a terminal frame, and that frame is a `DoneEvent`
(`packages/agents/src/bridge/agent-stream-events.ts:117`) assembled by `realUsageDone`
(`packages/agents/src/bridge/sdk-adapter-create-options.ts:117`) out of a result string, a token
tally, a duration and a cost. There is no stop reason on it, and the `wait()` shape the adapter
types locally has no status field to read one from (`packages/agents/src/bridge/sdk-adapter.ts:230`).
`stoppedAtIterationLimit` occurs exactly once in this repository, in the comment that explains why
the SDK's per-send option was chosen (`packages/agents/src/bridge/sdk-adapter.ts:200`) — never in a
line of code that reads it. So a run cut at the ceiling reaches the caller as an ordinary `done`,
indistinguishable from one that finished: the *silently completing* the criterion names in the very
clause it grades.

This is the same class of defect #363 fixed, one layer out. The declaration now travels; the outcome
does not come back — filed as [#379](https://github.com/usetheokit/theokit/issues/379) with the
source reading above, so the criterion stays open against something tracked rather than against a
paragraph. And it is exactly what § The deliberately broken state predicted the framework
would be graded on — the invented-answer case there is graded fail *because the framework had the
information that the run was truncated and did not surface it*, which is the state measured here
from source.

**One asymmetry declared rather than acted on.** Criterion 4's second clause was graded strictly
here, against our own source. The published Next.js grading of 5 of 5 argued criterion 4 from the
ceiling being *configurable in one place* and did not address that clause; the AI SDK quickstart's
own framing of the default — the symptom is that "the model isn't using this information to answer
your original query", noticed by reading the answer — is at least suggestive that the other side may
not surface a loud step-limit outcome either. This re-measurement did **not** re-read that side and
does not claim it. The published 5 of 5 stands, the question is recorded, and the grading is
therefore strict on our side and inherited on theirs — a bias against TheoKit, stated so a later run
can correct it in whichever direction the source supports.

### The counting judgements, re-run rather than copied

Six were declared. What each does *now*, against TheoKit 2 / 9 / 6 and Next.js 2 / 8 / 6:

| # | The judgement | Still stands? | What the other way does now | What it did before |
| --- | --- | --- | --- | --- |
| 1 | the Next.js `description` occupies two lines to our one, an artefact of nesting depth under a shared 100-column ruler | yes | Next.js glue 7, so Next.js leads 9 to 7 — **1.286x, still a tie** | flipped an exact 8-8 tie into a Next.js lead |
| 2 | `stopWhen` and `isStepCount` are charged to Next.js concepts although both were written in J1 | yes | Next.js concepts 4, so Next.js leads 6 to 4 — **1.5x, still a tie** | flipped TheoKit's only lead. **There is no lead left for it to flip** |
| 3 | `const ETA_DAYS: Record<string, number>` is business logic, not type ceremony | yes | both sides move together to 10/4 and 9/4 — no effect on the comparison | identical |
| 4 | the client `case` label belongs to J5 | yes | Next.js files 1, leading **2.0x** — the winning bar, reached from the wrong side | identical, and still the only judgement that reaches the bar at all |
| 5 | criteria 4 and 5 are reported as *no path*, never as a number | **void** | superseded — there is a path, and it is priced at one glue line and one concept | was the honest entry for a capability that did not exist |
| 6 | `stopWhen: isStepCount(5)` is a J1 line, not a J5 one | yes | Next.js glue 9 — an **exact 9-9 tie**, the most symmetric reading available | gave TheoKit a 1.125x glue lead |

**Judgement 5 is void and one new judgement replaces it**, because the thing it described stopped
being true:

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 5′ | Criterion 4's *readable outcome* half has no path. Is it a number? | **No path**, on judgement 5's surviving reasoning: nothing can be written, so no line count is honest. What changed is the scope — it now covers half of one criterion instead of the whole of two | The alternative is still not a bigger number but an unbounded one: reading a stop reason means reaching past the terminal frame the framework defines |
| 7 | Is `.maxIterations(5)` a J5 line, when the Next.js counterpart was charged to J1 (judgement 6)? | **Yes, charged to J5.** The asymmetry is a real difference in defaults, not a counting convenience: the AI SDK's `streamText` defaults to one step, so J1 could not pass without the line and paid for it there; ours defaults to the SDK's own ceiling and chains fine, so J5 is the first journey that needs a *declared* number | TheoKit glue back to 8 — an exact tie — and concepts back to 5, **leading 5 to 6 at 1.2x**. This is the only reading that restores a TheoKit lead, and it buys it by declining to count the line that makes criteria 4 and 5 pass. **Still inside the 2x bar, so still a tie** — the lead it buys does not win the journey, and the capability it gives back was the point |

**No judgement, taken either way, turns this journey into a win for either side.** Judgement 4 alone
reaches the 2x threshold, for Next.js, on one metric — and § What counts as winning requires better
on all three, so even there the journey is not won. The most TheoKit-favourable reading available
(judgement 7 the other way) is a 1.2x concepts lead with two criteria handed back. That is the check
this table exists to make possible.

### The verdict, re-stated

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | 2 | 2 | neither | 1.0x | **Tie** — an exact tie |
| Glue lines | 9 | **8** | Next.js | 1.125x | **Tie** — inside the bar, and judgement 6 the other way makes it exact |
| Concepts required | 6 | 6 | neither | 1.0x | **Tie** — an exact tie, where the first measurement had TheoKit at 1.2x |
| Time to first green run | not measured | not measured | — | — | not applicable |
| Criteria satisfied | **4 of 5** | 5 of 5 | Next.js | — | not a countable metric, and still the most important line |

**J5 is still a tie, and the tie has a different shape.** The margins are 1.0x, 1.125x and 1.0x —
inside the noise bar on every one, so the winning rule's first condition fails before its 2x
threshold is reached, exactly as it did this morning. What moved is what the tie is made of: the
framework no longer fails a criterion for having nothing to declare, and it no longer leads a metric
for having nothing to name. Four of five criteria against five of five, at the same price, on a
journey that is closer than it was and is not won.

**The one thing that is unambiguously better** is not on the table: an application can now cap a
served run, from the path the scaffold generates, and the declaration reaches the code that serves
it. The benchmark measures what a journey costs to build, and a capability that changes a criterion
from *fail* to *implemented* shows up there as a line and a concept — which is the measurement being
narrow, not the change being small.

### What is still unmeasured, and why — unchanged

Everything § What is still unmeasured recorded still holds, and the fix moved none of it:

- **Metric 4 needs a live model call**, at least three times, cold cache, on both sides. No gateway
  key was available. Nothing in the result depends on it: TheoKit is better on none of the three
  countable metrics by a margin outside noise.
- **Neither implementation was executed.** Criteria 1 to 3 stay graded as a design on both sides;
  criterion 5 joins them at that standard; criterion 4 is graded from source, and its open half
  would fail a run rather than pass one.
- **The SDK's own enforcement was not read.** The integration suite proves the value crosses the
  boundary, not that the run stops at it, and whether `maxIterations: 1` cuts before or after the
  first tool call — which criterion 4's oracle depends on — lives outside these packages.
- **The two loop surfaces still both exist.** `runReflectiveLoop` has zero call sites under
  `packages/theo/src`, unchanged; the fix lowered the ceiling to the SDK rather than putting the
  reflective loop on the served path. The concepts count charges only the surface the developer
  touches, which is the builder.
- **Neither application is committed** under `docs/program/evidence/j5-multi-step/`. The gap
  § Evidence names is open here for the second time, and now for a third document.
- **The three-target criteria still cannot be exercised** in this repository: `@theokit/tui` and
  `@theokit/ui` live outside it, and this journey was counted against the Web path alone.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J5 is a
**step ceiling of one on a prompt that needs two** — the exact configuration that makes a chain
impossible.

| | |
| --- | --- |
| Names the action | `run stopped at the step limit (1) with a tool call still pending; "lookupOrder" returned but its result was never sent back to the model. Raise the step ceiling to at least 2.` — names the limit, names what was left undone, names the fix |
| Does not name the action | A finish reason the caller has to decode, an answer that confidently invents the second tool's result, or a run that ends with no signal that anything was cut short |

The invented-answer case deserves its own line, because it is the realistic one: a model cut off
mid-chain will often produce a fluent, wrong answer. That outcome is graded **fail** on this metric —
not because the model hallucinated, which is not the framework's fault, but because the framework
had the information that the run was truncated and did not surface it.

A second break is graded in the same transcript: **the second tool's schema does not accept the
first tool's output shape.** Names the action: `tool "createShipment" rejected input: expected "orderId" to be a string, received object — "lookupOrder" returns { order: { id } }.`
Does not: a schema-library error dump with a path array and no mention of either tool.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

> **Superseded the same day, and kept.** This section reads the tree as it stood before `3762c7d0f`.
> The defect it names — a declared ceiling that never reaches the served run — was fixed hours later,
> and § Re-measured - TheoKit side, after the ceiling shipped carries the current reading. The
> section stays because it is the *before* half of the only before-and-after this benchmark has, and
> deleting it would leave the re-measurement comparing against nothing.

**Nothing blocks J5 from running. Criterion 5 fails today, and the failure is a measured defect
rather than a missing feature.**

What is wired:

- The served agent's per-turn loop is delegated to the underlying SDK — a single declared runtime,
  by rule (`packages/agents/src/bridge/sdk-adapter.ts:4`), reached through
  `createSdkAgentStream` (`:357`) and the SDK's own agent and run objects (`:512`, `:537`, `:546`).
  Chaining therefore works without the developer writing a loop, which is what criteria 1 to 3 will
  measure.

**The defect, stated precisely: an application's declared step ceiling never reaches the served
run.** The compiled agent carries `maxIterations`
(`packages/agents/src/bridge/agent-compiler.ts:287`), and capabilities populate it
(`packages/agents/src/capability/agent-capabilities.ts:210`). But the adapter builds its send
options from scratch (`packages/agents/src/bridge/sdk-adapter.ts:525`) and only ever sets a tool
choice and an event callback (`:526`, `:530`) — the ceiling is never read. The effective limit for
`POST /api/agents/<name>` is therefore the SDK's own default, silently, whatever the application
declared. Criterion 5 exists to grade exactly this, and it will fail on the first run.

**A second, independent loop exists in the repository and is not on the served path.** There is a
reflective loop with an explicit strategy, a step-limit finish reason, and a validated ceiling
(`packages/agents/src/loop/loop-strategy.ts:102`, finish reason at `:23`, continue rule at `:129`),
driven by `packages/agents/src/loop/run-reflective-loop.ts:460`. Its barrel states outright that it
is internal and never imported by consumers (`packages/agents/src/loop/index.ts:5`), and it is
reachable only through delegation (`packages/agents/src/bridge/agent-orchestrator.ts:244`), which
has no caller in `packages/theo/src`.

That matters for the benchmark in a way worth stating before the run: **the framework has two
answers to "how do I cap the steps", one of which is unreachable from the journey and the other of
which is currently ignored.** The concepts count will reflect whichever one the developer lands on,
so the report must record which surface was used and why.

**Not measured:** what the SDK's default ceiling actually is, and whether it applies per send or per
agent. That lives outside the two source packages and was not read; the criteria are written so the
number does not need to be known in advance — criterion 5 grades that the *declared* value is the
one observed, whatever the default happens to be.

## Metric 4 — measured 2026-08-21

Three runs per lane, alternating lane by lane:

| | Next.js | TheoKit |
| --- | --- | --- |
| install | 4.90 ± 0.10 | 4.63 ± 0.57 |
| build | 8.93 ± 1.01 | **5.50 ± 0.26** |
| start | 0.60 ± 0.00 | 1.10 ± 0.00 |
| **total, mean ± 1σ** | **14.37 ± 1.08** → [13.29, 15.45] | **11.17 ± 0.32** → [10.85, 11.49] |

**The intervals do not overlap and TheoKit is the faster side, so the "not worse" clause holds.**
Install is level — 4.63 s against 4.90 s — which is what should be expected on two applications whose
dependency sets differ by nothing this journey added.

**The TheoKit lane does not carry J5's own delta**, and that is a gap rather than a footnote. No
surviving tree carries it: the tree the J5 work was done against no longer exists, and the closest
one stops at J1's commit. The delta is 9 glue lines in one file and adds no dependency, so install is
untouched and the build differs by nine lines against a number whose unit is seconds — but what was
timed is J1's TheoKit application against J5's Next.js application, which is the reading most
favourable to TheoKit the surviving trees permit. Warm npm cache, never cold. Both in
[the evidence file](../evidence/j05-metric4-2026-08-21.txt).

**The verdict does not move.** J5 is a tie at 1.0×, 1.125× and 1.0× — every countable margin inside
the bar, one of them against us — and § What counts as winning requires better on all three before
time-to-green is reached. Criterion 4 is still open for the reason the re-measurement gives: the step
declaration now travels, and the step-limit outcome still does not come back to the caller
(usetheokit/theokit#379).

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey whose tool this chain reuses: `j01-tool.md`
- The journey that gates one of these calls on a human: `j02-hitl.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
