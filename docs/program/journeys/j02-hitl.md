# J2 — HITL

The second of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** measured on 2026-08-20, and **lost** — see the dated section below. The hold
`../dx-benchmark.md` § Sequencing placed on this journey was released the same day: ADR 0001's core
guarantee shipped, § Current state and blockers re-measured what that left, and the measurement then
ran with criterion 4's failure recorded rather than waited out. It is recorded against the private
advisory, not in a public issue.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J2 | **HITL** | A tool call pauses for human approval; approving resumes it, rejecting does not run it |

Three obligations, and the third is the one that is easy to fake: **rejecting does not run it**. A
system that runs the tool and discards the result satisfies the first two and fails the journey, so
the criteria below grade the tool's side effect rather than the response body.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] a run that reaches a gated tool emits an approval-request event carrying an id, and the run
      does not complete while the decision is outstanding — observed as: the event is received, and
      no terminal event arrives within a window at least twice the observed latency of the same run
      with the gate removed
- [ ] approving resumes the same run: the tool's recorded side effect appears **after** the approval
      is posted and not before, ordered by timestamps captured on the client, and the final answer
      contains the tool's output
- [ ] rejecting does not run the tool: the side effect is absent for the whole life of the run, and
      the run terminates with a refusal the caller can read — asserted on the side effect, never on
      the response text alone
- [ ] the approval id is not sufficient to decide: a caller who did not start the run, holding a
      valid id, is refused, and the tool's side effect stays absent — replayed as a second client
      with its own session against an id captured from the first
- [ ] a decision that arrives after the timeout is refused by name rather than silently applied, and
      the run's own timeout outcome is the one the framework documents rather than a default the
      caller has to discover
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the pause and the decision both travel the in-process path, and the ownership check of
      criterion 4 is the same check the HTTP path runs, not a second implementation behind IPC
- [ ] TUI: same seam, same shared check; the pause is rendered through the shared terminal
      presenter rather than a terminal-specific approval flow

**What resisted an oracle.** "The human understood what they were approving" is the thing that
actually matters and is not measurable by a run. The nearest gradeable substitute — the approval
event carries the tool name and the resolved input — is folded into criterion 1's payload rather
than claimed as a separate criterion, because a field being present is not comprehension and
pretending otherwise would inflate the score.

## The Next.js side

**An equivalent exists, but as a documented recipe rather than a framework primitive** — and that
distinction is itself part of what this journey measures.

The reference implementation: a tool declared **without** an `execute` function so the SDK surfaces
it as a pending call, a client that renders confirm/deny, and a resume path that submits the tool
result and continues the conversation. Vercel documents this as a human-in-the-loop cookbook entry
for Next.js. Where an official example exists it must be used and cited
(`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current name of the client-side function that submits a tool
result, whether the omit-`execute` mechanism is still the documented one, and whether the cookbook
entry addresses persistence of the pending state across a reload at all — if it does not, that is a
finding about the recipe, not a licence to build a stronger version on our side.

The comparison is fair because both sides must produce the same four things: a way to mark a tool as
gated, a pause the client can see, a decision channel, and a resume. It is also where the Next.js
side is likely to pay in glue lines and where ours is likely to pay in the criterion-4 check —
which is exactly the trade the benchmark exists to price.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: the agent declaration that marks the tool as gated, the tool itself if
it had to change, any approval handler or route, the client component that renders the decision,
and any store the pending state needed. Not counted: the tool's business body, reused from J1
unchanged — if it had to change to be gatable, that change **is** counted, and the reason is
recorded.

**Glue lines.** Business logic here is only the decision **policy** — which tools are gated, and
what the timeout does. Everything else is glue: the pause plumbing, the id threading, the client
component, the resume call, the ownership check. The ownership check is glue even though it is
security-relevant; the metric measures cost, and a check the framework should have supplied costs
lines on whichever side has to write it.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Ours currently
includes the approvals map on the agent declaration
(`packages/agents/src/bridge/define-agent.ts:70`) or its builder equivalent
(`packages/agents/src/bridge/agent-builder.ts:324`), the approval id, the approve endpoint's path
shape, and the timeout semantics. The timeout counts as a concept because it changes behaviour
silently if unknown — see the current-state note below.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass. Cold cache, at least three runs, mean and standard deviation. The human decision
is scripted, not typed by a person: an unautomated pause would measure typing speed.

## Measured — both sides, metrics 1-3, and the five criteria exercised (2026-08-20)

Everything above is left exactly as it was written, including § Current state and blockers, which was
measured earlier the same day against the same tree. This section does not repair it; where a run
contradicts a source read, both stand and the difference is named.

**The criteria did not move** (`../dx-benchmark.md` § Why the protocol comes before the measurement).
This is the journey the benchmark exists to make hardest to argue with, because it is the one where
the framework's advantage was expected to be structural rather than incremental — so the rule the
other five journeys fixed applies here without softening: a criterion satisfied in principle is not
satisfied, and a metric won on lines that price an unsatisfied criterion is not won.

**Two headlines, and they point in opposite directions.**

The first is that the structural advantage is real and was measured, not asserted: **TheoKit's run
genuinely pauses and Next.js's does not.** With the gate removed the run terminates in 42-102 ms;
with the gate in place and a scripted 1000 ms decision it terminates at 1053-1056 ms, three runs each.
The Next.js run carries its terminal `finish` frame **20 ms** into the gated request, because
`streamText` does not pause — it completes and returns the approval request, and the human decision
happens between two independent calls. No amount of application code closes that gap on their side.

The second is that **TheoKit loses this journey on cost, and loses a metric outside the noise bar for
the first time in the programme.** Files 4 against 2, glue lines 62 against 38, concepts 7 against 6 —
every one of the three going the other way, with files at exactly the 2x bar
§ What counts as winning sets. And the criteria are level at 3 of 5 each, failing in opposite halves.

**Neither side ran against a live model, and no criterion grades one.** Both lanes ran end to end
against a local scripted model; the instrument is described below and is counted on neither side.

### Versions and commits under test

| | |
| --- | --- |
| TheoKit | worktree at `98fb281a2` on `workspace`, with `0e9e6dc04` (the #361 fix) confirmed an ancestor. `theokit` 0.49.0, `@theokit/agents` 10.1.0, `@theokit/presenter` 0.7.0, `@theokit/sdk` 4.52.1 (real, not mocked), `zod` 4.4.3, Node 22.22.2 |
| Next.js | `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `zod@4.4.3`, Node 22.22.2 — J1's versions, unchanged, and `ai@7.0.70` is still `latest` on npm |

**#361 was confirmed by a run, not by reading this page.** The gated tool crosses once, and the
approval names the same id the call was announced under:

```json
{"type":"tool-input-available","toolCallId":"8551ed9e-53bc-4126-9d0c-e0303795f92f","toolName":"send_email","input":{"to":"ops@example.com","subject":"Q3 report","body":"Attached."}}
{"type":"tool-approval-request","approvalId":"8551ed9e-53bc-4126-9d0c-e0303795f92f","toolCallId":"8551ed9e-53bc-4126-9d0c-e0303795f92f"}
```

One `tool-input-available`, one id. The two-calls-two-ids defect this journey was warned about is
gone, and § Current state and blockers' description of the mechanism is otherwise confirmed by run.

### The version-specific facts, confirmed against the source

§ The Next.js side above deferred three questions. All three answers diverge from the supposition,
and the first divergence is the one that reframes the journey.

| Deferred question | Answer | Read from | Diverged? |
| --- | --- | --- | --- |
| Is the omit-`execute` mechanism still the documented one? | **No, and it is no longer a recipe at all.** `ai@7.0.70` ships a first-class approval primitive: `toolApproval` on `streamText`/`generateText`/`ToolLoopAgent`, taking `'user-approval'` per tool. The tool-level `needsApproval` is present and marked `@deprecated`: *"Tool approval is handled on a `generateText` / `streamText` level now"* | `node_modules/@ai-sdk/provider-utils/dist/index.d.ts` (the `Tool` type), `node_modules/ai/dist/index.d.ts` (the `streamText` signature), and https://ai-sdk.dev/docs/agents/tool-approvals | **Yes, materially.** This page's § The Next.js side says an equivalent exists "as a documented recipe rather than a framework primitive". As of `ai@7.0.70` it is a framework primitive, and that distinction — which this page said "is itself part of what this journey measures" — no longer favours us |
| What is the current name of the client-side function that submits a tool result? | For an approval it is **`addToolApprovalResponse({ id, approved, reason? })`**, on the `Chat` class and surfaced by `useChat`. Separately, `addToolResult` is now `@deprecated` in favour of `addToolOutput` | `node_modules/ai/dist/index.d.ts`, the `Chat` class members and `ChatAddToolApproveResponseFunction` | **Yes** — the prediction assumed the tool-result path; approvals have their own |
| Does the cookbook address persistence of the pending state across a reload? | **No.** Neither the cookbook entry nor the Tool Approvals page mentions storage, reload or resumption of a pending approval | https://ai-sdk.dev/cookbook/next/human-in-the-loop and https://ai-sdk.dev/docs/agents/tool-approvals | **No** — the prediction was that it might not, and it does not. Per this page's own instruction that is a finding about the recipe, not a licence to build a stronger version here; ours is not durable either (§ Current state and blockers, and J4) |

**A fourth fact nobody deferred, and it is the one that decides criterion 4.** `ai@7.0.70` HMAC-signs
approval requests. `ToolApprovalRequestOutput` carries an optional `signature` documented as *"HMAC-SHA256
signature binding this approval request to its tool call"*, enabled by
`experimental_toolApprovalSecret` on the call — *"the server signs each approval request at issuance
and verifies the signature when the approval is replayed, preventing client-forged approvals."* The
SDK also ships named errors for the failure modes — `InvalidToolApprovalSignatureError`,
`ToolCallNotFoundForApprovalError`, `InvalidToolApprovalError`. Nothing on our side corresponds to any
of it.

**A fifth fact nobody deferred, and it lands on the baseline rather than on J2.** In `ai@7.0.70`
`convertToModelMessages` returns `Promise<ModelMessage[]>`. The J1-shaped baseline route does not
typecheck without `await`, and `next build` fails on it. The `await` was added in **both** rungs of
the ladder, so it is inside the uncounted baseline and moves no J2 number. The same release nests
`LanguageModelV4Usage` — `inputTokens` is now `{ total, noCache, cacheRead, cacheWrite }` — which
matters only to the instrument.

### The baselines, declared

J5's ladder, reused rather than rebuilt: a journey measured from a bare scaffold re-counts work
another journey already counted, so every rung below J2's own is committed and **uncounted**.

| Step | TheoKit | Next.js |
| --- | --- | --- |
| 1 | `create-theokit` default template, copied verbatim with `_gitignore`, `package.json.tmpl` and `README.md.tmpl` renamed exactly as the scaffolder renames them | `create-next-app` (TypeScript, App Router, Tailwind) + `npm install ai @ai-sdk/react zod`, then the quickstart's pre-tools chat stage. J1's declared baseline and its argument for choosing it are not re-litigated here |
| 2 | J1's diff — the scaffolded `weather.ts` replaced by `order_lookup`, registered on the agent | J1's diff — the `order_lookup` tool, `stopWhen: stepCountIs(5)`, the client's `case 'tool-order_lookup':` branch |
| 3 | **J2's delta — counted.** `9525421..e4a6aee` | **J2's delta — counted.** `23d4159..f30481d` |

Both throwaway repositories are disposable; the diffs and the counts below are the evidence.

**One formatting control**, unchanged from J1: both sides' diffs are formatted with the
`create-theokit` template's Prettier config (`packages/create-theokit/templates/default/.prettierrc`
— `printWidth: 100`, `semi: false`), copied into the Next.js app root so the two sides are counted
with the same ruler.

**One asymmetry inside the baseline that must be declared before the numbers, because it is the
largest single favour this measurement does TheoKit.** The scaffold **already ships a gated tool** —
`.approval('send_notification', { question: 'Send this notification?' })` at
`packages/create-theokit/templates/default/agents/chat.ts:29`. § The four metrics excludes scaffolder
output not edited by hand, so had this journey gated *that* tool, the gate line would have been free.
It does not, because `send_notification` has no side effect outside the process and J2's criteria
grade the side effect rather than the response body — and this page's own counting rule says that if
the tool had to change to be gatable, the change is counted. So a new side-effecting tool is
introduced on **both** sides, symmetrically, and the gate line is charged on both. Judgement 1 below
carries the number the other way.

### Metrics 1-3

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | 4 | **2** | Next.js | 2.0x | **Loss** — Next.js is better by exactly the bar, and this is the first metric in the programme to land outside it against us |
| Glue lines | 62 | **38** | Next.js | 1.63x | **Tie** — inside the bar, and Next.js is the better side |
| Concepts required | 7 | **6** | Next.js | 1.17x | **Tie** — inside the bar, and Next.js is the better side |
| Time to first green run | not measured | not measured | — | — | not applicable |
| Criteria satisfied | 3 of 5 | 3 of 5 | neither | — | not a countable metric, and the most important line |

Added lines: 76 against 46. Files: 4 against 2. The two extra files on our side are the tool's own
file, which the framework's `agents/tools/` folder convention asks for, and the scaffold's
`use-transcript.ts`, through which its architecture routes client state. Neither is waste; both are
cost, and the metric measures cost.

### The two diffs, published

The glue split is the metric most open to being argued after the fact, and a table nobody can check
is not evidence. Both are `git diff` between the two commits named in the ladder, verbatim. The
lockfiles are omitted on both sides and the omission is stated; neither side added a dependency.

**TheoKit — `9525421..e4a6aee`, 4 files, 76 added, 3 removed.**

```diff
diff --git a/agents/chat.ts b/agents/chat.ts
@@ -4,6 +4,7 @@ import { z } from 'zod'
 import { BASE_INSTRUCTIONS } from './prompts/instructions.js'
 import { dailyBriefingSkill } from './skills/daily-briefing.js'
 import { currentTimeTool } from './tools/current-time.js'
+import { sendEmailTool } from './tools/send-email.js'
 import { sendNotificationTool } from './tools/send-notification.js'
 import { orderLookupTool } from './tools/order-lookup.js'
@@ -25,10 +26,12 @@ export default AgentBuilder.create()
   .tool(orderLookupTool)
   .tool(currentTimeTool)
   .tool(sendNotificationTool)
+  .tool(sendEmailTool)
   .approval('send_notification', { question: 'Send this notification?' })
+  .approval('send_email', { question: 'Send this email?', timeout: 2_000, onTimeout: 'abort' })
   .skills([dailyBriefingSkill])
   .build()

diff --git a/agents/tools/send-email.ts b/agents/tools/send-email.ts
@@ -0,0 +1,22 @@
+import { tool } from 'theokit/server/define'
+import { z } from 'zod'
+
+export const sendEmailTool = tool('send_email')
+  .describe('Send an email. A gated action — a human approves it before it runs.')
+  .input(
+    z.object({
+      to: z.string().describe('Recipient address.'),
+      subject: z.string().describe('Subject line.'),
+      body: z.string().describe('Message body.'),
+    }),
+  )
+  .execute(async ({ to, subject, body }) => {
+    const res = await fetch('http://localhost:4311/send', {
+      method: 'POST',
+      headers: { 'content-type': 'application/json' },
+      body: JSON.stringify({ to, subject, body }),
+    })
+    const { messageId } = (await res.json()) as { messageId: string }
+    return `Sent to ${to} as ${messageId}`
+  })
+  .build()

diff --git a/app/hooks/use-transcript.ts b/app/hooks/use-transcript.ts
@@ -1,6 +1,7 @@
 'use client'

 import { type UIMessage } from '@theokit/ui'
+import { useEffect, useState } from 'react'
 import { useAgent } from 'theokit/client'
@@ -11,6 +12,12 @@ import { GREETING } from '../lib/constants'
+export interface PendingApproval {
+  approvalId: string
+  toolName?: string
+  question?: string
+}
+
 export interface ChatTranscript {
@@ -23,10 +30,31 @@ export interface ChatTranscript {
   reset: () => void
+  /** The HITL decision the run is waiting on, or `undefined`. */
+  pendingApproval: PendingApproval | undefined
+  /** Settle the pending decision. */
+  decide: (approved: boolean) => void
 }

 export function useChatTranscript(): ChatTranscript {
-  const { thread, send, status, reset, error } = useAgent<{ message: string }>('/api/agents/chat')
+  const { thread, send, status, reset, error, approve } = useAgent<{ message: string }>(
+    '/api/agents/chat',
+  )
+  const [pendingApproval, setPendingApproval] = useState<PendingApproval | undefined>()
+
+  useEffect(() => {
+    if (status !== 'streaming') {
+      setPendingApproval(undefined)
+      return
+    }
+    const timer = setInterval(() => {
+      void fetch('/api/agents/chat/approvals')
+        .then((res) => res.json() as Promise<{ approvals: PendingApproval[] }>)
+        .then((body) => setPendingApproval(body.approvals[0]))
+    }, 200)
+    return () => clearInterval(timer)
+  }, [status])
+
   return {
@@ -35,5 +63,9 @@ export function useChatTranscript(): ChatTranscript {
     sendMessage: (text) => send({ message: text }),
     reset,
+    pendingApproval,
+    decide: (approved) => {
+      if (pendingApproval) void approve(pendingApproval.approvalId, { approved })
+    },
   }
 }

diff --git a/app/page.tsx b/app/page.tsx
@@ -21,8 +21,17 @@ import { useChatTranscript } from './hooks/use-transcript'
 export default function Page() {
   const [composerValue, setComposerValue] = useState('')
-  const { thread, isStreaming, hasError, error, onlyGreeting, sendMessage, reset } =
-    useChatTranscript()
+  const {
+    thread,
+    isStreaming,
+    hasError,
+    error,
+    onlyGreeting,
+    sendMessage,
+    reset,
+    pendingApproval,
+    decide,
+  } = useChatTranscript()
@@ -45,6 +54,13 @@ export default function Page() {
         onStarter={handleSubmit}
       />
+      {pendingApproval && (
+        <div>
+          {pendingApproval.question ?? `Run ${pendingApproval.toolName}?`}
+          <button onClick={() => decide(true)}>Approve</button>
+          <button onClick={() => decide(false)}>Deny</button>
+        </div>
+      )}
       <Composer
```

**Next.js + AI SDK — `23d4159..f30481d`, 2 files, 46 added, 1 removed.**

```diff
diff --git a/app/api/chat/route.ts b/app/api/chat/route.ts
@@ -15,12 +15,31 @@ export async function POST(req: Request) {
   const result = streamText({
     model,
     stopWhen: stepCountIs(5),
+    toolApproval: { send_email: 'user-approval' },
+    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
     tools: {
       order_lookup: tool({
         description: 'Look up the shipping reference for an order id.',
         inputSchema: z.object({ orderId: z.string() }),
         execute: async ({ orderId }) => SHIPPING_REFERENCES[orderId] ?? 'unknown',
       }),
+      send_email: tool({
+        description: 'Send an email. A gated action — a human approves it before it runs.',
+        inputSchema: z.object({
+          to: z.string().describe('Recipient address.'),
+          subject: z.string().describe('Subject line.'),
+          body: z.string().describe('Message body.'),
+        }),
+        execute: async ({ to, subject, body }) => {
+          const res = await fetch('http://localhost:4311/send', {
+            method: 'POST',
+            headers: { 'content-type': 'application/json' },
+            body: JSON.stringify({ to, subject, body }),
+          })
+          const { messageId } = (await res.json()) as { messageId: string }
+          return `Sent to ${to} as ${messageId}`
+        },
+      }),
     },
     messages: await convertToModelMessages(messages),
   })

diff --git a/app/page.tsx b/app/page.tsx
@@ -1,11 +1,14 @@
 'use client'

 import { useChat } from '@ai-sdk/react'
+import { lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
 import { useState } from 'react'

 export default function Chat() {
   const [input, setInput] = useState('')
-  const { messages, sendMessage } = useChat()
+  const { messages, sendMessage, addToolApprovalResponse } = useChat({
+    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
+  })
@@ -18,6 +21,29 @@
                 return <div key={`${message.id}-${i}`}>{part.text}</div>
               case 'tool-order_lookup':
                 return <div key={`${message.id}-${i}`}>looked up</div>
+              case 'tool-send_email':
+                if (part.state === 'approval-requested' && !part.approval.isAutomatic) {
+                  return (
+                    <div key={`${message.id}-${i}`}>
+                      Send this email? {JSON.stringify(part.input)}
+                      <button
+                        onClick={() =>
+                          addToolApprovalResponse({ id: part.approval.id, approved: true })
+                        }
+                      >
+                        Approve
+                      </button>
+                      <button
+                        onClick={() =>
+                          addToolApprovalResponse({ id: part.approval.id, approved: false })
+                        }
+                      >
+                        Deny
+                      </button>
+                    </div>
+                  )
+                }
+                return null
               default:
                 return null
```

### The added lines, classified

Business logic on this journey is what § How the four metrics are counted here says it is and nothing
else: *"the decision **policy** — which tools are gated, and what the timeout does"*, plus the gated
tool's own body. Everything else is glue, including the client component and the ownership plumbing.

| Class | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| Glue | **62** | **38** |
| Business logic | 8 | 8 |
| Comments | 2 | 0 |
| Blank | 4 | 0 |
| **Added lines** | **76** | **46** |

**The business logic is 8 on each side and it is the same 8**, which is the check that the tool was
introduced symmetrically: the gate declaration (`.approval('send_email', …)` against
`toolApproval: { send_email: 'user-approval' }`) and the seven lines of the `execute` body, which are
byte-identical apart from indentation.

**TheoKit's 62 glue lines.** `agents/chat.ts` (2): the import and `.tool(sendEmailTool)`.
`agents/tools/send-email.ts` (14): the two imports, `tool('send_email')`, `.describe(…)`, the six
lines of `.input(…)` with its schema, the `.execute(` and closing lines, and `.build()`.
`app/hooks/use-transcript.ts` (28): the React import, the six-line `PendingApproval` interface, the
two fields on `ChatTranscript`, the three-line `useAgent` destructure and its reflow, the `useState`,
the twelve-line polling effect, and the four lines returning `pendingApproval` and `decide`.
`app/page.tsx` (18): the eleven-line destructure and the seven-line prompt.

**Next.js's 38 glue lines.** `route.ts` (11): `experimental_toolApprovalSecret`, and the ten lines of
tool registration and schema around the body. `page.tsx` (27): the import, the three-line `useChat`
call with `sendAutomaticallyWhen`, and the twenty-three lines of the `tool-send_email` branch.

**The whole difference is on the client, and it is one number.** Server-side the two sides are within
a line of each other: 16 glue lines against 11, and the five-line gap is the `agents/tools/` file's
own imports and terminator. Client-side it is 46 against 27, and the reason is not styling — it is
that TheoKit's client has no way to learn that a decision is outstanding. That is criterion 1's
finding and it is priced here.

### The concepts, derived from the diffs

Derived from the imports and APIs each committed diff uses, not from a list written in advance.
Seven against six.

| # | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| 1 | `tool()` and its builder chain, terminated by `.build()` | `tool()` with `inputSchema` and `execute` |
| 2 | `.approval(toolName, options)` on `AgentBuilder` | `toolApproval` on `streamText`, and that `'user-approval'` is the status that gates |
| 3 | `HumanInTheLoopOptions`' `timeout` and `onTimeout`, and that `'abort'` settles as a **denial** rather than an abort (`packages/theo/src/server/agent/approval-registry.ts:22`) | `experimental_toolApprovalSecret`, and that unset means unsigned |
| 4 | `approve(approvalId, { approved })` on `useAgent` | `addToolApprovalResponse({ id, approved })` on `useChat` |
| 5 | `GET /api/agents/<name>/approvals` — its path shape and its `{ approvals: [{ approvalId, toolName, question, expiresAt }] }` body | `sendAutomaticallyWhen` with `lastAssistantMessageIsCompleteWithApprovalResponses` — and that without it the run never resumes, because the resume is a second request |
| 6 | `useState` | the `tool-<name>` part's `state: 'approval-requested'`, and `part.approval.id` / `part.approval.isAutomatic` / `part.input` |
| 7 | `useEffect`, and the cleanup contract a `setInterval` needs | — |

Rows 5 to 7 are the concept cost of the same defect the glue lines priced. Ours charges the reader
for an out-of-band endpoint and two React primitives, because the pending decision has to be
discovered; theirs charges for a part state, because the pending decision is in the message the
client already holds. Row 3 is the one place ours is charged for something genuinely richer — a
timeout policy — and § The break this journey was held on shows what that policy currently reports.

### The instrument, and why this journey could be run without credits

J6's instrument, reused with one substitution and one addition, and counted on neither side.

**The model.** `@theokit/sdk` 4.52.1's `provider-catalog.json` carries local profiles with
`authType: "none"`. J6 used `ollama` on `:11434`; that port was occupied by another process on this
machine, so this measurement used the sibling profile `lmstudio` — `authType: "none"`,
`apiMode: "chat_completions"`, `baseUrl: "http://localhost:1234/v1"`, `supportsToolUse: true`. The two
profiles differ in port and display name and in nothing this journey touches. **A correction to J6's
instrument note, recorded rather than quietly relied on:** J6 describes the `ollama` profile as
speaking *"Ollama's own `POST /api/chat` NDJSON protocol"*. The catalog entry is
`apiMode: "chat_completions"` with `baseUrl` ending `/v1`, i.e. the OpenAI-compatible route. The
instrument here serves both and logs which is called; only `POST /v1/chat/completions` was ever hit.

**The other side** uses the AI SDK's own `MockLanguageModelV4` driven by `simulateReadableStream`,
scripted to the same shape, consumed through the `streamText` the measured route calls. J6's trap was
avoided — `finishReason` is `{ unified, raw }`, not a string — and a new one was found and is recorded
under the version facts above: `LanguageModelV4Usage` nests its token counts in `ai@7.0.70`.

**The dependency** is a local HTTP recorder on `:4311`, byte-identical for both sides, whose
append-only log is the oracle for every criterion that grades the side effect. Reading the log back is
what makes "did the tool run" an artefact outside both frameworks rather than a claim about a response
body.

**The TheoKit lane** is served by a harness composing the three modules the shipped servers dispatch
to — `mountAgent` (`packages/theo/src/server/agent/mount-agent.ts:167`), `handleAgentApproval` and
`handleListApprovals` — with `csrfMode` left at the shipped `strict` default, so the probes must send
what the shipped `HttpTransport` sends. **The Next.js lane** is a published build: `next build`, then
`next start`, driven from outside the process. That asymmetry is named again under § Where the
comparison is not apples to apples.

**Tolerances declared before the grading run**, closing J9's own recorded protocol miss: the control
is three runs of the same agent with the gate removed, timed to the terminal `finish` frame on the
client; criterion 1's window is 2x the **maximum** control run; the scripted human delay is 1000 ms
for the window test and 300 ms elsewhere; the approval window is configured to `timeout: 2_000` so
criterion 5 is exercisable, and the configured value is recorded here per J6's rule.

### The five criteria, graded against the runs

| # | Criterion | TheoKit | Next.js + AI SDK |
| --- | --- | --- | --- |
| 1 | approval-request event carries an id; the run does not complete while the decision is outstanding | **partial** — the pause is real and measured; the event's payload is two ids and nothing else | **partial** — the payload is complete; the run does not pause at all |
| 2 | approving resumes the same run; the side effect lands after the approval; the answer carries the output | **PASS** | **PASS** |
| 3 | rejecting does not run it; the side effect is absent; the caller can read a refusal | **PASS** | **PASS** |
| 4 | the approval id is not sufficient to decide | **FAIL** — a second process, holding nothing, discovered the id and ran the tool | **PASS** — invented id, captured id without signature, and tampered input all refused, side effect absent |
| 5 | a decision after the timeout is refused by name; the timeout outcome is the documented one | **PASS** | **FAIL** — there is no window, so a signed approval replays and executes |
| 6-8 | Web, Tauri, TUI | **not exercisable here** — `@theokit/tui` and `@theokit/ui` live outside this repository (`.claude/rules/three-target-parity.md` records the same limit) | **not applicable** — a route handler serves one target |

**Criteria satisfied: 3 of 5 against 3 of 5.** Level, and level for opposite reasons, which is the
most interesting sentence this journey produces.

**Criterion 1 splits, and each side owns one half.** The pause half is ours and it is measured rather
than argued: control runs terminate at 102, 42 and 43 ms, so the window is 204 ms; the gated runs with
a scripted 1000 ms decision terminate at 1056, 1056 and 1053 ms, and the excess over control tracks
the scripted delay to within 43 ms. Next.js fails the same half outright — the gated request carries
`start`, `start-step`, `tool-input-available`, `tool-approval-request`, `finish-step`, `finish` and
completes in **20 ms**. Nothing is withheld. The payload half is theirs: their approval part carries
the tool name in its own type (`tool-send_email`), the resolved `input`, `isAutomatic` and a
`signature`; ours carries `approvalId` and `toolCallId` and nothing else, because the wire schema
declares nothing else (`packages/presenter/src/wire/chunk-schema.ts:85`) even though the producer
emits the tool name, the question, the input, the callback URL and the timeout
(`packages/agents/src/bridge/hitl-plugin.ts:89`). This page folded "the approval event carries the
tool name and the resolved input" into criterion 1's payload deliberately, and on our side that fold
comes out empty ([#394](https://github.com/usetheokit/theokit/issues/394)).

**Criterion 2 passes on both, on the side effect and on the clock.** Ours: the recorder is empty when
the approval arrives, the decision is posted at 347 ms, the recorder's entry is stamped 348 ms, and
`tool-output-available` carries `Sent to ops@example.com as msg_1` at 357 ms. Theirs: empty at the
approval, decision at 432 ms, recorder entry at 469 ms, part settles `output-available` with
`approved: true`.

**Criterion 3 passes on both, and the two refusals are not of the same quality.** Both keep the
recorder empty for the whole life of the run — `[]` at the terminal frame on both sides. Theirs emits
a **dedicated frame type**, `tool-output-denied`. Ours emits `tool-output-error` whose `errorText` is
a serialised process result:
`{"stdout":"","stderr":"Tool 'send_email' denied by human approver: not authorised","exitCode":126}`.
The refusal is readable and the approver's reason survives, so the criterion holds; a raw `stderr`
blob reaching the browser is the surface [#390](https://github.com/usetheokit/theokit/issues/390)
describes, met here rather than sought.

**Criterion 4 is the one this journey was held on, and it fails exactly as § Current state and
blockers predicted — now demonstrated to the side effect rather than to the status code.** Client A
opened the run and held it paused. Client B was a **separate OS process** with its own session, given
nothing but the host and port:

```json
{"at":32,"kind":"A-sees-approval","detail":{"id":"e82b309f-af18-4057-91c7-0e6e64f6c8b9"}}
{"at":84,"kind":"B-result","detail":"{\"B_discovered\":\"e82b309f-af18-4057-91c7-0e6e64f6c8b9\",\"B_status\":200,\"B_body\":\"{\\\"resolved\\\":true}\"}"}
{"at":84,"kind":"tool-part","detail":{"type":"tool-output-available","output":"Sent to ops@example.com as msg_1"}}
{"at":87,"kind":"side-effects-final","detail":[{"at":1787250748734,"body":{"to":"ops@example.com","subject":"Q3 report","body":"Attached."}}]}
```

B discovered the id from `GET /api/agents/chat/approvals`, which answered `200` with the id, the tool
name, the question and the expiry to a caller carrying no credential
(`packages/theo/src/server/agent/list-approvals-handler.ts:19` filters nothing), then settled it
through an endpoint whose only controls are CSRF, a path parse and a body-shape check
(`packages/theo/src/server/agent/approve-agent.ts:89`). **The gated tool ran**, and the recorder holds
the message. This is a security finding on a path already covered by a private advisory, so it is
recorded there and not in a public issue; the advisory's own text closed with *"Not exercised: settling
a real pending approval end to end, which needs a live model provider"*, and this run closes that gap
without one.

The other side passes, and the reason is architectural rather than diligent: there is no server-side
pending registry to attack, because the approval travels in the message history the client replays,
and `experimental_toolApprovalSecret` binds it. Three shots, all refused with the recorder empty — an
invented id, a captured id posted without its signature, and a captured id whose signature was kept
while the input was changed to `attacker@example.com`. All three returned
`{"type":"error","errorText":"An error occurred."}` and ran nothing.

**Criterion 5 goes the other way, and it is the only countable thing on this journey that does.**
Ours: a decision posted 3.5 s into a 2 s window is refused —
`{"error":{"code":"NOT_PENDING","message":"No pending approval for id '11d35819-…'."}}` — and the
outcome the run applied is the documented `onTimeout` default. Theirs: there is no window at all, so
nothing is ever refused for arriving late; the fourth shot of the forge probe replayed an
intact signed approval from a **different session** and the tool executed, recorder entry and all.
Neither the cookbook nor the Tool Approvals page names an expiry. That is a real gap on their side and
it is the mirror of ours: we have a window and misreport its expiry, they report nothing because there
is nothing to report.

**Ours passes criterion 5 and fails the fifth metric on the same behaviour**, which is why the two are
graded in different places; see the next section.

### The break this journey was held on, reproduced

§ The deliberately broken state names J2's break as **absent approval** — the decision never arrives —
and says the worst outcome is not an unhelpful message but a tool that runs anyway. The tool does not
run anyway; the recorder is empty. What happens instead is the other failure this repository has now
found five times.

| | |
| --- | --- |
| The message § The deliberately broken state asks for | `approval "ap_9f2" for tool "sendEmail" expired after 300s with no decision; the run was aborted. Decide within the window, or raise timeoutMs on the tool's approval options.` |
| The message the run produces | `Tool 'send_email' denied by human approver` |
| The message an explicit **Deny with no reason** produces | `Tool 'send_email' denied by human approver` |

Byte-identical. Both arrive as `tool-output-error` with `exitCode: 126`, and the terminal `finish`
frame carries only usage and a duration, so nothing later disambiguates them.

**Metric 5 is therefore a FAIL on our side, and it fails one step worse than "does not name the
action": it names a different one.** Nobody denied anything. The registry knows it timed out, knows
the configured `onTimeout`, and knows `expiresAt`; none of it survives
`settle({ approved: opts.onTimeout === 'proceed' })`
(`packages/theo/src/server/agent/approval-registry.ts:111`), and the plugin then writes
``let message = `Tool '${c.name}' denied by human approver` ``
(`packages/agents/src/bridge/hitl-plugin.ts:106`). A third configuration collapses into the same
sentence: `onTimeout: 'retry'` is also a denial, as the registry's own comment says
(`packages/theo/src/server/agent/approval-registry.ts:22`).

This is the fifth instance of the family after #379, #384, #382 and #388, and the ADR proposed for it
now exists (`../../adr/0002-an-abnormal-ending-is-never-reported-as-normal.md`). Filed as
[#393](https://github.com/usetheokit/theokit/issues/393).

**On the Next.js side the break does not exist to be handled**, because there is no window to expire.
Per J5's rule the honest entry is *"no path"*, and it is **not** a pass: the reason they cannot report
an expiry badly is the same reason they fail criterion 1's pause half and criterion 5 outright.

### Counting judgements, stated rather than buried

Seven, each with the effect of deciding it the other way. **Two of them change which side wins a
metric, and neither inversion produces a TheoKit win** — the strongest of them only converts a loss
into a tie.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | The scaffold already gates a tool. Should the journey have gated `send_notification` and taken the gate for free? | **No.** Its handler returns a string and touches nothing outside the process, and J2's criteria grade the side effect. This page's own rule says a tool that had to change to be gatable is counted, so the change would have been charged anyway | TheoKit files 4 to **3** and glue 62 to **60**, if the tool file disappears entirely. Files then 3 against 2 — 1.5x, inside the bar, so metric 1 becomes a **tie** rather than a loss. This is the single most consequential judgement in the count and it is the one most favourable to us |
| 2 | Is the tool's own file forced, or chosen? The Next.js side declares its tool inline inside `streamText` | **Forced enough to count.** The scaffold's `agents/tools/` convention is what J1 was charged a concept for knowing, and every scaffolded tool lives in its own file. Declaring it inline in `chat.ts` is possible and is not what the framework asks for | TheoKit files 4 to **3**, glue unchanged (the lines move, they do not vanish). Files 3 against 2 — 1.5x, metric 1 a **tie** |
| 3 | Is `app/hooks/use-transcript.ts` J2's cost or the scaffold's? The Next.js page calls `useChat` directly and pays no such hop | **J2's cost.** The scaffold routes all client state through that hook; bypassing it to call `useAgent` in `page.tsx` would move the same lines and break the architecture the scaffold ships | TheoKit files 4 to **3** and glue roughly unchanged. Same effect as judgement 2 — metric 1 a **tie** — and it cannot be combined with judgement 2, since the two describe different files |
| 4 | Is `.approval('send_email', { … })` glue or business logic? | **Business logic**, and not by preference — § How the four metrics are counted here fixed it before either implementation existed: *"the decision policy — which tools are gated, and what the timeout does"* | Both sides move together: TheoKit glue 63, Next.js 39. Ratio 1.62x. No effect on the comparison |
| 5 | Does `experimental_toolApprovalSecret` belong to J2 on the Next.js side, given nothing on ours corresponds to it? | **Counted as glue on their side.** It is what criterion 4 passes on, and this page's rule says the ownership check is glue *"even though it is security-relevant"* — the metric measures cost, and a check the framework should have supplied costs lines on whichever side writes it | Next.js glue 38 to **37**. Ratio 1.68x, still a tie, still their metric |
| 6 | The eleven-line destructure in `page.tsx` is a reflow the 100-column printer forced by adding two fields | **Counted as `numstat` reports it**, per J3's judgement 2 | Counting substance rather than lines gives 9 for that hunk: TheoKit glue 62 to **60**. Ratio 1.58x, still a tie |
| 7 | Is the polling effect the *shortest correct* client, or a strawman? An application could pass `part.toolCallId` to `approve()`, since #361 usually makes the two ids equal | **The polling effect is counted.** "Usually" is the correlation module's own word: *"Which id wins is decided by which side reached the wire first, not by a preference"* (`packages/agents/src/bridge/hitl-call-correlation.ts`). Building on a documented race is not a path, and the store gives no way to tell a paused tool from a running one either. **This half is a source read** — I did not force the other ordering | If the shortcut were counted as legitimate, TheoKit's client drops the twelve-line effect and the endpoint concept: glue 62 to **50**, concepts 7 to **6**. Ratio 1.32x and 1.0x — both still ties, and files unmoved, so metric 1 is still a loss |

**Judgements 1, 2 and 3 all point at the same soft spot and none of them rescues the journey.** Any one
of them decided the other way turns metric 1 from a loss into a tie; none turns it into a win, and
none touches glue lines or concepts, where Next.js also leads. That is stated because it is the check
that matters: a margin a single decision can flip is not a margin, and here no single decision — nor
all three together — produces a TheoKit win on anything.

### The verdict

**J2 is lost, and it is the first journey in the programme where a countable metric goes against
TheoKit outside the noise bar.**

- **Files touched: Next.js, 2 against 4 — 2.0x, outside the bar.** A loss, not a tie.
- **Glue lines: Next.js, 38 against 62 — 1.63x.** A tie by the bar, with Next.js the better side.
- **Concepts required: Next.js, 6 against 7 — 1.17x.** A tie by the bar, with Next.js the better side.
- **Criteria satisfied: 3 of 5 each.** Level.

The claim under test is that building this costs less in TheoKit. On this journey it costs more, on
every metric that was counted, and the thing that costs more is not the pause — the pause is one line
on each side — but the client that has to find out the pause happened.

**And the journey the framework loses on cost is the one it wins on capability, which is the sentence
this page has to hold in one piece.** The pause is real: measured against a control, our run withholds
its terminal frame for as long as the human takes, and theirs cannot, because `streamText` returns
rather than waits. That is a genuine architectural difference and no application code closes it. It is
also worth **zero** on this benchmark's three metrics, because a capability that costs the same number
of lines as its absence is free to declare and free to skip.

**What actually decided the numbers was neither side's approval design.** It was that the AI SDK puts
the pending decision in the message the client already holds, and TheoKit drops it before the client
sees it. `readMessageStream` returns `false` for `tool-approval-request` by design
(`packages/presenter/src/wire/read-message-stream.ts:207`), so the store's snapshot has four keys —
`messages`, `thread`, `status`, `error` — and none of them is the id that the store's own
`approve(approvalId, …)` requires (`packages/agents/src/client/use-agent.ts:41`). Observed, not read:
while the decision was outstanding, the paused tool sat in `state: 'input-available'`, which is what an
**ungated** tool looks like while it runs. Every extra line and every extra concept on our side is
downstream of that ([#392](https://github.com/usetheokit/theokit/issues/392)).

**Two of the five journeys measured before this one produced their largest margins on code that did not
work.** This one produces its margins against us on code that does, on both sides, and that is the more
useful result: there is nothing here to discount.

### Where the comparison is not apples to apples

Named rather than adjusted for, because adjusting a count until it evens out is what the protocol
forbids.

- **The Next.js lane ran as a published build (`next build` + `next start`); the TheoKit lane ran
  through a harness composing `mountAgent`, `handleAgentApproval` and `handleListApprovals`.** Those
  are the modules the shipped dev and prod servers dispatch to
  (`packages/theo/src/cli/commands/start/handlers.ts:246`,
  `packages/theo/src/vite-plugin/agent-middleware.ts:83`) and CSRF was left at the shipped default, but
  it is not `theokit start`, and J9 recorded the same asymmetry the same way.
- **The client was exercised as a store, not as a rendered surface.** Both sides' `page.tsx` were
  written, typechecked on the Next.js side by `next build`, and their logic was driven through the
  underlying client objects — `AgentClient` on ours, `Chat` on theirs. No browser was opened. The
  criteria's oracle is the event stream and the side effect, not the pixels, so this does not move a
  grade; it does mean neither prompt was seen by a human.
- **Only the Web target was measured, on both sides.** Criteria 7 and 8 ask specifically whether the
  Tauri and TUI paths reuse the same seam and the same ownership check, and those packages live outside
  this repository. A route handler serves one target, so the Next.js side cannot lose that dimension —
  the comparison silently gives it away.
- **The TheoKit tool's file is charged to J2 and the Next.js tool's lines are not**, because one side's
  convention is a file and the other's is an object literal. Judgement 2 carries the number.
- **The approval window was configured to 2 s** so criterion 5 could be exercised in a run rather than
  waited out; the shipped default is 300 s
  (`packages/theo/src/server/agent/build-agent-streamer.ts:38`). Nothing about the timeout's *reporting*
  depends on the value.

### What is still unmeasured, and why

- **Metric 4, time to first green run, on both sides.** It needs at least three cold-cache runs per side
  from the create command, and the figure is only meaningful measured identically on each — so it is
  recorded as not measured rather than estimated.
- **Criteria 6 to 8, the three-target obligation.** Not exercisable in this repository; what settles
  them is the north-star app, which does not exist.
- **Durability across a reload or a second instance**, on either side. Ours is a process-local map by an
  explicit YAGNI decision; theirs is the client's message array and the cookbook does not mention
  reloads. Both fail for their own reasons and no criterion here grades it — J4 owns that boundary.
- **Whether the `toolCallId`/`approvalId` correlation can be forced to disagree.** Judgement 7 depends
  on the correlation module's own statement that the ordering is a race; I did not construct the losing
  ordering, and the judgement is labelled a source read because of it.
- **`docs/program/evidence/j2-hitl/` still does not exist.** § Evidence requires both implementations to
  be committed under it. The diffs and the counts are published here instead, which satisfies the
  checkability the clause exists for and does not satisfy the clause. Recorded again as an open gap
  rather than resolved by editing the protocol to match what was done — now for the sixth document.
- **J9's open gap against its own instruction is now closable, and this section is the notice.** J9
  pre-committed to counting hand-written HITL span lines on the Next.js side and deliberately did not,
  because *"neither baseline has an approval flow at all"* and building one on one side alone would
  compare an implemented feature against an absent one. Both sides now have an approval flow, measured
  and published above, so that reason has expired.

### Three issues and one advisory update from this measurement

- [#392](https://github.com/usetheokit/theokit/issues/392) — `useAgent` exposes `approve(approvalId)`
  and no way to obtain the `approvalId`; the store drops `tool-approval-request` and a paused gated
  tool is indistinguishable from a running one. This is the defect the glue-line and concept gaps
  price.
- [#393](https://github.com/usetheokit/theokit/issues/393) — a HITL approval that expires is reported
  as `denied by human approver`, byte-identical to a human pressing Deny. The fifth instance of the
  #379/#384/#382/#388 family, and the metric-5 failure above.
- [#394](https://github.com/usetheokit/theokit/issues/394) — the `tool-approval-request` chunk carries
  only two ids; the tool name, question and input the producer emits are dropped at the wire schema.
  This is criterion 1's payload half.
- **GHSA-g94h-459g-rjhj** — updated, not re-filed. Criterion 4's failure is a security finding on a
  path already under a private advisory, so the end-to-end reproduction is attached there. It closes
  the advisory's own labelled gap: the earlier report could only infer that an unauthenticated caller
  would reach `200 {"resolved":true}`; this run reached it, and the gated tool executed.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J2 is the
one the benchmark names in its own sentence: **absent approval** — the decision never arrives.

| | |
| --- | --- |
| Names the action | `approval "ap_9f2" for tool "sendEmail" expired after 300s with no decision; the run was aborted. Decide within the window, or raise timeoutMs on the tool's approval options.` — names the id, the tool, the elapsed budget, the outcome that was applied, and the knob |
| Does not name the action | `Error: aborted`, or a run that simply ends with no explanation, or — worst here — a run that **proceeds** and reports success |

**A second break, because it is the one this journey is held on: a decision posted by the wrong
caller.** Today that is not an error at all, so the transcript will record a silent success (see
below). Once the ADR lands, the message that names the action reads like
`approval "ap_9f2" belongs to a run this caller did not start.` and the message that does not reads
`403 Forbidden` with an empty body.

**As in J8, absence of an error is graded as a failure of this metric, not as unmeasurable.** The
worst outcome of an absent approval is not an unhelpful message; it is the tool running anyway.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**The mechanism works. The authorization does not exist.**

What is wired end to end:

- Declaration is an `approvals` map on the agent, compiled to a lookup with fail-fast on an unknown
  tool name (`packages/agents/src/bridge/define-agent.ts:70`, compiled at `:301`), with builder
  equivalents (`packages/agents/src/bridge/agent-builder.ts:324`).
- The pause is an awaited `pre_tool_call` hook that mints an id and blocks
  (`packages/agents/src/bridge/hitl-plugin.ts:78`, id at `:89`, the await at `:101`), and a denial
  returns a block rather than letting the call through (`:111`). It is wired into the production
  stream (`packages/agents/src/bridge/agent-endpoint.ts:258`).
- The decision arrives at a real handler on both servers — production
  (`packages/theo/src/cli/commands/start/handlers.ts:246`) and dev
  (`packages/theo/src/vite-plugin/agent-middleware.ts:83`), both reaching
  `packages/theo/src/server/agent/approve-agent.ts:83`.

**The blocker, stated precisely: the approve endpoint authenticates nobody — and as of 2026-08-20
that is no longer for want of a primitive.**

Its only controls are CSRF, a path parse and a body-shape check
(`packages/theo/src/server/agent/approve-agent.ts:89`), and the pending record has no owner field to
check against — it is `{ approvalId, toolName?, question?, expiresAt, payloadSchema? }`
(`packages/theo/src/server/agent/approval-registry.ts:50`), settled by id alone (`:70`, implemented
at `:123`). The listing endpoint returns every pending approval in the process with no filter
(`packages/theo/src/server/agent/list-approvals-handler.ts:19`). A repository-wide search of that
handler for a caller identity finds none. So criterion 4 fails today.

**What changed, and it changed the shape of the blocker rather than removing it.** ADR 0001's first
three decision points are implemented and verified: a route may declare a policy
(`packages/theo/src/core/contracts/route-config.ts:69`), the framework supplies the owner check it
previously lacked (`packages/theo/src/core/contracts/route-policy.ts:84`), and one evaluation
function is called by all three transports — the Node executor
(`packages/theo/src/server/http/execute.ts:268`), the Web executor
(`packages/theo/src/server/web-handler.ts:260`) and the in-process caller
(`packages/theo/src/server/http/in-process-caller.ts:103`) — with a parity test asserting an
identical decision for the same subject across them
(`tests/unit/access-decision-parity.test.ts:12`). The ADR records the split status on its own status
line (`docs/adr/0001-authorization-is-transport-independent.md:3`) and in a dedicated section
(`:53`).

**The approve endpoint is not a route, so none of that reaches it.** It is dispatched directly by
each server rather than through the executors that evaluate a policy
(`packages/theo/src/cli/commands/start/handlers.ts:246`,
`packages/theo/src/vite-plugin/agent-middleware.ts:83`), and no policy is declared for it. The
sentence the ADR wrote about this endpoint — *"an endpoint whose only control was CSRF, which
authenticates nobody"* (`docs/adr/0001-authorization-is-transport-independent.md:19`) — still
describes it exactly.

So J2's blocker is now **small and specific rather than undecided**: give the approve and list
endpoints a subject and an owner, using the primitive that now exists. That is code, not a decision —
the same category of blocker as J4's, and a materially smaller one than it was this morning.

Two further findings that change how J2 will score once it runs, recorded now so they are not
discovered mid-measurement:

- **Pending state is a process-local map** (`packages/theo/src/server/agent/approval-registry.ts:96`),
  by explicit YAGNI decision recorded in the module (`:11`). A reload survives it only because the
  server process does; a second instance shares nothing. This is the same durability boundary J4
  hits from the other side.
- **The timeout default auto-settles**, and which way it settles depends on the configured
  `onTimeout` (`packages/theo/src/server/agent/approval-registry.ts:107`), with a 300-second default
  (`packages/theo/src/server/agent/build-agent-streamer.ts:38`). Criterion 5 grades this
  deliberately: a gate that silently proceeds on timeout is a gate that fails open.

**Three implemented-and-unwired surfaces sit next to this journey and none of them is on its path** —
recorded so the benchmark does not mistake them for the mechanism: the pending ledger
(`packages/agents/src/ask/pending-ledger.ts:76`, whose own header records that it shipped unused at
`:41`), the ask bridge (`packages/agents/src/ask/ask-bridge.ts:139`), and the hook approval store
(`packages/agents/src/hooks/approval-store.ts:89`).

**Not measured:** whether the advisory GHSA-g94h-459g-rjhj is still open upstream. The repository
references it; the tracker was not queried.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The decision this journey waits on: `../../adr/0001-authorization-is-transport-independent.md`
- The journey whose isolation property is a strict superset of criterion 4: `j08-tenant.md`
- The journey whose durability boundary this shares: `j04-thread.md`
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
- The ADR the timeout's misreport is an instance of:
  `../../adr/0002-an-abnormal-ending-is-never-reported-as-normal.md`
- Defects this measurement found and filed: #392 (the client cannot obtain the approval id), #393 (an
  expired approval is reported as a human denial), #394 (the approval chunk carries only two ids)
