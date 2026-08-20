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

## Re-measured — both sides, metrics 1-3, and the five criteria exercised in a browser (2026-08-20)

**The section above is left standing as the record of what was true when it was written, and its central
finding did not survive being run.** It reported criterion 1 as having *no implementable path* and the
journey as "not won, not tied, and not run". Re-measured hours later against the same framework, in a real
browser, against a real run: **all five of the journey's web criteria pass on both sides**, and TheoKit's
cost is 4 files and 59 glue lines against Next.js's 5 and 74. The correction is recorded here rather than
edited into that section, because a measurement that quietly repairs its own earlier text cannot be audited.

What changed is not the framework — `readonly #chatId = crypto.randomUUID()` is still a field initializer
(`packages/agents/src/client/agent-client.ts:117`) and `AgentClientOptions` still carries only an emit
interval (`packages/agents/src/client/agent-client.ts:105`). What changed is that a second seam was found.
It is named in § The seam the earlier half missed, and it is the whole difference between "no path" and a
number.

### Versions and commits under test

| Side | Under test |
| --- | --- |
| TheoKit | worktree at `98fb281a2` on `workspace` for every source claim. The measured app runs the **published** packages a scaffolded app installs today: `create-theokit@1.23.8`, `theokit@0.48.14`, `@theokit/agents@10.1.0`, `@theokit/sdk@4.53.1` (real, not mocked), `@theokit/ui@1.4.1`, `zod@4.4.3`, React 19.2.8, Node 22.22.2 |
| Next.js | `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`, `zod@4.4.3`, React 19.2.8, Node 22.22.2 — the same set J1, J3, J5, J6 and J9 measured against. `tsc --noEmit` is clean on the finished app |
| The model | one local server on Ollama's port, byte-identical for both sides — see § The instrument |

Both apps were driven through a real Chrome, with real reloads and a real storage clear. Nothing below is
read from source where a run could settle it, and where a run could not, the paragraph says so.

### The version-specific facts, confirmed against the source

§ The Next.js side deferred three questions to implementation time. All three were read rather than
remembered, and **all three diverged** — which is the highest divergence rate this programme has recorded,
and the reason the protocol defers them instead of asserting them.

| Deferred question | Answer | Read from | Diverged from the supposition? |
| --- | --- | --- | --- |
| Which persistence layer does the current official template use? | Neither a database nor the chat template. The AI SDK publishes a **dedicated persistence guide** whose store is a directory of JSON files (`.chats/<id>.json`), written with `node:fs` | the *Chatbot Message Persistence* guide, shipped byte-identical inside `ai@7.0.70` under `docs/04-ai-sdk-ui/` | **Yes.** The section supposed "the official chat template, which already carries a database". The right official source for this journey is a guide, not a template — and per J1's precedent the `vercel/chatbot` template is rejected anyway, as a product rather than scaffolder output |
| What is the current name of the callback that fires when a run finishes? | `onEnd`, on `toUIMessageStream`'s options. `onFinish` still exists on the same options object and is marked `@deprecated Use `onEnd` instead` | the installed `ai@7.0.70` type declarations — the `toUIMessageStream` options object, which declares both | **Yes.** The section supposed `onFinish`. Writing it would have compiled, run, and been deprecated |
| Does the template's message schema already cover criterion 5's second-thread case? | The store does — one file per chat id, so two threads never share a file. The **message ids do not**, until a second thing is added: see the row below | the guide plus two runs | **Yes**, and in the direction that costs the Next.js side lines |

**A fourth fact nobody thought to defer, and it is the one that decides criterion 5.** The guide's main
route-handler block, pasted verbatim, persists every assistant message with `id: ""`. The declaration says
so plainly — *"If not provided, no message ID will be set for the response message"*
(the `generateMessageId` doc comment in the installed `ai@7.0.70` declarations) — and the run confirmed it: two threads created that way
have ids `['VhZ…', '', 'HGb…', '']` and `['XB1…', '']`, whose set intersection is `{''}`, not empty. J4's
criterion 5 is graded by set intersection over message ids, so the naive recipe **fails it**. The fix is on
the same documentation page, three sections down (§ Message IDs → Option 1, `generateMessageId:
createIdGenerator({ prefix: 'msg', size: 16 })`), and the page is explicit that it is required rather than
optional: *"for persistence, you should use IDs that are stable before messages are stored"*. It is
therefore part of the official example, and it is counted.

### The baselines, declared

**TheoKit.** The output of the **published scaffolder**, `npx create-theokit@latest tk-thread --yes
--use-pnpm --disable-git`, committed untouched. This departs from the convention J9 recorded — copying
`packages/create-theokit/templates/default/` by hand with the three renames — and the departure is
deliberate: this journey needed the app to *run*, which needs an install, and running the real scaffolder
is what a developer does. The two are almost the same tree; `diff -r` over them reports one substantive
difference, `server/routes/health.ts`, which the worktree has grown a `.policy('public')` line the
published 1.23.8 template does not have. That difference is charged in judgement 3 rather than hidden.

Getting the baseline to install at all took two steps that are **not** journey work and are counted on
neither side: replacing the `pnpm-workspace.yaml` that pnpm writes on a failed run (it contains the literal
string `set this to true or false` where a boolean belongs) with `allowBuilds: {esbuild: true, node-pty:
true}`, and re-running `pnpm install`. Both are consequences of a scaffolder defect filed as
usetheokit/theokit#397.

**Next.js.** The same three-commit ladder J1 declared, minus the rung this journey does not need:
`create-next-app` (TypeScript, App Router, Tailwind) plus `npm install ai @ai-sdk/react zod`, then the AI
SDK Next.js App Router quickstart's chat stage pasted verbatim from
the quickstart shipped inside `ai@7.0.70` under `docs/02-getting-started/`. Both commits are **uncounted**. J1's
and J5's tool commits are *not* laddered onto here, because J4 registers no tool and the TheoKit side
starts from a bare scaffold too — the asymmetry J9 named and resolved the same way.

The quickstart ships its route handler with `__PROVIDER_IMPORT__` / `__MODEL__` placeholders that the docs
site substitutes. Resolved to the gateway string form, `model: 'openai/gpt-5-mini'` with no provider
import, which is what the persistence guide on the same site uses.

**One formatting control**, unchanged from J1: both diffs are formatted with the `create-theokit` Prettier
config (`packages/create-theokit/templates/default/.prettierrc`, `printWidth: 100`, `semi: false`), so both
sides are counted with one ruler. All nine measured files are `prettier --check` clean under it.

### The seam the earlier half missed

The earlier half stopped at "there is no endpoint that returns past messages", which is true, and
concluded that reading history back "would mean inventing a reader over the SDK's own transcript, whose
format lives outside this repository". That second step is what did not hold. The format is re-exported by
**this** repository, typed and named:

```
packages/agents/src/persistence-entry.ts:19
export {
  … loadJsonl, … transcriptPath, transcriptRoot, …
} from '@theokit/sdk/persistence'
```

along with `TranscriptMessage` and `TranscriptBlock` as types (`packages/agents/src/persistence-entry.ts:55`),
and the subpath `./persistence` is public on the package a scaffolded app already depends on. So a history
endpoint is an ordinary `route()` in `server/routes/`, reading the file the framework itself wrote at
`resolveSessionBaseDir`'s path (`packages/theo/src/server/agent/mount-agent.ts:279`).

That is the entire difference between the two halves of this page. Criterion 1 was never blocked; it was
unfound. The correction has been posted to usetheokit/theokit#364, which stays open for the narrower and
still-true reason: the identity workaround is ceremony an application should not have to write.

### Metrics 1-3

| Metric | TheoKit | Next.js + AI SDK | Better | Ratio | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | **4** | 5 | TheoKit | 1.25x | inside the 2x bar — **tie** |
| Glue lines | **59** | 74 | TheoKit | 1.25x | inside the 2x bar — **tie** |
| Concepts required | **13** | 13 | neither | 1.0x | level — **tie** |
| Time to first green run | not measured | not measured | — | — | see § What is still unmeasured |
| Criteria satisfied | **5 of 5** | **5 of 5** | neither | — | not a countable metric, and the most important line |

Counted with `git diff --cached -M --numstat` over each side's baseline commit. Added lines total 62 on
ours and 84 on theirs; the glue figures subtract blank lines (3 and 10) and, per the rule this page fixed
in advance, add doc comments to glue rather than excluding them.

### The two diffs, published

Published because the glue split is the metric most open to being argued after the fact, and a table
nobody can check is not evidence — least of all one published by the side it favours.

**TheoKit — 4 files, 62 added, 3 removed.**

```ts
// app/lib/thread-id.ts (new, 10)
/** The thread id, kept in the URL so it survives both a reload and a cleared browser store. */
export function currentThreadId(): string {
  const url = new URL(window.location.href)
  const pinned = url.searchParams.get('thread')
  if (pinned !== null && pinned.length > 0) return pinned
  const minted = crypto.randomUUID()
  url.searchParams.set('thread', minted)
  window.history.replaceState(null, '', url)
  return minted
}
```

```ts
// app/lib/pinned-transport.ts (new, 10)
import { HttpTransport, type AgentTransport } from 'theokit/client'

/** The client mints its own chat id and takes none (usetheokit/theokit#364) — pin it at the seam. */
export function pinnedTransport(api: string, threadId: string): AgentTransport {
  const inner = new HttpTransport({ api })
  return {
    sendMessages: (options) => inner.sendMessages({ ...options, chatId: threadId }),
    reconnectToStream: (options) => inner.reconnectToStream(options),
  }
}
```

```ts
// server/routes/thread-history.ts (new, 27)
import { loadJsonl, transcriptPath, type TranscriptMessage } from '@theokit/agents/persistence'
import { route } from 'theokit/server/define'
import { z } from 'zod'

/** Where `mountAgent` roots this app's SDK transcript. */
const SESSIONS = `${process.cwd()}/.data/agent-sessions`

export const GET = route()
  .query(z.object({ thread: z.string().min(1) }))
  .handler(({ query }) => {
    let rows: { uuid: string; message?: TranscriptMessage }[] = []
    try {
      rows = loadJsonl(transcriptPath(SESSIONS, process.cwd(), query.thread))
    } catch {
      /* no transcript for this thread yet */
    }
    return {
      messages: rows
        .filter((row) => row.message !== undefined)
        .map((row) => ({
          id: row.uuid,
          role: row.message?.role,
          parts: (row.message?.content ?? []).filter((block) => block.type === 'text'),
        })),
    }
  })
  .build()
```

```diff
--- a/app/hooks/use-transcript.ts   (edited, +15 -3)
+++ b/app/hooks/use-transcript.ts
 import { type UIMessage } from '@theokit/ui'
+import { useEffect, useMemo, useState } from 'react'
 import { useAgent } from 'theokit/client'

 import { GREETING } from '../lib/constants'
+import { pinnedTransport } from '../lib/pinned-transport'
+import { currentThreadId } from '../lib/thread-id'
@@
 export function useChatTranscript(): ChatTranscript {
-  const { thread, send, status, reset, error } = useAgent<{ message: string }>('/api/agents/chat')
+  const threadId = useMemo(() => currentThreadId(), [])
+  const transport = useMemo(() => pinnedTransport('/api/agents/chat', threadId), [threadId])
+  const [past, setPast] = useState<UIMessage[]>([])
+  useEffect(() => {
+    fetch(`/api/thread-history?thread=${encodeURIComponent(threadId)}`)
+      .then((r) => r.json())
+      .then((data: { messages: UIMessage[] }) => setPast(data.messages))
+      .catch(() => setPast([]))
+  }, [threadId])
+  const { thread, send, status, reset, error } = useAgent<{ message: string }>(transport)
   return {
-    thread: [GREETING, ...thread],
+    thread: [GREETING, ...past, ...thread],
     isStreaming: status === 'streaming',
     hasError: status === 'error',
     error,
-    onlyGreeting: thread.length === 0 && status !== 'streaming',
+    onlyGreeting: past.length === 0 && thread.length === 0 && status !== 'streaming',
     sendMessage: (text) => send({ message: text }),
     reset,
   }
```

**Next.js — 5 files, 84 added, 5 removed.** `util/chat-store.ts`, `app/chat/page.tsx` and
`app/chat/[id]/page.tsx` are the official guide's files, pasted verbatim and reformatted with the TheoKit
Prettier config; only the route handler and the chat component are shown as diffs, because they are the
only two the guide does not hand over whole.

```ts
// util/chat-store.ts (new, 45) — the guide's file store, verbatim: createChat / getChatFile /
// loadChat / saveChat, including its chat-id regex and its resolved-path containment check.
// app/chat/page.tsx (new, 7) — createChat() then redirect(`/chat/${id}`), verbatim.
// app/chat/[id]/page.tsx (new, 8) — an async server component: await props.params, loadChat(id),
// render <Chat id initialMessages>, verbatim.
```

```diff
--- a/app/api/chat/route.ts   (edited, +15 -2)
+++ b/app/api/chat/route.ts
   convertToModelMessages,
+  createIdGenerator,
   createUIMessageStreamResponse,
   toUIMessageStream,
 } from 'ai'
+import { saveChat } from '@/util/chat-store'

 export async function POST(req: Request) {
-  const { messages }: { messages: UIMessage[] } = await req.json()
+  const { messages, id }: { messages: UIMessage[]; id: string } = await req.json()
@@
   return createUIMessageStreamResponse({
-    stream: toUIMessageStream({ stream: result.stream }),
+    stream: toUIMessageStream({
+      stream: result.stream,
+      originalMessages: messages,
+      // Generate consistent server-side IDs for persistence:
+      generateMessageId: createIdGenerator({
+        prefix: 'msg',
+        size: 16,
+      }),
+      onEnd: ({ messages }) => {
+        saveChat({ chatId: id, messages })
+      },
+    }),
   })
 }
```

```diff
--- a/app/page.tsx   (renamed to ui/chat.tsx, +9 -3)
+++ b/ui/chat.tsx
-import { useChat } from '@ai-sdk/react'
+import { UIMessage, useChat } from '@ai-sdk/react'
 import { useState } from 'react'

-export default function Chat() {
+export default function Chat({
+  id,
+  initialMessages,
+}: { id?: string | undefined; initialMessages?: UIMessage[] } = {}) {
   const [input, setInput] = useState('')
-  const { messages, sendMessage } = useChat()
+  const { messages, sendMessage } = useChat({
+    id, // use the provided chat ID
+    messages: initialMessages, // load initial messages
+  })
```

### The added lines, classified

| Class | TheoKit (62) | Next.js (84) |
| --- | --- | --- |
| Glue | **59** | **74** |
| Business logic | 0 | 0 |
| — of which doc comments, counted as glue | 4 | 3 |
| Blank | 3 | 10 |

Business logic is the empty set on both sides, as this page fixed in advance: J4 changes no answer. The
counting rule also fixed that neither side may call its own persistence code business logic, and this time
it had something to bite on — both sides write persistence code, and both had it counted as glue.

Per file: ours is 10 / 10 / 15 / 27 (`thread-id`, `pinned-transport`, `use-transcript`, `thread-history`);
theirs is 45 / 15 / 9 / 8 / 7 (`chat-store`, `route`, `chat.tsx`, `[id]/page`, `chat/page`). The single
largest file on either side is the AI SDK's own chat store, and the single largest on ours is the history
route that reads a store we did not have to write.

### The concepts, derived from the diffs

Thirteen each, enumerated so the count can be argued with rather than believed.

| # | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| 1 | `useMemo` | `UIMessage` |
| 2 | `useEffect` | `useChat`'s `id` option |
| 3 | `useState` | `useChat`'s `messages` (initial) option |
| 4 | `HttpTransport` | `redirect` (`next/navigation`) |
| 5 | `AgentTransport` | the `[id]` dynamic route segment |
| 6 | `chatId` on `sendMessages` options | `params` as a Promise to await |
| 7 | `useAgent(transport)` — the transport binding, with its memoize-before-passing rule | the async Server Component (a page that awaits on the server) |
| 8 | `route()` from `theokit/server/define` | the `@/` import alias |
| 9 | `.query()` + `zod` | `generateId` |
| 10 | `loadJsonl` | `createIdGenerator` |
| 11 | `transcriptPath` | `originalMessages` |
| 12 | `TranscriptMessage` | `onEnd` |
| 13 | `.data/agent-sessions` — the transcript root the app has to name | `generateMessageId` |

Platform APIs are excluded on both sides, inheriting judgement 2 of the section above: `URL`,
`crypto.randomUUID`, `history.replaceState` and `fetch` on ours, `node:fs`, `fs/promises` and `path` on
theirs. Counting them gives 17 and 16, and starts measuring the runtime rather than the framework.

### The instrument, and why this journey could be run without credits

**The model.** `@theokit/sdk@4.53.1` ships an `ollama` provider profile with `authType: "none"` and
`baseUrl: "http://localhost:11434/v1"` (`dist/provider-catalog.json`); its native client strips the
trailing `/v1` and speaks Ollama's own `POST /api/chat` NDJSON protocol
(read from the installed `@theokit/sdk@4.53.1`, whose `OllamaNativeClient` normalizes the base URL and
posts to `/api/chat`; it lives outside this repository and therefore carries no `file:line` here). A ~130-line local server on that port answering both that protocol **and** the OpenAI
chat-completions shape at `/v1/chat/completions` is a complete model for both stacks at once: TheoKit
reaches it as `.model('ollama/llama3.2')` through `mountAgent` → `streamAgentUIMessages` → the real SDK,
and Next.js reaches it with `createOpenAICompatible({ baseURL: 'http://127.0.0.1:11434/v1' })` from
`@ai-sdk/openai-compatible@3.0.32`. No key, no credits, no mocked framework on either side.

**And the instrument is the oracle.** The server's reply is a deterministic function of the messages it
received: `SAW <n> USER TURN(S): <their text, joined>`. That is what makes criterion 2 gradeable rather
than assertable — the answer on screen after a reload literally enumerates what the model was given, so
"the renderer has the history" and "the model has the history" cannot be confused. J4's own criteria call
criterion 2 "the criterion a render-from-local-cache implementation fails", and this is the instrument
that fails it.

**One thing the framework needed that the instrument did not provide.** `resolveProvider`
(`packages/theo/src/server/agent/provider-resolver.ts:208`) walks its registry by env priority for a model
id whose prefix it does not know, and `ollama` is not in that registry
(`packages/theo/src/server/agent/provider-resolver.ts:65`), so it throws unless *some* provider variable is
set. `OPENAI_API_KEY=local-instrument` in `.env.local` satisfies it; the value is never used, because the
SDK's ollama client sends no authorization header when the key is empty and the local server ignores it
either way. Recorded because it is a real step a reader would otherwise hit, and because
usetheokit/theokit#398 is about the documented knob that was supposed to make it unnecessary.

**The model swap is uncounted on both sides**, per J6's rule that test scaffolding both sides get is not
part of either diff. On ours it is one edited line in `agents/chat.ts` plus one `.env.local` line; on
theirs it is an 8-line `app/model.ts` plus one edited line in the route.

### The five criteria, graded against the runs

Every row was exercised in Chrome against a running app. Randomized markers are quoted verbatim from the
transcripts.

| # | Criterion | TheoKit | Next.js + AI SDK |
| --- | --- | --- | --- |
| 1 | after a full reload the rendered list has every prior message, in order | **passes.** Before: `remember the code DELTA-90312` / `SAW 1 USER TURN(S): …`. After a document reload, the same two, same order | **passes.** Before: `remember the code JULIET-40915` / `SAW 1 USER TURN(S): …`. Same after reload, rendered server-side by `app/chat/[id]/page.tsx` |
| 2 | the **model** receives the history, asserted by substring match on a value that appeared only before the reload | **passes.** A turn typed *after* the reload — `what was the code?` — was answered `SAW 2 USER TURN(S): remember the code DELTA-90312 \| what was the code?`. The pre-reload marker is in the model's own account of its input | **passes.** Same shape: `SAW 2 USER TURN(S): remember the code JULIET-40915 \| what was the code?` |
| 3 | the identifier sent after the reload equals the one sent before, read from the request | **passes.** Read from disk rather than from the client: both turns landed in one transcript, `.data/agent-sessions/projects/<encoded-cwd>/7897470a-….jsonl`, whose name is the `?thread=` value the URL carried across the reload | **passes.** Both turns landed in `.chats/a6EJxjH4JoeoI4bm.json`, whose name is the `id` the route read out of the request body |
| 4 | history survives clearing all browser storage for the origin | **passes.** `localStorage`, `sessionStorage`, cookies, IndexedDB and the Cache API all cleared, then a cache-ignoring reload: both turns still rendered. The id survives because it is in the URL, which is the reason judgement 3 of the section above chose the URL over `localStorage` | **passes.** Same clear, same reload, same result — the id is a path segment |
| 5 | two threads do not bleed, by set intersection over message ids | **passes.** `['362a…','a024…','e282…','0733…']` against `['78a6…','ff92…']`, intersection empty; the second thread rendered only its own marker `ECHO-55178` | **passes — after the fix on the guide's own page.** With `generateMessageId`: `['EljX…','msg-dvjU…','jcHv…','msg-dc0W…']` against `['PCIc…','msg-yHFn…']`, intersection empty. Without it, the intersection is `{''}` and the criterion fails |
| 6-8 | Web, Tauri, TUI | **Web exercised.** Tauri and TUI **not exercisable here** — they need `@theokit/tui` and `@theokit/ui`, which live outside this repository | **not applicable** — a Next.js app has one target |

### What the fifth metric found, and it is a fifth of something

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. § The deliberately broken state
below predicted both breaks; both were run.

**Break 1 — a thread identifier that changes on reload.** Still not a break anyone has to inject: it is
what the stock scaffold does, because the client mints a fresh id per construction. Run on the untouched
baseline, the result is exactly what that section predicted: a fresh, empty, entirely successful
conversation. No error, no status, no log line. **Fail**, per the rule J8 fixed — a silent wrong outcome
scores fail rather than unmeasurable.

**Break 2 — a thread id that does not exist.** Navigating the finished app to `?thread=th-zzz` renders the
warm greeting and the starter prompts, identical to a new conversation. The server agrees:

```
{"level":"info","method":"GET","url":"/api/thread-history?thread=th-zzz","status":200,"duration":30,…}
```

`200`, `level: info`, nothing to alert on. The same break on the Next.js side raises `ENOENT` from
`loadChat`, which Next surfaces as *"This page couldn't load — A server error occurred"* with a digest, and
logs with the file path and the stack. **Both sides fail this metric, and they fail it in opposite
directions**: theirs names a file rather than an action and is loud; ours names nothing and is silent. Of
the two, silence is the worse failure, and it is the one this repository has now filed six times — after
#379, #384, #382, #388 and #393, this is usetheokit/theokit#399.

Worth stating precisely, because it is not a bug in the app: **no layer can tell an unknown thread from a
new one.** The id is minted on the client and never registered, a transcript is created lazily on the first
turn, and reading a missing transcript raises `ENOENT` identically for "never existed" and "gone". An
application that catches it — as it must, or a legitimately new thread 500s — has discarded the only
distinction available. There is nothing to render "this conversation is no longer available" from.

### Counting judgements, stated rather than buried

Nine. Each is stated with the effect of deciding it the other way. **None of them, taken either way, turns
this journey into a win for TheoKit** — the largest single move is judgement 4, and it moves 9 lines
against a 15-line gap.

| # | The judgement | Decided as | The other way |
| --- | --- | --- | --- |
| 1 | Is the Next.js side charged for re-typing a chat UI it already had? | **No.** The guide's `ui/chat.tsx` is a simplified re-statement of the quickstart page; the measured app moves the existing `app/page.tsx` with `git mv` and edits 9 lines. Charged as a rename | Pasting the guide's component whole is 48 lines instead of 9, taking Next.js to 123 glue and the ratio to 2.08x — outside the bar, and a **win** for TheoKit bought entirely by making the other side re-type working code |
| 2 | Is `generateMessageId` part of the official example, or an addition? | **Part of it.** The same page requires it for persistence, in prose, and without it criterion 5 fails | Excluding it saves Next.js 6 lines (74 → 68) and costs it criterion 5. The metric improves and the journey is lost — which is exactly the trade the protocol forbids reporting as a win |
| 3 | Which TheoKit is measured — the published packages or the worktree? | **Published**, because the app has to run and that is what `create-theokit` installs. Every *source claim* is read from the worktree at `98fb281a2` | On the worktree the route builder requires `.policy(…)` (`packages/theo/src/server/define/route-builder.ts:58`); `theokit@0.48.14` has no such method. Measuring there is +1 glue line and +1 concept for TheoKit: 60 and 14, ratios 1.23x and 1.08x. Still a tie, and now level-or-worse on concepts |
| 4 | Are doc comments glue, or excluded? | **Glue**, following the section above, which listed "the doc comment" among its 24 | Excluding comments gives 55 against 71 — 1.29x, still inside the bar |
| 5 | Is the history route's `.data/agent-sessions` string glue or config? | **Glue.** This page fixed in advance that "any config naming a storage location is glue" on our side and the ORM schema is glue on theirs. Both sides paid | Calling it config on ours and the store's `path.resolve(process.cwd(), '.chats')` config on theirs removes one line from each. Nothing moves |
| 6 | Are React hooks concepts? | **Yes**, three of them, per `../dx-benchmark.md` § The four metrics — *"`useState` is one concept"*. Ours adds `useMemo`, `useEffect`, `useState`; theirs adds none, because its baseline already had `useState` | Grouping them as one "React state hooks" gives 11 against 13, a 1.18x TheoKit lead, still inside the bar. Excluding them entirely gives 10 against 13, 1.3x, still inside |
| 7 | Is the model swap counted? | **No**, on either side — J6's rule that shared test scaffolding is part of neither diff | Counting it adds 2 to ours and 9 to theirs: 61 against 83, 1.36x. It would *widen* our lead, which is why it is worth naming that we declined to take it |
| 8 | Is the `pnpm-workspace.yaml` repair counted against TheoKit? | **No.** It is baseline setup, and the reason it is needed is filed as #397 | Counting it as journey work is +3 lines and +1 file for TheoKit: 5 files against 5, 62 against 74. Files stop being a TheoKit lead at all |
| 9 | Does the `?thread=` query parameter count as an interface change the other side did not make? | **Not counted as anything.** Both sides put the identity in the URL — ours in a query parameter, theirs in a path segment — so the cost is symmetric and already inside the line counts | There is no other way. A `localStorage` id fails criterion 4 on both sides, which the criteria fixed before either implementation existed |

### The verdict

**J4 is a tie, and both sides win it.** Files 4 against 5, glue 59 against 74, concepts 13 against 13 —
1.25x, 1.25x and 1.0x, every one inside the 2x bar `../dx-benchmark.md` § What counts as winning sets. Both
sides satisfy all five of the journey's web criteria, exercised rather than inferred.

That last sentence is the one worth keeping. This is the **first journey in the programme where TheoKit
satisfies every criterion**, and the first where both sides do. J1 and J5 tied with criteria outstanding;
J3, J6 and J9 produced margins for implementations that did not meet the criteria they were meant to serve.
Here the thing the criteria describe was built twice, both times it works, and the cost is level.

It is also the second thing this page has been wrong about in one day, in both directions: the criteria
file predicted the journey "will fail on the first run", and the first measurement reported it as having no
path. Neither held. What the page got right is the asymmetry it named in advance — *"that side pays for a
database and ours pays for identity"* — and the shape survived even though the sizes did not: 45 of the
Next.js side's 84 lines are a store TheoKit did not have to write, and 20 of ours are a reader Next.js did
not have to write because `useChat` takes an `id` and our client does not.

### Where the comparison is not apples to apples

Named rather than adjusted for, because adjusting a count until it evens out is the failure the protocol
was written to prevent.

- **The two stores are not the same store.** Ours is the SDK's own append-only JSONL transcript with a
  `parentUuid` DAG, written by the framework whether the app asks or not; theirs is `JSON.stringify` of the
  whole message array on every turn, into a file the app created. Ours is the more durable artifact and the
  app pays nothing for it. Theirs is 45 lines the app owns and can replace with a database by editing four
  functions. The line counts price the second and not the first, which flatters us.
- **Our app reads history over the network; theirs renders it on the server.** A React Server Component
  ships the messages inside the document; our hook fetches them after mount. That is a real product
  difference the criteria do not grade (they grade *what* is rendered, not *when*), and it costs us a
  `useEffect` and three concepts that a server-rendered equivalent would not need. TheoKit has no server
  component path to compare here.
- **Neither side is authorized.** Both read a conversation by a caller-supplied id with no owner check.
  Ours is a `route()` with no `.policy()` because `theokit@0.48.14` has none; theirs is a page with no
  auth. This is the gap ADR 0001 exists for and #364's second half names, and it is the reason neither of
  these apps is a template for anything shipped.
- **The Next.js baseline had `useState` and ours did not.** Three of our thirteen concepts are React hooks
  their diff did not have to add, because their starting point had already added one. Judgement 6 records
  what happens without them; the honest summary is that concepts are level either way.

### What is still unmeasured, and why

**Metric 4 (time to first green run) was not measured**, by instruction. It is also the metric this
journey would now be able to produce for the first time, since both sides have a green run and neither
needs a live model — three cold-cache runs per side would be an honest number rather than an estimate.
Recorded as available rather than as done.

**The fifth metric's first break was run on the baseline, not on the finished app.** On the finished app it
cannot be run: the whole diff exists to stop the id from changing.

**Neither application is committed** under `docs/program/evidence/j4-thread/`. `../dx-benchmark.md`
§ Evidence asks for both implementations there; that directory still does not exist and this measurement
did not create it. **Open for the sixth time**, after J1, J3, J5, J6 and J9.

**The three-target criteria cannot be exercised in this repository.** The Tauri and TUI lines need
`@theokit/tui` and `@theokit/ui`, which live outside it (`.claude/rules/three-target-parity.md` records the
same limit). What settles them is the north-star app (`.claude/rules/northstar-app.md`), which does not
exist yet.

**Durability under concurrency was not tested on either side.** Two tabs on one thread, a crash mid-write,
a transcript being garbage-collected while a client holds its id — none of it was exercised. The Next.js
store rewrites the whole file per turn and has an obvious interleaving hazard; ours appends and holds a
writer lease it did not have to ask for. Neither claim was tested and neither is made.

**Retention was not measured.** `runTranscriptGC` exists (`packages/agents/src/session/index.ts:36`) and
whether anything schedules it was not read. It decides how often a live thread id becomes the unknown one
#399 is about.

### The five issues this measurement filed

- usetheokit/theokit#395 — agent transcripts land in git: the template ignores `data/`, the framework
  writes `.data/`, and a code comment asserts the protection that is missing
- usetheokit/theokit#396 — the pristine scaffold fails `tsc` again, in `app/hooks/use-transcript.ts`
  against `@theokit/ui@1.4.1`; #80 closed the same class one file over
- usetheokit/theokit#397 — `create-theokit` reports a successful install as a failure, because the template
  declares `onlyBuiltDependencies` where pnpm 10+ no longer reads it
- usetheokit/theokit#398 — `.env.example` documents `LLM_MODEL`, which is read nowhere
- usetheokit/theokit#399 — a lost conversation is indistinguishable from a new one: an unknown thread id
  yields an empty 200 and a warm greeting

And one correction posted rather than filed: usetheokit/theokit#364's claim that no supported path exists
is refuted, and the issue stays open for the narrower reason.

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
