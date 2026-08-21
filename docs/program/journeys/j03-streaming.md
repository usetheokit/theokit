# J3 — Streaming

The third of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** ready. `../dx-benchmark.md` § Sequencing lists J3 in the first batch to be
implemented and measured.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J3 | **Streaming** | Tokens reach the user progressively, not in one block at the end |

The load-bearing word is **user**. A server that streams into a proxy that buffers has not satisfied
this journey, which is why every criterion below is observed at the client and never at the
producer.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] the first chunk carrying assistant text is received by the client **before** the run
      terminates, recorded chunk by chunk with a client-side timestamp per chunk — the buffered
      failure mode produces exactly one text chunk at the end and this criterion is what
      distinguishes it
- [ ] at least two distinct text-bearing chunks arrive, separated by at least 50 ms of wall clock at
      the client, over a prompt whose answer is long enough to make that possible; the chunk
      timestamps are recorded in the transcript so the separation is auditable rather than asserted
- [ ] time-to-first-chunk is at most half of time-to-completion for the same run — a ratio rather
      than an absolute, so the criterion survives a slow model and still fails a buffered one
- [ ] the same assertions hold against the **published build served over the deployed adapter**, not
      only against the dev server: a stream that survives `dev` and dies behind the production
      handler is the failure this criterion exists to catch
      (`../../../ROADMAP.md` § M14 records the buffering shim as the live blocker across six targets)
- [ ] disconnecting mid-run and reconnecting resumes the same run from where it stopped rather than
      restarting it — asserted by the absence of duplicate text in the reassembled message
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same progressive delivery over the in-process path, with the same two-chunk
      separation oracle applied to the events the webview receives
- [ ] TUI: the same run rendered progressively through the shared terminal presenter — text visible
      before completion, asserted on the presenter's output stream rather than on the final frame

**What resisted an oracle.** "Feels responsive" has no instrument. The 50 ms in criterion 2 is a
declared floor, not a measured human threshold, and it is chosen to be far below any plausible
perception boundary so that it tests *mechanism* rather than *quality*: two chunks 50 ms apart prove
the pipe is incremental, and prove nothing about whether the experience is good.

## The Next.js side

**A direct and strong equivalent exists, and it is the journey where the Next.js side is most likely
to win or tie.** Streaming is native ground for that stack: React Server Components stream through
`<Suspense>` boundaries, and the AI SDK's `streamText` returns a response object built for a Route
Handler to return directly, with a matching client hook that accumulates deltas.

The reference implementation: `app/api/chat/route.ts` returning the SDK's streaming response, and a
client component rendering the hook's message list. Where an official example exists it must be used
and cited (`../dx-benchmark.md` § Why the protocol comes before the measurement).

*To confirm at implementation time, because these are version-specific and this document is written
without access to that source:* the current name of the method that converts a `streamText` result
into a `Response`, whether the deployed platform imposes any buffering on the default runtime, and
whether the official example still uses the same client hook.

**One asymmetry must be recorded before any number exists.** Criterion 4 grades the published build
behind a real adapter, and our own roadmap already records a buffering shim as a live blocker across
six deploy targets. The Next.js side's most common deployment target is the one its vendor operates.
That is not a rigged comparison — it is a real difference in what each side ships — but the report
must state which adapter each side was measured on, or the numbers will be compared across
different questions.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Counted: any file the developer edits to turn a non-streaming answer into a
streaming one — handler, client component, transport option, config. On our side the scaffold
already streams, so as in J1 the journey is measured by the delta from a deliberately
non-streaming starting point, and the starting point is recorded in the evidence directory so the
delta is reproducible.

**Glue lines.** Business logic here is the empty set again — J3 changes no answer, only its
delivery. Every line is glue, so the margin is reported as an **absolute count**, not a multiple,
for the same reason J8 states.

**Concepts required.** Derived mechanically from the imports and APIs the diff uses. Ours currently
includes the wire protocol name, the response builder
(`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:47`), the client transport
(`packages/agents/src/client/http-transport.ts:49`) and the React binding
(`packages/agents/src/client/use-agent.ts:75`). The reconnect header that criterion 5 exercises
counts as a concept: a developer who does not know it exists cannot satisfy that criterion.

**Time to first green run.** Wall clock from `npx create-theokit` to the first run where all five
assertions pass. Cold cache, at least three runs, mean and standard deviation. Note that this
journey's own subject — latency — is inside the measurement; the metric is developer wall clock, not
stream latency, and the two are reported separately so neither is mistaken for the other.

## Measured - TheoKit side, metrics 1-3 (2026-08-20)

**Three of four metrics, one side.** This is not the journey being won; it is the first number this
journey has. Metric 4 and the whole Next.js side are unmeasured, and the subsection below says why.

Obtained from a real diff, not an estimate: the scaffold template was copied verbatim, committed as
an untouched baseline, and the journey implemented on top. The counts are `git diff --numstat` over
that commit.

**The counting rule above does not survive contact with the framework, and the divergence is stated
rather than resolved quietly.** § How the four metrics are counted here says J3 is measured "by the
delta from a deliberately non-streaming starting point". There is no such starting point on this
side: the agent mount answers with fixed `text/event-stream` headers
(`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:23`), nothing in
`packages/theo/src/server/agent/mount-agent.ts:98` branches to a buffered response, and the
scaffolded client already reads the result as a stream
(`packages/create-theokit/templates/default/app/hooks/use-transcript.ts:29`). A non-streaming
baseline would have to be hand-built - a plain server route that awaits the run and returns JSON -
and the delta from that would price a detour no developer takes. So the delta is taken from the
scaffold as it ships, the rule is reported as not applying rather than reinterpreted, and the
Next.js side must be measured from ITS shipped starting point for the same reason, with the report
naming both.

| Metric | TheoKit | How it was counted |
| --- | --- | --- |
| Files touched | **0** for criteria 1-3, **1** for criterion 5 | nothing is created, edited or deleted to make tokens arrive progressively; `app/hooks/use-transcript.ts` is edited to make a dropped stream resume |
| Glue lines | **0**, then **6** | this journey declares business logic the empty set, so every line of the criterion-5 edit is glue |
| Concepts required | **0**, then **3** | `useAgent`'s `reconnect`, the `status` value that reports the drop, and React's `useEffect` |
| Time to first green run | **not measured** | needs a live model call; see below |

**Zero is the result, and it is the result the counting rule was least prepared for.** Criteria 1
through 3 - a text chunk before the run terminates, two chunks separated by 50 ms, time-to-first-chunk
at most half of time-to-completion - are properties of the scaffold as generated. Per
`../dx-benchmark.md` § The four metrics, scaffolder output nobody edited counts on neither side, so
this is not a zero that was awarded to us: it is a zero that was found, and what it says is that the
developer does not participate in this part of the journey at all. A margin cannot be computed from
it until the other side is measured - `../dx-benchmark.md` § What counts as winning asks for a
factor or a stated absolute gap, and nothing is divisible by zero.

**The 6 added lines for criterion 5, classified.** Published because the glue split is the metric
most open to being argued after the fact, and a table nobody can check is not evidence.

Glue (6): `import { useEffect } from 'react'`; the two lines the widened destructure now occupies,
one of which replaces the single line that was there; `useEffect(() => {`;
`if (status === 'error') reconnect()`; and `}, [status, reconnect])`.

Business logic (0): J3 changes no answer, only its delivery. The counting rule fixed that in advance
and the diff did not contradict it.

**Four judgement calls, stated rather than buried.**

1. **Criterion 5 was counted as needing an edit at all.** The client exposes `reconnect`
   (`packages/agents/src/client/use-agent.ts:124`) and the store settles into `error` when the
   stream drops (`packages/agents/src/client/agent-client.ts:221`), but nothing in the scaffold
   calls it. A capability nobody invokes is not a satisfied criterion, so the wiring is counted.
   Deciding the other way makes J3 a flat zero on all three metrics.
2. **The reflowed destructure was counted as `numstat` reports it.** Six lines are added and one
   removed; the substance is five new lines plus a reflow forced by the 100-column formatter.
   Counting substance rather than lines gives 5.
3. **The retry shape is the minimal one.** Reconnecting on every transition into `error` will retry
   against a permanently failing endpoint. A guarded version - one attempt per run - adds about two
   lines, for 8.
4. **Concepts were derived from the diff, not from the list written above.** § How the four metrics
   are counted here names the wire protocol name, the response builder, the client transport, the
   React binding and the reconnect header. None of the first four appears in the measured diff,
   because the framework supplies all of them. The reconnect header does not appear either:
   `HttpTransport.reconnectToStream` sends no `Last-Event-ID`
   (`packages/agents/src/client/http-transport.ts:104`), so the server falls back to replaying the
   whole run (`packages/theo/src/server/agent/handle-agent-run-reconnect.ts:54`) and the developer
   never names the header. Applying the list as written scores 5; applying the rule's own first
   sentence - derive it from the diff - scores 3. The 3 is reported and the list's items are named
   here so the choice can be checked rather than trusted.

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache.
That spends real credits, and the number is only meaningful measured identically on both sides - so
running one side alone would produce a figure with nothing to compare it to.

**The Next.js side does not exist yet.** Until it does, nothing here is a comparison, and the
winning rule cannot be applied. A journey is won or tied; a one-sided count is neither. On this
journey that matters more than on most: § The Next.js side already predicts this is where the other
stack is most likely to win or tie, and a zero on our side does not settle a race whose other lane
is empty.

**Criterion 4 was not exercised at all.** It grades the published build behind a deploy adapter, and
`../../../ROADMAP.md` § M14 records the buffering shim as a live blocker across six targets. Nothing
above was run behind an adapter, so the criterion is neither passed nor failed here - it is
untouched, and the diff says nothing about it.

**Criterion 5's behaviour under real loss was not observed.** The edit was written; a lossy run was
not performed. Whether replay-from-start plus id-keyed upsert really yields no duplicate text in the
reassembled message is read from source and unverified, which is the same limit § Current state and
blockers already recorded.

**Which SSE encoder a measured build uses is still unrecorded.** § Current state and blockers found
two encoders emitting different event shapes; this measurement produced no run, so it did not settle
which one a benchmark run would exercise.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md`
records the same limit). What settles them is the north-star app
(`.claude/rules/northstar-app.md`), which does not exist yet.

**So: J3 is not won, not tied, and not run.** It has one side of three metrics, one of which is a
zero whose meaning depends entirely on a number nobody has produced.

## Measured - Next.js side, metrics 1-3 (2026-08-20)

**The other half, measured the same day by the same rule.** From a real diff in a throwaway app that
is not committed here: the instrument is disposable, the evidence is what gets versioned. The app
builds and typechecks, its streaming path was exercised with a mock model, and its reconnect path
was exercised against a live Redis - which is more than J1's Next.js half managed, and the section
on instruments below says exactly how far each run went.

### The version-specific facts, confirmed against the source

§ The Next.js side above deferred three questions to implementation time, and the journey turned out
to need a fourth. All four were checked against the packages actually installed and against Vercel's
own documentation, and the answers are recorded including where they diverged from the supposition.

| Deferred question | Answer | Checked against | Diverged from the supposition? |
| --- | --- | --- | --- |
| The current name of the method that converts a `streamText` result into a `Response` | There is no method. The quickstart pairs two standalone helpers: `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })` | the quickstart source, and the deprecation block on `toUIMessageStreamResponse` in the installed `ai@7.0.70` type declarations | **Yes.** The question presumed a method existed and asked for its name. The method form still resolves and is marked deprecated, *"will be removed in the next major release"* - so the supposition was one release behind the shape, not just the spelling |
| Whether the deployed platform imposes buffering on the default runtime | No opt-out is asked for anywhere: `export const runtime` appears zero times across the docs tree shipped inside `ai@7.0.70`. The SDK handles it in the response instead - `UI_MESSAGE_STREAM_HEADERS` carries `cache-control: no-cache`, `connection: keep-alive` and `x-accel-buffering: no` alongside the content type, and `createUIMessageStreamResponse` applies them | the runtime export list, the header constant read at runtime, and two troubleshooting pages titled *streaming-not-working-when-proxied* and *streaming-not-working-when-deployed* | **Yes, and it matters.** The buffering hazard is real and the SDK answers it at the response, not at the runtime. This is the fact that produced usetheokit/theokit#383 on our side |
| Whether the official example still uses the same client hook | Yes - `useChat` from `@ai-sdk/react@4.0.73` | the installed package's export list | **No** |
| **Added by this journey:** how a dropped stream resumes | `resume: true` on `useChat`, plus `resumable-stream`, plus Redis, plus a store that remembers which stream id is active for a chat | the official *Chatbot Resume Streams* page, shipped byte-identical inside `ai@7.0.70` and confirmed against `main` | The prefix is gone: `experimental_resume` does not exist in these versions, and the manual method is `resumeStream`. The feature is not marked experimental or beta anywhere on the page |

**One fact the resume page settles that changes what criterion 5 compares.** The AI SDK sends no
`Last-Event-ID` and no cursor of any kind - the client issues a plain `GET` and the server replays
what `resumable-stream` buffered. Measured below, the replay starts from the beginning of the run.
That is the same strategy our own reconnect uses, so the two sides are not trading a weaker
mechanism for a stronger one; they are paying different amounts for the same one.

Versions under test: `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `resumable-stream@2.2.12`,
`redis@6.2.1`, `zod@4.4.3`, Node 22.

### The baseline, and the argument for it

**This is the decision that decides the journey, so it is made first and in the open.** § Measured -
TheoKit side already reported that criteria 1 to 3 cost our side nothing, because the scaffold
streams as generated, and it required the Next.js side to be measured from ITS shipped starting
point for the same reason. That starting point is the one J1 chose and defended: `create-next-app`
(TypeScript, App Router, Tailwind), then `npm install ai @ai-sdk/react zod`, then
`app/api/chat/route.ts` and `app/page.tsx` pasted verbatim from the official quickstart's chat
stage, committed untouched. The same commit J1 measured from is the commit J3 measures from
(`dda62f0` in the throwaway repository), so the two journeys cannot be accused of moving the line
between them.

**That baseline already streams**, which is the whole of criteria 1 to 3 on the Next.js side. The
alternative reading - that a bare `create-next-app` is the honest starting point, making the
streaming route handler and the `useChat` page J3's work - is stated as judgement 1 below, because
it is worth more than every other decision in this document combined.

**One formatting control, inherited from J1.** Both commits were formatted with the `create-theokit`
Prettier config (`packages/create-theokit/templates/default/.prettierrc`, `printWidth: 100`,
`semi: false`), so both sides are counted with the same ruler.

### Metrics 1-3, reported per criterion because the journey splits in two

| Metric | TheoKit | Next.js + AI SDK | How it was counted |
| --- | --- | --- | --- |
| Files touched, criteria 1-3 | **0** | **0** | neither side creates, edits or deletes anything to make tokens arrive progressively; both shipped starting points already stream |
| Files touched, criterion 5 | **1** | **5** | ours: `app/hooks/use-transcript.ts`. Theirs: `app/api/chat/route.ts` and `app/page.tsx` edited, `app/api/chat/[id]/stream/route.ts` and `util/chat-store.ts` added, `package.json` gaining two dependencies. `package-lock.json` is excluded as generated |
| Glue lines, criteria 1-3 | **0** | **0** | nothing is written, so nothing is classified |
| Glue lines, criterion 5 | **6** | **53** | this journey declares business logic the empty set, so every non-blank added line is glue. Theirs: 62 added lines less 9 blank |
| Concepts required, criteria 1-3 | **0** | **0** | derived from a diff that does not exist |
| Concepts required, criterion 5 | **3** | **12** | listed in full below |
| Time to first green run | **not measured** | **not measured** | needs a live model call on both sides |

### The diff, published

The same reason both earlier journeys published theirs: the glue split is the metric most open to
being argued after the fact, and a table nobody can check is not evidence. This is `git diff`
between the baseline commit and the J3 commit, verbatim, with the generated lockfile omitted.

```diff
diff --git a/app/api/chat/[id]/stream/route.ts b/app/api/chat/[id]/stream/route.ts
new file mode 100644
--- /dev/null
+++ b/app/api/chat/[id]/stream/route.ts
@@ -0,0 +1,19 @@
+import { UI_MESSAGE_STREAM_HEADERS } from 'ai'
+import { after } from 'next/server'
+import { createResumableStreamContext } from 'resumable-stream'
+import { readChat } from '../../../../../util/chat-store'
+
+export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
+  const { id } = await params
+  const chat = readChat(id)
+
+  if (chat.activeStreamId == null) {
+    return new Response(null, { status: 204 })
+  }
+
+  const streamContext = createResumableStreamContext({ waitUntil: after })
+
+  return new Response(await streamContext.resumeExistingStream(chat.activeStreamId), {
+    headers: UI_MESSAGE_STREAM_HEADERS,
+  })
+}

diff --git a/app/api/chat/route.ts b/app/api/chat/route.ts
@@ -4,10 +4,16 @@ import {
   convertToModelMessages,
   createUIMessageStreamResponse,
   toUIMessageStream,
+  generateId,
 } from 'ai'
+import { after } from 'next/server'
+import { createResumableStreamContext } from 'resumable-stream'
+import { saveChat } from '../../../util/chat-store'

 export async function POST(req: Request) {
-  const { messages }: { messages: UIMessage[] } = await req.json()
+  const { id, messages }: { id: string; messages: UIMessage[] } = await req.json()
+
+  saveChat({ id, activeStreamId: null })

   const result = streamText({
     model: 'openai/gpt-4o-mini',
@@ -15,6 +21,15 @@ export async function POST(req: Request) {
   })

   return createUIMessageStreamResponse({
-    stream: toUIMessageStream({ stream: result.stream }),
+    stream: toUIMessageStream({
+      stream: result.stream,
+      onEnd: () => saveChat({ id, activeStreamId: null }),
+    }),
+    async consumeSseStream({ stream }) {
+      const streamId = generateId()
+      const streamContext = createResumableStreamContext({ waitUntil: after })
+      await streamContext.createNewResumableStream(streamId, () => stream)
+      saveChat({ id, activeStreamId: streamId })
+    },
   })
 }

diff --git a/app/page.tsx b/app/page.tsx
@@ -1,11 +1,20 @@
 'use client'

 import { useChat } from '@ai-sdk/react'
+import { DefaultChatTransport } from 'ai'
 import { useState } from 'react'

+const CHAT_ID = 'j3'
+
 export default function Chat() {
   const [input, setInput] = useState('')
-  const { messages, sendMessage } = useChat()
+  const { messages, sendMessage } = useChat({
+    id: CHAT_ID,
+    resume: true,
+    transport: new DefaultChatTransport({
+      prepareSendMessagesRequest: ({ id, messages }) => ({ body: { id, messages } }),
+    }),
+  })

diff --git a/package.json b/package.json
@@ -14,6 +14,8 @@
     "react-dom": "19.2.8",
+    "redis": "^6.2.1",
+    "resumable-stream": "^2.2.12",
     "zod": "^4.4.3"

diff --git a/util/chat-store.ts b/util/chat-store.ts
new file mode 100644
--- /dev/null
+++ b/util/chat-store.ts
@@ -0,0 +1,14 @@
+export interface Chat {
+  id: string
+  activeStreamId: string | null
+}
+
+const chats = new Map<string, Chat>()
+
+export function readChat(id: string): Chat {
+  return chats.get(id) ?? { id, activeStreamId: null }
+}
+
+export function saveChat(chat: Chat): void {
+  chats.set(chat.id, chat)
+}
```

**The 62 added lines, classified.** Glue: **53**. Business logic: **0** - this journey fixed that in
advance and the diff did not contradict it. Blank: **9**.

By file: the GET handler contributes 15 non-blank lines, the POST handler 16, the page 9, the
persistence module 11, and `package.json` 2.

**The 12 concepts, derived from the diff rather than from opinion.** `resume` on `useChat`;
`DefaultChatTransport`; `prepareSendMessagesRequest`; the stable chat `id` that makes resumption
addressable; `consumeSseStream` on `createUIMessageStreamResponse`; `onEnd` on `toUIMessageStream`;
`generateId`; `after` from `next/server`; `createResumableStreamContext`; the resumable-stream
context API in the two shapes the code uses (`createNewResumableStream` and `resumeExistingStream`,
counted once); the `204 means no active stream` contract; and the `/api/chat/[id]/stream` endpoint
the transport reconnects to by default.

**Our 3, for comparison:** `useAgent`'s `reconnect`, the `status` value that is supposed to report
the drop, and React's `useEffect`.

### Counting judgements, stated rather than buried

Six, each with the effect of deciding it the other way. The first one decides the journey.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | **Is the quickstart's chat stage a baseline, or is it J3's work?** A bare `create-next-app` has no chat, no route handler and no client. Everything that makes tokens arrive progressively on that side is code somebody typed | **Baseline.** It is official example output committed untouched, which `../dx-benchmark.md` § The four metrics excludes on both sides, and it is the structural mirror of what `create-theokit` hands the developer. J1 made this exact call and defended it; changing it here, in the journey where it happens to pay, is the failure § Why the protocol comes before the measurement was written to stop | Next.js would be charged roughly 2 files and 25 lines for criteria 1-3 against our 0, and TheoKit would win metric 1 and metric 2 by a factor with no denominator. **This single decision is worth more than every other line in this document**, and it is decided against us |
| 2 | Does the chat store belong to J3 at all? Persisting which stream is active is storage, and storage is J4's subject | **Counted, and kept minimal.** The official example's store also holds the message history; ours holds only `activeStreamId`, which is the least that criterion 5 requires. Charging Next.js for J4's thread store inside J3 would double-count | Files 5 to **4**, glue 53 to **42**. Still a large gap, and still counted the smaller way |
| 3 | Does `package.json` count as a file touched, given J1 decided that installing `zod` did not belong to J1? | **Counted.** J1's reasoning was that the quickstart installs its three dependencies before the tool exists, so they sit in the baseline. Here `resumable-stream` and `redis` exist only because criterion 5 does | Files 5 to **4**, glue 53 to **51** |
| 4 | `package-lock.json` | **Excluded** as generated output nobody edited | Files 5 to **6** |
| 5 | Are `createNewResumableStream` and `resumeExistingStream` one concept or two? | **One** - two methods of the same object, learned together | Concepts 12 to **13** |
| 6 | Does Redis count as a concept? It never appears in the diff, and the application cannot start without it | **No.** The metric says *named things a reader must know to understand the code*, and Redis is not in the code. It is recorded as an asymmetry below instead | Concepts 12 to **13**, and the asymmetry section loses its sharpest item |

## What the criteria actually do - measured with an instrument, on both sides

**This is the part of J3 that a diff cannot answer**, and § What resisted an oracle already said why:
a proxy that buffers, an adapter that accumulates, a client that paints once - all of them produce
the right final text. So criteria 1 to 3 were run, with timestamps, at a client.

**The instrument.** A model that emits eight text deltas 120 ms apart, and a client that records the
arrival time of every network chunk it reads off `response.body`, plus the moment the stream
terminates. On the Next.js side the model is the SDK's own `MockLanguageModelV4` driven by
`simulateReadableStream({ chunkDelayInMs: 120 })`; on ours it is a generator with the same shape
feeding the framework's real SSE encoder
(`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:47`) through the framework's
real production writer (`packages/theo/src/server/http/node-web-adapter.ts:76`, one `res.write` per
source chunk at `:82`) - the same function both `theo dev`
(`packages/theo/src/vite-plugin/agent-middleware.ts:334`) and `theo start`
(`packages/theo/src/cli/commands/start/handlers.ts:377`) call, so dev and production cannot drift
apart here. Three runs per row, on the same machine, same run length.

| Path measured | Network chunks | Text-bearing chunks | Gap between the first two | Headers at | First text chunk at | Completed at | first / completion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TheoKit, production Node writer | 9 | 8 | 120-122 ms | 182-224 ms | 295-330 ms | 1141-1178 ms | **0.26 ± 0.01** |
| TheoKit, through `createWebShim` | **1** | 1 | none - there is no second chunk | 1119-1143 ms | 1119-1144 ms | 1120-1145 ms | **0.999** |
| Next.js, `next build` + `next start` | 13 | 8 | 120-121 ms | 33-60 ms | 274-304 ms | 1363-1396 ms | **0.21 ± 0.01** |

**The middle row is the buffered failure mode criterion 1 was written to catch, reproduced.** 659
bytes in a single chunk, arriving in the same millisecond the run ends. It is not an inference from
reading `packages/theo/src/adapters/web-shim.ts:157`, where the chunks accumulate, and `:194`, where
the `Response` is finally constructed - it is that code observed doing it. Six adapters emit a
handler built on that shim: AWS Lambda (`packages/theo/src/adapters/aws-lambda.ts:173`), Vercel
(`packages/theo/src/adapters/vercel.ts:76`), Netlify (`packages/theo/src/adapters/netlify.ts:62`),
Cloudflare (`packages/theo/src/adapters/cloudflare.ts:148`), Deno Deploy
(`packages/theo/src/adapters/deno-deploy.ts:77`) and Bun
(`packages/theo/src/adapters/bun.ts:103`). Filed as usetheokit/theokit#382, which also records that
two of the six buffer a *second* time in their own emitted contract
(`packages/theo/src/adapters/vercel.ts:86`, `packages/theo/src/adapters/aws-lambda.ts:142`), so
repairing the shim alone will not make those two stream.

**Criterion 5 was run too, on both sides, and the result is not what either side's source suggested.**

On the Next.js side, against a live Redis: the POST was cut after six chunks, having received
`Alpha Bravo Charlie Delta`; the reconnect `GET` returned 200 with `content-type: text/event-stream`
and replayed **the whole run from the beginning**, `Alpha` onward; once the run had finished the same
endpoint returned 204. So `resumable-stream` does not resume from the cut either - it replays and
lets the client's id-keyed message reassembly absorb the repetition, which is exactly what our own
run event cache does (`tests/integration/http-transport-reconnect.test.ts:78` asserts the replayed
frames carry the run's real deltas). The mechanisms are the same; the price is 53 lines against 6.

On our side, the run was cut the same way and the result is worse than a price. A server that closes
the connection cleanly in the middle of a run - no `finish` chunk, no `[DONE]` - leaves the client
store in `'done'`, not `'error'`:

```json
{ "statusTransitions": ["streaming", "done"], "finalStatus": "done", "error": null,
  "textReceived": "Half an ans", "criterion5TriggerWouldFire": false }
```

`packages/agents/src/client/agent-client.ts:216` sets `'done'` whenever the chunk consumer returns
normally, and stream exhaustion returns normally. The six lines this journey counted watch for
`'error'`, so they never fire; the truncated answer is displayed as finished and, at `:230`,
committed to history as finished. Filed as usetheokit/theokit#384 - the same defect family as #379,
which closed today for a run truncated by a step ceiling rather than by a socket.

**And even with the status corrected, reconnect cannot survive a reload.** `HttpTransport` keeps the
run id in an in-memory instance field (`packages/agents/src/client/http-transport.ts:54`, assigned
at `:100`) and returns `null` when it is absent (`:107`). A reloaded page constructs a new transport,
so the run the server still holds is unreachable. The Next.js side keys the same lookup by a chat id
the server persists, which is what its extra 47 lines buy.

## The two sides compared

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched (criteria 1-3) | 0 | 0 | neither | 1.0x | **Tie** - both are zero, and § The four metrics is why: neither side edits scaffolder output |
| Files touched (criterion 5) | **1** | 5 | TheoKit | 5x | outside the bar, **on a criterion TheoKit does not satisfy** |
| Glue lines (criterion 5) | **6** | 53 | TheoKit | 8.8x | outside the bar, same caveat |
| Concepts required (criterion 5) | **3** | 12 | TheoKit | 4x | outside the bar, same caveat |
| Time to first green run | not measured | not measured | - | - | not applicable |

**J3 is not won.** Every number in that table favours us by a margin outside the 2x bar, and the
verdict is still not a win, because the rows that carry the margin price an implementation that was
run and does not work. J5 already fixed the rule this depends on: *"the honest entry for them is
'no path', never '0 lines'"*. Six glue lines whose trigger never fires are the same kind of entry -
a cost paid for a criterion that stays unsatisfied - and reporting 8.8x from them would be the exact
failure § What counts as winning names.

**So the countable metrics do not resolve this journey, and saying so is the result.** They resolve
into a tie where both sides are zero, and into a comparison of unlike things where they are not. The
criteria are what separates the two sides here, and they separate them the other way:

| Criterion | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| 1 - first text chunk before the run terminates | **PASS** on the served path, measured (9 chunks, first text at 0.26 of the run). **FAIL** through the deploy shim (1 chunk) | **PASS**, measured on `next build` + `next start` |
| 2 - two text chunks at least 50 ms apart | **PASS** on the served path (8 chunks, 120-122 ms apart). **FAIL** through the shim | **PASS** (8 chunks, 120-121 ms apart) |
| 3 - time-to-first-chunk at most half of completion | **PASS** on the served path (0.26). **FAIL** through the shim (0.999) | **PASS** (0.21) |
| 4 - the same holds behind the deployed adapter | **FAIL**, twice over. No adapter serves an agent at all - the string `agent` appears zero times across all fourteen files in `packages/theo/src/adapters/` (usetheokit/theokit#367) - and the shim buffers whatever does reach it (usetheokit/theokit#382) | **PASS** on the self-hosted Node adapter, measured. Not measured on the vendor's own platform, which no account here can reach |
| 5 - reconnect resumes with no duplicate text | **FAIL**, measured. The drop settles as `'done'`, so the wired reconnect never fires (usetheokit/theokit#384); and the run id does not survive a reload | **PASS**, measured against a live Redis: replay from the start, 204 when idle, duplication absorbed by id-keyed reassembly |
| 6-8 - Web, Tauri, TUI | **not exercisable here** - `@theokit/tui` and `@theokit/ui` live outside this repository | **not applicable** - a route handler serves one target |

**Where the comparison is not apples to apples.** Named rather than adjusted for:

- **Redis.** The Next.js criterion-5 implementation cannot start without an external Redis; ours
  needs nothing beyond the framework. That is a real operational difference, it costs the other side
  a dependency this document declined to count as a concept (judgement 6), and it is worth strictly
  less than the fact that their version works and ours does not.
- **Three targets against one.** Criteria 6 to 8 exist on our side and have no counterpart on
  theirs. They are ungraded here, so the comparison silently gives that dimension away, exactly as
  J1 recorded.
- **Adapters.** Criterion 4 grades each side on the adapter it actually ships. Theirs was measured on
  the self-hosted Node adapter, not on the platform its vendor operates; ours has no adapter that
  serves an agent to measure. Neither figure is a claim about the other's platform.
- **The two encoders are still two.** § Current state and blockers found a second SSE encoder
  (`packages/agents/src/bridge/agent-sse-handler.ts:21`) reachable only through the agents plugin's
  route generator (`packages/agents/src/bridge/agent-route-generator.ts:58`). Every run measured here
  used the durable encoder, and the two wires are not mutually parseable: the durable one frames
  `id: <seq>` and terminates with `data: [DONE]`
  (`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:33`, `:66`), the other
  frames `event: <type>` and terminates with nothing.

### What is still unmeasured, and why

**Metric 4 (time to first green run) needs a live model call**, at least three times, cold cache, on
both sides. Nothing in the reading above depends on it, and the winning rule already fails ahead of
it.

**Neither side was run against a real model, and on our side that is not a choice.** There is no mock
seam that reaches the served path. `.model()` accepts `string | ModelSelection` and nothing else
(`packages/agents/src/bridge/agent-builder.ts:143`), `ModelSelection` is pure data, and no
`LanguageModel` object can be handed to an agent anywhere in the tree. The one injection point that
does exist, `createRunFactory` (`packages/agents/src/theokit-plugin.ts:48`), belongs to the agents
plugin and feeds the *second* encoder through
`packages/agents/src/bridge/agent-route-generator.ts:58` - a wire the client's stream consumer cannot
read. So the framework's own served path cannot be exercised without a model key, and that is a
missing seam rather than an unspent budget. The Next.js side has `MockLanguageModelV4` in the box,
which is how its criteria 1-3 were run.

**Criterion 4 was measured at the shim, not at a deployed target.** Nothing was deployed to Vercel,
Netlify, Cloudflare, Deno, Bun or Lambda. What was measured is the code every one of those six
handlers is built on, and what it does to a stream. A deploy would strengthen the evidence and could
not change the direction of it, since a buffered body cannot become progressive downstream.

**Criteria 6 to 8 cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it. What settles them is the north-star app,
which does not exist yet.

**Neither application is committed.** `../dx-benchmark.md` § Evidence asks for both implementations
under `docs/program/evidence/jN-<journey>/`; that directory still does not exist, and this
measurement did not create it. Recorded as an open gap, the same way J1 recorded it.

### The correction to the TheoKit half, recorded rather than substituted

§ Measured - TheoKit side above is left standing as the record of what was true when it was written,
and two of its statements did not survive being run. Both are listed here rather than edited into
that section, because a measurement that quietly repairs its own earlier text cannot be audited.

1. It reported criterion 5 as costing 1 file and 6 glue lines. Those lines exist and are counted
   correctly; what was not known then is that their trigger never fires
   (usetheokit/theokit#384), so the criterion is not satisfied at any price. Its own judgement 1 -
   *"A capability nobody invokes is not a satisfied criterion, so the wiring is counted"* - applies
   one level further down than it reached: the wiring is there and still invokes nothing.
2. It recorded criterion 4 as "neither passed nor failed here - it is untouched". It is now failed,
   for a reason that section did not have: the shim's buffering was measured, and the deeper
   blocker is that no adapter serves an agent at all.

Its third open item is now closed: the measured runs all used the durable encoder, so that is the
one a benchmark run exercises.
## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. The break for J3 is a
**client that consumes the response as a whole body** — calling the JSON/text accessor on a
`text/event-stream` response instead of reading it as a stream. It is the most common real mistake
and the one where a good error saves the most time.

| | |
| --- | --- |
| Names the action | `this endpoint returns text/event-stream; reading it as a whole body buffers the run. Consume it with the agent client, or read response.body as a stream.` — names the content type, the consequence, and both ways out |
| Does not name the action | `Unexpected token 'd', "data: {"ty"... is not valid JSON` — technically the truth, and it points at the parser rather than at the decision |

A second break is recorded in the same transcript because criterion 4 exists for it: **a deploy
adapter whose handler buffers.** The message that names the action reads like
`adapter "netlify" buffers the response body; this route declares streaming. Choose a streaming-capable target or remove the streaming declaration.`
The message that does not name it is the current behaviour under the shim — no error at all, a
correct answer, arriving all at once. That silent case is graded as **fail**, per the rule J8
establishes: an absent error on a wrong outcome is worse than an unhelpful one.

## Current state and blockers

Measured against the working tree on 2026-08-20; every claim is read from source.

**Nothing blocks J3 at the framework layer. Criterion 4 has a known live blocker at the adapter
layer, and it is deliberately inside the journey rather than excused from it.**

What is wired end to end:

- The server mounts an agent as an SSE endpoint (`packages/theo/src/server/agent/mount-agent.ts:98`),
  called from the dev middleware (`packages/theo/src/vite-plugin/agent-middleware.ts:329`) and from
  the production server (`packages/theo/src/cli/commands/start/handlers.ts:372`).
- The response is `text/event-stream` with per-frame monotonic ids
  (`packages/theo/src/server/agent/durable-ui-message-stream-response.ts:22`, frame builder at
  `:33`, response at `:47`), which is what makes reconnect possible at all.
- Chunks are produced by a shared presenter rather than a per-target encoder
  (`packages/presenter/src/presenters/ui-message-stream.ts:45`, text deltas at `:140`), reached
  through the generator at `packages/agents/src/bridge/present-ui-message-stream.ts:144`.
- The client reads it as a stream, not a body
  (`packages/agents/src/client/http-transport.ts:79`, decode at
  `packages/agents/src/client/consume-ui-message-stream.ts:44`), and the React binding subscribes to
  a store rather than re-rendering per token
  (`packages/agents/src/client/use-agent.ts:113`).
- Reconnect exists and is a real route (`packages/theo/src/server/agent/handle-agent-run-reconnect.ts:38`,
  `Last-Event-ID` at `:31`), which is what criterion 5 grades.

**The one finding that will shape the measurement: there are two SSE encoders in the tree, emitting
different event shapes.** The production path uses the durable one above; a second encoder
(`packages/agents/src/bridge/agent-sse-handler.ts:21`) is reachable only through the agents plugin's
route generator (`packages/agents/src/bridge/agent-route-generator.ts:58`), which has no caller
inside `packages/theo/src`. The benchmark must record which encoder the measured build used, because
a reader comparing two runs across the two encoders would be comparing two protocols.

**Not measured:** whether criterion 5's reconnect actually resumes without duplication under real
loss. The route and the header parsing were read; a lossy run was not performed. Recorded as a
measurement to make during implementation, not as a claim.

## Metric 4 — measured 2026-08-21, and it does not go the way J9's did

Metric 4 was unmeasured on this journey, and § What counts as winning does not treat it as optional:
a journey is won when TheoKit is better on the three countable metrics **and not worse on
time-to-green**, tested by non-overlapping intervals at ±1σ over ≥ 3 runs. Three runs per lane,
alternating lane by lane so machine drift falls on both columns:

| | Next.js | TheoKit |
| --- | --- | --- |
| install | 4.47 ± 0.50 | 4.67 ± 0.93 |
| build | 9.00 ± 1.01 | **4.80 ± 0.26** |
| start | 0.60 ± 0.00 | 1.10 ± 0.00 |
| **total, mean ± 1σ** | **14.00 ± 1.45** → [12.55, 15.45] | **10.53 ± 1.21** → [9.33, 11.74] |

**The intervals do not overlap and TheoKit is the faster side**, so the "not worse" clause is
satisfied — the clause asks only for *not worse*, and this is better. Recording it as a win on
metric 4 would be reading a clause that is not there.

**Install is level, 4.67 s against 4.47 s.** That is the fact J9's measurement could not show,
because J9's two trees were not symmetric: its Next.js lane installed from a `package-lock.json` and
its TheoKit lane re-resolved the whole graph on every run. With a lock on both sides — which is what
both scaffolders write — the 15.4 s install gap J9 reported does not appear here at all. The whole
difference on this pair is build, and it goes to TheoKit.

**Two things this measurement is not.** The npm cache was warm and was not cleared, so these numbers
are comparable to each other and not to a first-ever install; no measurement in this programme has
ever timed a cold cache, which is where a new developer actually stands. And **the TheoKit lane does
not carry J3's own delta** — no surviving tree does, so what was timed is the scaffold this journey
starts from, against a Next.js lane carrying its full delta including `resumable-stream` and `redis`.
The delta is 1 file and 6 glue lines and adds no dependency, but it is a gap, and it is the reading
most favourable to TheoKit that the surviving trees permit. Both are recorded in
[the evidence file](../evidence/j03-metric4-2026-08-21.txt).

**The verdict does not move.** J3 is still not won, and metric 4 was never what held it open: the
three countable margins price six lines whose trigger never fires (usetheokit/theokit#384), and the
criteria go 5–3 to Next.js. What changes is the reason — this journey's fourth clause is now
measured and satisfied, so the only thing standing between J3 and a win is the thing the criteria
describe actually working.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The milestone whose blocker criterion 4 inherits: `../../../ROADMAP.md` § M14
- The journey that streams the same run to a terminal: `j10-deploy.md` for the target, `j01-tool.md` for the run
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
