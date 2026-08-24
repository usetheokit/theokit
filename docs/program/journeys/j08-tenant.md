# J8 — Tenant

The eighth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** measured and lost, 2026-08-20. The hold this line recorded was discharged by
building both sides by hand — which is what § The Next.js side said the comparison would have to be —
rather than by the missing noun arriving. § Current state and blockers is left standing as the record
of what was true when it was written; § Measured — both sides, exercised says what changed and what
did not.

## What the journey requires

Copied from `../dx-benchmark.md` § The ten journeys, unchanged. Rewording it requires an ADR,
because a movable target measures nothing.

| # | Journey | What must work |
| --- | --- | --- |
| J8 | **Tenant** | Two tenants' threads and approvals are invisible to each other |

Two nouns carry the whole journey, and neither is decoration. **Threads** is J4's artifact;
**approvals** is J2's. J8 is therefore not a feature of its own so much as the isolation property of
J4 and J2, held at the same time, under one store. That is why it is scheduled after both and why
its criteria below name their artifacts rather than inventing new ones.

## Acceptance criteria

In the shape `ROADMAP.md` uses: observable, with an oracle, graded by `/acceptance` against the
released artifact rather than the working tree (`.claude/rules/cycle-acceptance.md` § Target kinds).

**Definition of done (all must hold):**

- [ ] two requests against one published build sharing one store — one carrying tenant A's
      credential, one carrying tenant B's — produce disjoint thread listings: the set intersection
      of the thread ids returned to A and the ids created as B is empty, asserted as a set
      operation over the parsed response body rather than read off a rendered page
- [ ] fetching, by id, a thread B created, as A, returns a response byte-identical to the response
      for an id that was never created — same status, same body — so existence does not leak
      through the difference between "not yours" and "not there"; compared as two captured
      responses, not asserted as "returns 404"
- [ ] a HITL approval created by B is absent from A's pending listing, and A's POST of B's approval
      decision does not run the tool: verified by the tool's own recorded side effect (a counter, a
      written file, an emitted span) being absent after A's attempt and present after B's, because
      an HTTP status alone does not prove the tool did not run
- [ ] isolation lives in the persisted key, not only in a query filter: reading the store directly
      after the run finds no record whose key omits the tenant component, enumerated over every
      record the run wrote
- [ ] the tenant identity is derived server-side from the authenticated session: replaying A's
      request with B's tenant id substituted into every client-controllable position (header, query,
      body field, cookie other than the session cookie) still returns A's data, checked position by
      position with the list of positions recorded
- [ ] Applies to: Web, Tauri, TUI — each listed target is exercised in acceptance, not merely
      declared
- [ ] Tauri: the same two-tenant refusal is produced over the in-process path, decided by one shared
      check that both transports execute rather than by a second implementation behind IPC
- [ ] TUI: same seam, same shared check. *Not applicable* is not available here — a terminal has no
      viewport, but it has a caller, and a caller has a tenant

**One criterion resisted an oracle and is deliberately absent.** "No tenant data leaks through any
shared subsystem" is universally quantified over subsystems that do not all exist yet; no run can
falsify it, so it would be a statement wearing a checkbox. What replaces it is the enumeration
above — threads, approvals, store keys, identity derivation — which is narrower than the sentence
and is the part a run can actually settle. The gap is real and stated rather than papered over: a
leak through a cache key or a log line is out of scope for this journey's grade.

## The Next.js side

**There is no direct equivalent, and that is a benchmark datum rather than a gap to hide.** Next.js
ships no tenant concept, no thread store and no approval store, so on that side there is nothing to
isolate until the reference implementation builds all three.

The nearest official artifact is Vercel's multi-tenant platform starter, which solves tenant
*addressing* — mapping a subdomain or custom domain to a tenant — and not the isolation of agent
state. *(To confirm at implementation time: the template's current name and stack, and whether it
carries any data-scoping helper at all rather than only routing.)*

So the fair comparison is hand-rolled against hand-rolled, and the Next.js side is written to win:
the reference implementation takes the message-persistence recipe the AI SDK chat template already
uses, adds a tenant column, and scopes every read by it. *(To confirm at implementation time: which
persistence the current official chat template uses, and whether its schema already carries an
owner column that a tenant column would merely rename.)*

The consequence for scoring is worth stating before any number exists: this is the journey where a
TheoKit win cannot come from ergonomics, because there is nothing on our side to be ergonomic with
yet. It comes from a primitive that does not exist, or it does not come.

## How the four metrics are counted here

The general counting rule is in `../dx-benchmark.md` § The four metrics. What follows is that rule
landed on this journey.

**Files touched.** Scaffolder output nobody edited does not count on either side. Counted here: the
file that resolves a tenant from the session, the thread store or its key builder, the approval
store or its key builder, the listing handler, and any config file that had to learn a new key. Not
counted: the tool the two tenants call — it is J1's file, unmodified, and reusing it is the point.

**Glue lines.** This journey's business logic is the empty set, and saying so is more honest than
inventing a denominator. Nothing a user asked for gets built here: every line written is
key-shaping, filtering, identity-threading and refusal — all of it glue by the rule's own
definition. The scoring hazard follows directly: a ratio is undefined when one term is zero, so J8
reports glue as an **absolute count**, and the winning margin is the stated absolute gap the rule
already allows, never a multiple.

**Concepts required.** Derived mechanically from the imports and APIs the committed diff uses.
Expected on our side once the primitive exists: whatever names tenant resolution, the store key
contract, and the approval-ownership check. Expected on the Next.js side: the ORM's schema builder,
the migration command, the session accessor, and one filter idiom per query site. Counted from the
diff, not estimated from this paragraph.

**Time to first green run.** Wall clock from `npx create-theokit` (`packages/create-theokit/src/cli.ts:71`)
to the first run where the disjoint-listing assertion passes. Cold cache, at least three runs, mean
and standard deviation reported. Migration time counts on both sides: a tenant column that needs a
migration is part of the cost of the journey, not a setup step outside it.

## The deliberately broken state

Per `../dx-benchmark.md` § The fifth, which is pass/fail and not a number. Two breaks, because this
journey has two halves and they fail differently.

**Break 1 — the tenant component is dropped from the store key.** The realistic one: someone writes
`key = threadId` where the contract wanted `key = tenantId + threadId`.

| | |
| --- | --- |
| Names the action | `thread store: key "thread:abc123" carries no tenant component. The request resolved tenant "acme"; build the key with the tenant-aware builder before writing.` — it names the value that was dropped, where it was dropped, and the call that would not have dropped it |
| Does not name the action | `Error: not found`, or `TypeError: undefined is not an object` — or, worst, HTTP 200 carrying B's thread |

**Break 2 — A posts a decision on B's approval.**

| | |
| --- | --- |
| Names the action | `approval "ap_9f2" belongs to tenant "globex"; this session resolved tenant "acme". An approval is decided by its own tenant.` — names both sides of the mismatch, so the reader knows whether the bug is the id or the session |
| Does not name the action | A 500 with a stack trace through the store, or a 403 with no body — and, again worst, the tool simply running |

**This journey adds a precondition to the fifth metric, and the addition is the finding.** The
question as written — does the error name what to do — presumes an error. Break 1's most likely
real outcome is no error at all: a silent 200 with the wrong tenant's data. J8 therefore scores a
silent success as **fail** on the fifth metric rather than as unmeasurable, on both sides, and the
transcript records which of the two failures occurred. Grading absence of an error as "no error to
grade" would reward the worse behaviour.

## Current state and blockers

`../dx-benchmark.md` § Sequencing lists J8 as held without naming its blocker. Measured against the
working tree on 2026-08-20, with every claim read from source:

**The blocker is that the framework has no tenant — so the journey has no subject.** Not a missing
feature within a built subsystem; a missing noun. Every occurrence of the word in the two source
packages is one of two things, and neither is an identity anything is keyed by:

- **A string in a manifest.** `MemoryScope` admits the literal `'per-tenant'`
  (`packages/agents/src/types.ts:207`), and the only code that reads it copies it verbatim into the
  emitted agent manifest (`packages/agents/src/manifest/agent-manifest.ts:117`). Nothing enforces
  it, nothing keys on it, nothing refuses when two scopes collide. It is a declared intention with
  no reader.
- **A doc comment addressed to the application author.** Three modules tell multi-tenant apps to do
  the isolation themselves — the conversation-scope helper
  (`packages/agents/src/conversation-scope.ts:5`), the MCP resolver
  (`packages/agents/src/bridge/mcp-resolver.ts:6`) and the skills resolver
  (`packages/agents/src/skills-resolver.ts:5`). That is a legitimate design position. It is also
  exactly the position that makes this journey measure the application rather than the framework.

The one helper the framework does offer is `deriveConversationId(resource, thread)`
(`packages/agents/src/conversation-scope.ts:17`): two components, pure, and with **zero production
callers** anywhere in the two packages — its only non-definition references are its own unit test.
A tenant would have to be folded into `resource` by the application, by hand, at every call site.

The other two halves are consistent with that:

- **Identity is application-defined by construction.** `SessionManager<TSession>` is generic over a
  payload the framework never inspects (`packages/theo/src/server/auth/session.ts:40`), so no
  framework code can read a tenant out of a session even if the application puts one there. The
  cost subsystem records the same shape as a comment rather than a type: its user identifier is
  documented as "session userId, tenantId, apiKey hash" (`packages/theo/src/server/cost/cost-types.ts:19`)
  — three different things in one untyped string.
- **Pending approvals are a process-local map.** The ledger keys open items by a single id string
  in an in-memory `Map` (`packages/agents/src/ask/pending-ledger.ts:77`), with no owner dimension
  and no durability. Two tenants sharing a process share that map; two processes share nothing.

**And it compounds with J2's blocker rather than sitting beside it.** An approval with no owner
cannot be invisible to a non-owner, so J8's approval half is a strict superset of J2's. That half
moved on 2026-08-20: ADR 0001's owner-check primitive now exists and one access decision is
evaluated by all three transports (`packages/theo/src/core/contracts/route-policy.ts:84`, and see
`j02-hitl.md` § Current state and blockers for the measurement). It does not unblock J8 — an owner
is a subject, and a tenant is a scope, and the framework still has the first and not the second —
but it does mean J8's remaining blocker is the missing noun alone, rather than the missing noun plus
an undecided design.

**What would unblock it, stated so the hold has an exit:** a decided home for tenant identity, and a
store key contract that includes it. Half of the first is now built — ADR 0001 gave the framework a
transport-independent subject that all three transports evaluate — so what remains is deciding
whether a tenant is a second field on that subject or a scope alongside it, and then keying threads
and approvals by it. The first half is a decision and belongs in an ADR; the second is code and
belongs in the backlog. Splitting them is what turns an open-ended hold into two tractable items.

**Not measured:** whether any scaffolded application does the isolation correctly by hand. The
framework's absence of a primitive is what was measured; the quality of what applications build on
top of that absence was not.

## Measured — both sides, exercised (2026-08-20)

**§ Current state and blockers below said this journey had no subject, and that reading is now half
refuted and half sharpened.** It is refuted in the sense that mattered for scheduling: an application
*can* build tenant isolation on either stack, both sides were built, both were run against published
builds, and both satisfy every gradeable criterion. It is sharpened in the sense that mattered for the
result: the framework contributed nothing to the isolation on our side, and — measured rather than
read — a published TheoKit build serves, alongside the isolated application, an **unauthenticated path
that returns one tenant's conversation to a caller holding no credential**. The application is
isolated; the deployment is not.

Every request below went over HTTP to a published build on each side — `theokit build` +
`theokit start` on ours, `next build` + `next start` on theirs — driven from a separate process, with
the side-effect oracle in a third.

### Versions and commits under test

**TheoKit** — the published artifact, because `.claude/rules/cycle-acceptance.md` § Target kinds
grades the released one: `theokit@0.48.14` (npm `latest`), `@theokit/agents@10.1.0`,
`@theokit/sdk@4.53.1`, `@theokit/ui@1.4.1`, `zod@4.4.3`, React 19.2.8, from a
`create-theokit@1.23.8` scaffold. **Next.js** — `next@16.3.1`, `ai@7.0.70`, `@ai-sdk/react@4.0.73`,
`@ai-sdk/openai-compatible@3.0.32`, `jose@6.2.9`, `zod@4.4.3`, React 19.2.8. Node 22.22.2 on both.
Source claims are read from the worktree at `4205c224a`.

**One version fact decides more of this measurement than any other, and it is ours.** ADR 0001's
authorization primitive is **not in the published artifact**. `requireOwner`, `evaluateRoutePolicy`,
`subjectFromContext` and `route().policy(...)` all exist in this repository
(`packages/theo/src/core/contracts/route-policy.ts:86`, `:65`, `:39`;
`packages/theo/src/server/define/route-builder.ts:66`) and a grep for any of the four over the
installed `theokit@0.48.14` `dist/` returns nothing. The scaffold's own `server/routes/health.ts`
proves it independently: the template in this worktree carries `.policy('public')` and the file the
published scaffolder writes does not. So the measurement below is against a framework with **no**
route policy, and § Declared judgements records what the unreleased half would have changed — which
is not what a reader would guess.

### The four deferred questions, confirmed against the source

§ The Next.js side and § How the four metrics are counted here deferred four questions to
implementation time. All four were checked against first-party sources and against the packages
actually installed, and three of them refine what the section supposed.

| Deferred question | Answer | Checked against | Diverged? |
| --- | --- | --- | --- |
| Vercel's multi-tenant starter — its current name and stack, and whether it carries any data-scoping helper rather than only routing | `vercel/platforms`, README "Next.js Multi-Tenant Example", gallery "Platforms Starter Kit". Next 16, React 19.2.7, **Upstash Redis and no ORM**. `proxy.ts` (Next 16's rename of `middleware.ts`) extracts a subdomain and rewrites to `/s/<subdomain>`; it never touches Redis. There is **no** scoping helper: `lib/subdomains.ts` and `app/actions.ts` each hand-build `` `subdomain:${sanitized}` `` at the call site | github.com/vercel/platforms; vercel.com/templates | **No — confirmed, and worse than supposed.** The isolation there is an unenforced string-prefix convention repeated ad hoc, not an abstraction |
| Which persistence the current official chat template uses | The local filesystem, one JSON file per chat under `.chats/<id>.json`, from the AI SDK's own "Chatbot Message Persistence" page. `createChat()` / `loadChat(id)` / `saveChat({chatId, messages})`, payload `UIMessage[]` | ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence, and the same MDX shipped inside `ai@7.0.70` at `docs/04-ai-sdk-ui/03-chatbot-message-persistence.mdx` | — |
| Whether that schema already carries an owner column a tenant column would merely rename | **No. There is no owner column, and no `Chat` type at all** — the file name is the only key and the payload is a bare message array. The page states in its own words that it "does not cover authorization" | same | **Yes.** The supposition was that a tenant would be a rename; it is a net-new key component on that side, exactly as it is on ours |
| The Next.js session idiom, since the reference implementation must be written to win | `jose` — `new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(key)` and `jwtVerify(token, key, { algorithms: ['HS256'] })`, read back with `cookies()` from `next/headers`, cookie `{ httpOnly: true, secure: true, expires, sameSite: 'lax', path: '/' }`. A database-session variant is shown second | nextjs.org/docs/app/guides/authentication (page frontmatter `version: 16.3.1`, `lastUpdated: 2026-08-18`) | — |

**A fifth fact the section did not anticipate, and it is the one that decides criterion 3.** In
`ai@7.0.70` human-in-the-loop approval is **in-band**: `approval-requested` and `approval-responded`
are states of the tool part inside `UIMessage.parts`, so an approval is persisted with the chat and
replayed with it, and there is no approval endpoint in the SDK's types at all. The server option is
`toolApproval: { <tool>: 'user-approval' }`; the request is HMAC-signed when
`experimental_toolApprovalSecret` is set, and the signature rides on the part as `approval.signature`.
TheoKit's is **out-of-band**: the run pauses in the process and a separate route settles it. That
difference is what makes the two implementations below different shapes rather than the same shape
twice, and § Declared judgements says what it costs each side.

### The baselines, and the argument for each

| Lane | Baseline | Argument |
| --- | --- | --- |
| TheoKit | `create-theokit@1.23.8` default template, committed untouched, then one uncounted instrument commit | Unchanged from J4 and J7: this is what a developer installs today, and the scaffold already ships the agent, the gated tool and the approval declaration |
| Next.js | `create-next-app` (TypeScript, App Router, Tailwind) + `npm install ai @ai-sdk/react zod` + the AI SDK App Router quickstart's chat Route Handler, all committed untouched, then one uncounted instrument commit | J1's argument, unchanged: the TheoKit scaffold hands over a working agent endpoint for free, and this journey needs one on both sides. Charging Next.js for building an agent while TheoKit is charged for none would measure the two scaffolds |

**The uncounted instrument commit is the same on both sides**, and it carries the one thing this
journey's own counting rule excludes: *"Not counted: the tool the two tenants call — it is J1's file,
unmodified, and reusing it is the point."* On ours that is the scaffold's `send_notification`, already
gated by `agents/chat.ts`'s `.approval('send_notification', …)`; on theirs it is a nineteen-line
`app/tools.ts` plus `toolApproval: { send_notification: 'user-approval' }` on `streamText`. Both tool
bodies POST to the shared recorder, because criterion 3 grades whether the tool **ran**. Also
uncounted on both: the local-model swap, and — on ours — a `port` line in `theo.config.ts`, because
`theokit start` never reads `PORT` (usetheokit/theokit#402) and `:3000` was taken by another journey's
server on this machine.

**One formatting control**, unchanged from J1: both diffs are formatted with the `create-theokit`
Prettier config (`packages/create-theokit/templates/default/.prettierrc`, `printWidth: 100`,
`semi: false`), so both sides are counted with the same ruler, and both are `prettier --check` clean
under it.

### The instrument, and why this journey could be run without credits

Counted on neither side.

**The model.** One ~180-line local server on `:11434` answering both Ollama's native `/api/chat`
NDJSON and the OpenAI chat-completions shape at `/v1/chat/completions`, so `@theokit/sdk`'s `ollama`
profile (`authType: "none"`) and `createOpenAICompatible` reach the same process. Its script is keyed
off the last user turn: a turn containing "notify" produces a `send_notification` tool call, and any
other turn answers `SAW <n> USER TURN(S): <their text, joined>`.

**And the instrument is the oracle for the leak.** Because the text answer enumerates the transcript
the model received, a request that gets another tenant's history back says so in its own reply. That
is what turns § The leak the criteria do not grade from an inference into a transcript.

**The side-effect recorder.** An append-only log on `:4311`, byte-identical for both lanes. The gated
tool POSTs to it; criterion 3 is graded by reading that log back from outside both frameworks.

`OPENAI_API_KEY=local-instrument` is set on the TheoKit lane because `resolveProvider` walks its
registry for an unknown model prefix and throws when no provider variable is set at all
(`packages/theo/src/server/agent/provider-resolver.ts:65`); the value is never used. This is the same
step J4 recorded.

### What the framework has, and where it stops

Read from source and then exercised. This is the answer to the question § Current state and blockers
left open — the framework does have half of something, and it is worth saying exactly which half.

**What exists, and it is real.** ADR 0001 gave the framework a transport-independent subject:
`RouteSubject` is `{ id: string; [claim: string]: unknown }`
(`packages/theo/src/core/contracts/route-policy.ts:9`), so a tenant fits on it as a claim without any
new type; `evaluateRoutePolicy` is one implementation the Node executor, the Web executor and
`callProcedure` all call; `requireOwner` answers "may this subject touch this record"
(`packages/theo/src/core/contracts/route-policy.ts:86`); and the file-system scanner **fails the
build** for a route file whose HTTP export declares no policy
(`packages/theo/src/server/scan/scan.ts:110`). That last one is the strongest piece: absence becomes a
build error rather than a silence.

**Where it stops, and there are three separate stops.**

1. **It stops at the released artifact.** None of the four symbols is in `theokit@0.48.14`. An
   application installed today declares no policies because there is nothing to declare them with,
   and the build gate that would refuse the omission is not there either.
2. **It stops at `route()` files.** The five endpoints this journey grades are dispatched *before*
   route matching — `tryServeAgentAux` and `tryServeAgent` run ahead of `tryServeApiRoute`
   (`packages/theo/src/cli/commands/start/request-handler.ts:255-257`) — so no application route, no
   `server/middleware/` and no `server/context.ts` ever observes those URLs. `mountAgent` accepts a
   `policy` and a `subject` (`packages/theo/src/server/agent/mount-agent.ts:106`, `:108`) and **no
   production caller supplies either** (`packages/theo/src/cli/commands/start/handlers.ts:380`,
   `packages/theo/src/vite-plugin/agent-middleware.ts:329`,
   `packages/theo/src/vite-plugin/api-middleware.ts:282`). The thread routes and the approval routes do
   not have the parameter at all (`packages/theo/src/server/agent/handle-thread-routes.ts:32-33`,
   `packages/theo/src/server/agent/list-approvals-handler.ts:19`,
   `packages/theo/src/server/agent/approve-agent.ts:83`). And an application cannot mount a policed
   agent route of its own, because `mountAgent` is exported only from
   `packages/theo/src/server/internal-api.ts:46`, a file whose own header says it is "NOT the public
   API".
3. **It stops one concept short of the question.** `requireOwner(subject, ownerId)` compares
   `subject.id` to an owner id. A tenant is not a subject; it is a scope over subjects, and the
   question J8 asks is not "may this subject call this route" but "which records may this subject
   see". That is answered by the **key**, and the framework has no key contract:
   `deriveConversationId(resource, thread)` is the only tenant-shaped helper
   (`packages/agents/src/conversation-scope.ts:17`) and still has zero production callers;
   `MemoryScope` still admits `'per-tenant'` (`packages/agents/src/types.ts:207`) and the only code
   that reads it still copies it into a manifest
   (`packages/agents/src/manifest/agent-manifest.ts:117`); `SessionManager<TSession>` is still generic
   over a payload the framework never inspects (`packages/theo/src/server/auth/session.ts:40`); and
   the approval ledger still keys by a bare id with no owner dimension
   (`packages/theo/src/server/agent/approval-registry.ts:72`).

**The one word that did reach runtime since this page was written points the wrong way.** `tenant`
now appears in the client transport's per-request context — *"Structured per-request context (tenant,
provider, …) forwarded to in-process / channel runners"*
(`packages/agents/src/client/transport.ts:28`, and the same on
`packages/agents/src/client/in-process-transport.ts:28`). That is a value the **client** writes. It is
precisely the position criterion 5 exists to forbid.

**And there is one instruction in the source that an application cannot follow.**
`packages/theo/src/server/agent/serve-aux-routes.ts:150` tells an application using a predictable
session id that it "MUST add its own auth gate before this endpoint". Point 2 above is why no such
gate is constructible.

> **Addendum, 2026-08-20 — what changed after this was measured.** The measurement above stands as
> written; it is what the tree held on the day. Since then, usetheokit/theokit#365 closed **stop 2**:
> an agent file exports a `policy`, every agent endpoint evaluates it, identity comes from the
> application's own `server/context.ts`, and `scanAgents` refuses a file that declares nothing. The
> instruction in the last paragraph is now one an application can follow. **Stop 1 is unchanged** —
> none of this is in a published artifact, so a `0.48.x` install still has no seam. **Stop 3 is
> unchanged and is the honest limit**: `requireOwner` still compares a subject id to an owner id,
> there is still no key contract, and the approval ledger still records no owner — so this page's
> § Break 2 finding survives the fix, on the framework's route as much as on the application's.

### The two implementations, and why they are the shapes they are

Both sides do the same four things: resolve a tenant server-side from a signed/encrypted cookie, put
the tenant **in the store key**, list and read only that tenant's threads, and list and settle only
that tenant's approvals.

**The Next.js side is the shorter one because it had a shorter distance to travel**, and the reason
is structural rather than ergonomic: `streamText` is a function the application calls inside its own
Route Handler, so identity, the store key and the approval are already on the application's side of
the line. The AI SDK's in-band approval then makes criterion 3 nearly free — a pending approval is a
part of a message in a chat the store already scopes, and a decision is a re-POST to the same
tenant-scoped chat route.

**The TheoKit side had to move the agent onto the application's side of the line first.** Because the
framework's agent endpoint accepts no policy and cannot be shadowed, the application serves the turn
from its own `route()` over `streamAgentTurnInProcess` (`packages/agents/src/in-process-turn.ts:159`,
public via `packages/theo/src/server/agent/index.ts:29`) rendered with `uiMessageStreamResponse`
(`packages/theo/src/server/define/ui-message-stream-response.ts:33`), deriving the session id
server-side as `"<tenant>__<thread>"`. And because the approval ledger has no owner dimension, the
application owns HITL too: the inline `awaitApproval` resolver returns a Promise the application
holds in its own tenant-keyed map, settled by its own route.

That is 3 files and roughly 60 lines the Next.js side does not write, and it is the whole of the gap
in § Metrics 1-3.

### Metrics 1-3

| Metric | TheoKit | Next.js + AI SDK | Better | Margin | Verdict under § What counts as winning |
| --- | --- | --- | --- | --- | --- |
| Files touched | **9** | **9** | neither | 1.0x | level — **tie** |
| Glue lines | 193 | **147** | Next.js | **46 lines**, absolute per this page's own rule | Next.js — **loss** |
| Concepts required | 13 | **11** | Next.js | 1.18x | inside the 2x bar — **tie**, with Next.js the better side |
| Time to first green run | not measured | not measured | — | — | see § What is still unmeasured |
| Criteria satisfied | **5 of 5** | **5 of 5** | neither | — | not a countable metric, and not the whole story here |

Counted with `git diff --numstat` over each side's baseline commit. Added lines total 218 on ours and
163 on theirs; the glue figures subtract blank lines (26 and 17), add doc comments to glue rather than
excluding them (J4's rule, inherited), and add one line each for the `SESSION_SECRET` in `.env.local`,
which `git` does not see because both scaffolds ignore it.

**Business logic is the empty set on both sides**, exactly as § How the four metrics are counted here
fixed in advance: nothing a user asked for is built here. That is why the glue figure is an absolute
count and never a ratio.

**Files touched, enumerated.** Ours: `server/context.ts`, `server/lib/tenancy.ts`,
`server/routes/session.ts`, `server/routes/chat.ts`, `server/routes/threads.ts`,
`server/routes/threads/[id].ts`, `server/routes/approvals.ts`, `server/routes/approvals/[id].ts`,
`.env.local`. Theirs: `util/session.ts`, `util/chat-store.ts`, `app/api/session/route.ts`,
`app/api/chat/route.ts` (edited), `app/api/threads/route.ts`, `app/api/threads/[id]/route.ts`,
`app/api/approvals/route.ts`, `package.json`, `.env.local`. Not counted on either side:
`package-lock.json` (tool output nobody edits by hand, J7's exclusion) and a `.gitignore` line each
for the run artefacts the two stores write — ours because the scaffold gitignores neither
(usetheokit/theokit#395).

### The two diffs, published

Published because the glue split is the metric most open to being argued after the fact, and a table
nobody can check is not evidence — least of all one published by the side it favours.

**TheoKit — 8 source files, 218 added, 0 removed.**

```ts
// server/context.ts (new, 23)
import type { IncomingMessage } from 'node:http'

import { createSessionManager } from 'theokit/server/auth'

/** The session payload. The framework never inspects it — `SessionManager<T>` is generic. */
export interface AppSession {
  user: string
  tenant: string
}

export const sessions = createSessionManager<AppSession>({
  secret: process.env.SESSION_SECRET ?? '',
})

/**
 * ADR 0001's subject, resolved server-side. The tenant is a claim on the subject and reaches the
 * route policies through `ctx.subject` — never through a header, a query field or the body.
 */
export async function createContext({ request }: { request: IncomingMessage }): Promise<unknown> {
  const session = await sessions.getSession(request)
  if (session === null) return {}
  return { subject: { id: session.user, tenant: session.tenant } }
}
```

```ts
// server/lib/tenancy.ts (new, 52) — the tenant helpers, in full
import { dirname } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'

/** The tenant of the caller, read from the subject `server/context.ts` resolved server-side. */
export function tenantOf(ctx: unknown): string | null {
  const subject = (ctx as { subject?: { tenant?: unknown } }).subject
  const tenant = subject?.tenant
  return typeof tenant === 'string' && tenant.length > 0 ? tenant : null
}

/** The refusal every route repeats, because `theokit@0.48.14` has no route policy to declare it in. */
export function unauthenticated(): Response {
  return new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

export function notFound(): Response {
  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  })
}

/** The store key. Isolation lives here, in the key, not in a filter applied after the read. */
export function threadKey(tenant: string, thread: string): string {
  return `${encodeURIComponent(tenant)}__${encodeURIComponent(thread)}`
}

/** The tenant component of a key, or `null` for a key that carries none. */
export function tenantOfKey(key: string): string | null {
  const at = key.indexOf('__')
  return at === -1 ? null : decodeURIComponent(key.slice(0, at))
}

/** Where the SDK roots this process's transcripts, and the file one thread lands in. */
export function transcriptFile(key: string): string {
  return transcriptPath(transcriptRoot(), process.cwd(), key)
}
export function transcriptDir(): string {
  return dirname(transcriptFile('probe'))
}

/** A gated tool waiting on a decision. Owned here because the framework's ledger has no owner. */
export interface OwnedApproval {
  tenant: string
  toolName: string
  settle: (approved: boolean) => void
}
export const pending = new Map<string, OwnedApproval>()
```

```ts
// server/routes/chat.ts (new, 29) — the agent turn, tenant-scoped
import { streamAgentTurnInProcess } from 'theokit/server/agent'
import { route, uiMessageStreamResponse } from 'theokit/server/define'
import { z } from 'zod'

import * as chatAgent from '../../agents/chat.js'
import { pending, tenantOf, threadKey, unauthenticated } from '../lib/tenancy.js'

export const POST = route()
  .query(z.object({ message: z.string(), thread: z.string().min(1) }))
  .handler(({ query, ctx }) => {
    const tenant = tenantOf(ctx)
    if (tenant === null) return unauthenticated()
    return uiMessageStreamResponse(
      streamAgentTurnInProcess(chatAgent, process.env.OPENAI_API_KEY ?? '', {
        message: query.message,
        sessionId: threadKey(tenant, query.thread),
        awaitApproval: ({ approvalId, toolName }) =>
          new Promise<boolean>((resolve) => {
            pending.set(approvalId, { tenant, toolName, settle: resolve })
          }),
      }),
    )
  })
  .build()
```

```ts
// server/routes/threads.ts (new, 26) — this tenant's threads
export const GET = route().handler(({ ctx }) => {
  const tenant = tenantOf(ctx)
  if (tenant === null) return unauthenticated()
  let names: string[] = []
  try {
    names = readdirSync(transcriptDir())
  } catch {
    /* nothing written yet */
  }
  return {
    threads: names
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length))
      .filter((key) => tenantOfKey(key) === tenant)
      .map((key) => decodeURIComponent(key.slice(key.indexOf('__') + 2))),
  }
})
```

```ts
// server/routes/threads/[id].ts (new, 34) — one thread; not-yours and not-there are one code path
export const GET = route()
  .params(z.object({ id: z.string().min(1) }))
  .handler(({ params, ctx }) => {
    const tenant = tenantOf(ctx)
    if (tenant === null) return unauthenticated()
    let rows: { uuid: string; message?: TranscriptMessage }[] = []
    try {
      rows = loadJsonl(transcriptFile(threadKey(tenant, params.id)))
    } catch {
      return notFound()
    }
    return {
      messages: rows
        .filter((row) => row.message !== undefined)
        .map((row) => ({ id: row.uuid, role: row.message?.role })),
    }
  })
  .build()
```

```ts
// server/routes/approvals/[id].ts (new, 22) — decide one gated tool
export const POST = route()
  .params(z.object({ id: z.string().min(1) }))
  .query(z.object({ approved: z.enum(['true', 'false']) }))
  .handler(({ params, query, ctx }) => {
    const tenant = tenantOf(ctx)
    if (tenant === null) return unauthenticated()
    const item = pending.get(params.id)
    if (item === undefined || item.tenant !== tenant) return notFound()
    pending.delete(params.id)
    item.settle(query.approved === 'true')
    return { resolved: true }
  })
  .build()
```

`server/routes/session.ts` (16) mints the cookie with `createSessionManagerWeb`, and
`server/routes/approvals.ts` (16) filters `pending` by tenant; both are the same shape as the two
above and are omitted here for length.

**Next.js — 8 files, 163 added, 3 removed.**

```ts
// util/session.ts (new, 31) — the nextjs.org auth guide's own idiom, with a tenant on the payload
import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET)

export type SessionPayload = { user: string; tenant: string }

export async function encrypt(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(encodedKey)
}

/** The tenant of the caller, or null. Read from the signed cookie and from nowhere else. */
export async function tenantOf(): Promise<string | null> {
  const cookie = (await cookies()).get('session')?.value
  if (cookie === undefined) return null
  try {
    const { payload } = await jwtVerify(cookie, encodedKey, { algorithms: ['HS256'] })
    return typeof payload.tenant === 'string' && payload.tenant.length > 0 ? payload.tenant : null
  } catch {
    return null
  }
}

export const unauthenticated = () =>
  Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })
export const notFound = () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
```

```diff
--- a/util/chat-store.ts   (the AI SDK guide's file store, +50)
+++ b/util/chat-store.ts
+/** The store key. Isolation lives here, in the key, not in a filter applied after the read. */
+function getChatFile(tenant: string, id: string): string {
+  if (!chatIdRegex.test(id) || !chatIdRegex.test(tenant)) {
+    throw new Error('Invalid chat ID')
+  }
+  const chatDir = path.resolve(process.cwd(), '.chats')
+  const chatFile = path.resolve(chatDir, `${tenant}__${id}.json`)
+  …
+export function listChats(tenant: string): string[] {
+  const chatDir = path.resolve(process.cwd(), '.chats')
+  if (!existsSync(chatDir)) return []
+  return readdirSync(chatDir)
+    .filter((name) => name.endsWith('.json') && name.startsWith(`${tenant}__`))
+    .map((name) => name.slice(tenant.length + 2, -'.json'.length))
+}
```

```diff
--- a/app/api/chat/route.ts   (edited, +16 -3)
+++ b/app/api/chat/route.ts
+import { saveChat } from '../../../util/chat-store'
+import { tenantOf, unauthenticated } from '../../../util/session'
 export async function POST(req: Request) {
+  const tenant = await tenantOf()
+  if (tenant === null) return unauthenticated()
-  const { messages }: { messages: UIMessage[] } = await req.json()
+  const { messages, id }: { messages: UIMessage[]; id: string } = await req.json()
@@
+    // Bind the signature to the tenant, so an approval issued for one cannot be replayed by another.
+    experimental_toolApprovalSecret: `${process.env.APPROVAL_SECRET}:${tenant}`,
@@
     stream: toUIMessageStream({
       stream: result.stream,
+      originalMessages: messages,
+      generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 }),
+      onEnd: ({ messages }) => {
+        saveChat({ tenant, chatId: id, messages })
+      },
     }),
```

```ts
// app/api/threads/route.ts (new, 8) — the whole file
import { listChats } from '../../../util/chat-store'
import { tenantOf, unauthenticated } from '../../../util/session'

export async function GET() {
  const tenant = await tenantOf()
  if (tenant === null) return unauthenticated()
  return Response.json({ threads: listChats(tenant) })
}
```

```ts
// app/api/approvals/route.ts (new, 21) — pending decisions, derived from the tenant's own chats
export async function GET() {
  const tenant = await tenantOf()
  if (tenant === null) return unauthenticated()
  const approvals: { approvalId: string; toolName: string; thread: string }[] = []
  for (const thread of listChats(tenant)) {
    const messages: UIMessage[] = await loadChat(tenant, thread)
    for (const message of messages) {
      for (const part of message.parts) {
        if ('state' in part && part.state === 'approval-requested') {
          approvals.push({ approvalId: part.approval.id, toolName: part.type, thread })
        }
      }
    }
  }
  return Response.json({ approvals })
}
```

`app/api/session/route.ts` (18) sets the guide's cookie verbatim, `app/api/threads/[id]/route.ts` (18)
is the mirror of ours, and `package.json` gains `"jose": "^6.2.9"`.

**There is no approve endpoint on the Next.js side, and that absence is a measurement rather than an
omission.** The AI SDK's approval is in-band, so the decision is a re-POST to `/api/chat` with the
approval response appended to the tenant's own chat. It was exercised that way, and criterion 3 is
graded on the result.

### The added lines, classified

| Class | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| Glue (added − blank, doc comments included) | **192** | **146** |
| of which doc comments | 27 | 10 |
| Business logic | 0 | 0 |
| Blank | 26 | 17 |
| **Added lines** | **218** | **163** |
| `.env.local`, invisible to `git` | +1 | +1 |
| **Glue, as scored** | **193** | **147** |

Per file, ours: 23 / 52 / 16 / 29 / 26 / 34 / 16 / 22 (`context`, `lib/tenancy`, `routes/session`,
`routes/chat`, `routes/threads`, `routes/threads/[id]`, `routes/approvals`, `routes/approvals/[id]`).
Theirs: 31 / 50 / 18 / 16 / 8 / 18 / 21 / 1 (`util/session`, `util/chat-store`, `api/session`,
`api/chat`, `api/threads`, `api/threads/[id]`, `api/approvals`, `package.json`).

**The single largest file on either side is a store.** Ours is `lib/tenancy.ts` at 52; theirs is the
AI SDK guide's own `chat-store.ts` at 50. The gap is not there. It is in the three files ours has and
theirs does not — the agent route, the approvals listing's owner map, and the approve route — which
come to 67 of our 218 added lines.

### The concepts, derived from the diffs

Thirteen against eleven, enumerated so the count can be argued with rather than believed.

| # | TheoKit | Next.js + AI SDK |
| --- | --- | --- |
| 1 | `server/context.ts` and its `createContext({ request })` export — the seam that builds `ctx`, documented in this repository only in `docs/surfaces/middleware-edge.md` | `jose`'s `SignJWT` chain — `setProtectedHeader`, `setIssuedAt`, `setExpirationTime`, `sign` |
| 2 | `createSessionManager` from `theokit/server/auth`, the `IncomingMessage` form | `jwtVerify(token, key, { algorithms })` |
| 3 | `createSessionManagerWeb`, the `Request`/`Headers` form — a **second** manager, because a route handler is handed a `Request` and never a `ServerResponse` (`packages/theo/src/server/auth/session.ts:217`) | `cookies()` from `next/headers`, and that it is awaited |
| 4 | `SessionConfig.secret` and its ≥ 32-character rule | `cookieStore.set(name, value, { httpOnly, secure, expires, sameSite, path })` |
| 5 | `ctx.subject` — the shape `subjectFromContext` narrows, and that the application must put it there itself | `'server-only'` |
| 6 | `route()` with `.query()` / `.params()` and their `zod` schemas | the `[id]` dynamic segment and `ctx.params` as a Promise to await |
| 7 | that a route handler may return a `Response` instead of a plain object | the official chat store's `.chats/<key>.json` layout and its opaque-id containment rule |
| 8 | `streamAgentTurnInProcess` and `StreamAgentTurnInProcessInput`'s `sessionId` | `toUIMessageStream`'s `originalMessages` and `onEnd` |
| 9 | `uiMessageStreamResponse` | `createIdGenerator` and `generateMessageId` |
| 10 | `awaitApproval` — the inline resolver, and that the Promise it returns **is** the pause | `experimental_toolApprovalSecret`, and that the signature binds to whatever goes into the secret — which is what makes a per-tenant secret the refusal |
| 11 | `transcriptRoot()` and `transcriptPath(root, cwd, sessionId)` — plus that the transcript **directory** has to be derived with `dirname`, because no directory accessor is exported | the `'approval-requested'` part state and `part.approval.id` |
| 12 | `loadJsonl` and `TranscriptMessage` | — |
| 13 | that the agent is handed over as a module namespace (`import * as chatAgent`) | — |

Platform vocabulary is excluded on both sides, inheriting J4's judgement 2: `Response`,
`Response.json`, `Headers`, `Map`, `encodeURIComponent`, `readdirSync`, `dirname`, `path.resolve`,
`readFile`/`writeFile`, `TextEncoder`, `crypto.randomUUID`. Counting them gives 19 and 19 and starts
measuring the runtime rather than the framework.

### The five gradeable criteria, graded against the runs

Every row was exercised over HTTP against the published build on each side. Markers and ids are quoted
from the run.

| # | Criterion | TheoKit | Next.js + AI SDK |
| --- | --- | --- | --- |
| 1 | disjoint thread listings, asserted as a set intersection over the parsed body | **PASS** — A `['9dcf6aad…']`, B `['57ba30f2…','830e4f34…']`, intersection with the ids created as B **empty** | **PASS** — A `['1b3fc14c…']`, B `['7124ba99…','c738f617…']`, intersection **empty** |
| 2 | fetching B's thread as A is byte-identical to fetching an id that never existed | **PASS** † — both `404 {"error":{"code":"NOT_FOUND"}}`, compared as two captured responses; A's own thread answers `200` with `messages` | **PASS** — both `404 {"error":{"code":"NOT_FOUND"}}`; A's own answers `200` |
| 3 | B's approval absent from A's listing, and A's decision does not run the tool, graded by the recorder | **PASS** — A's listing `[]`; B's carries `1d175639…`; A's POST answers `404` and the recorder stays at **0**; B's POST answers `200 {"resolved":true}` and the recorder goes to **1** | **PASS**, and only after the implementation was written to win — see below. A's listing `[]`; A's replay of B's signed approval is refused and the recorder stays at **0**; B's decision runs it, recorder **1** |
| 4 | isolation in the persisted key, enumerated over every record the run wrote | **PASS** — `acme__9dcf6aad….jsonl`, `globex__57ba30f2….jsonl`, `globex__830e4f34….jsonl`, `globex__c5947c1f….jsonl`; records with no tenant component: **none** | **PASS** — `acme__1b3fc14c….json`, `acme__eb3477a2….json`, `globex__7124ba99….json`, `globex__c738f617….json`, `globex__eb3477a2….json`; none without a tenant component |
| 5 | tenant substituted into every client-controllable position still returns A's data | **PASS on 5 of 6 positions.** `x-tenant-id`, `x-tenant`, a second cookie `tenant=globex`, `?tenant=globex`, `?user=bob` — all `200` with A's single thread. The **body field could not be exercised**: a `POST` carrying a JSON body to an application route never returns on this build (usetheokit/theokit#400) | **PASS on 6 of 6.** The same five, plus `{"tenant":"globex"}` in the request body — `200`, and the chat lands under `acme__…` |
| 6-8 | Web, Tauri, TUI exercised | **Web exercised.** Tauri and TUI **not exercisable here** — they need `@theokit/tui` and `@theokit/ui`, which live outside this repository, and the north-star app does not exist | **n/a** — the journey's three-target rule is transversal to TheoKit |

† **Criterion 2 passes on the endpoint it names and the property it names is defeated on the same
build.** See the next section. Grading it as a failure would be reading a criterion the criteria did
not write; leaving the defeat out of the table would be worse, so it is footnoted here and measured
below.

**Criterion 3 is the one criterion where the two designs genuinely diverge, and the first run went the
other way.** With `experimental_toolApprovalSecret` set to a single application-wide value — the shape
the AI SDK's own docs show — tenant A **replayed tenant B's signed approval into A's own chat and the
gated tool ran**: recorder `0 → 1` on A's request. The signature binds the approval to the tool call
and its input, not to a caller. Making the secret tenant-derived is a one-line change and it closes
it: A's replay then answers `data: {"type":"error","errorText":"An error occurred."}` and the recorder
stays at `0`. The measurement uses the tenant-derived form, because § Why the protocol comes before the
measurement obliges the Next.js side to be written to win. The first result is recorded because a
reader following the SDK's documented shape gets the first behaviour, not the second.

### The leak the criteria do not grade, and it is silent

**The application is isolated. The build it runs on is not.** Alongside the eight application routes,
a published TheoKit build serves the framework's own agent, thread and approval endpoints, and those
have no owner check and no seam through which to add one (§ What the framework has, and where it
stops, point 2).

Exercised, on the same running build, from a caller holding **no cookie, no session and no
credential**:

```
POST /api/agents/chat
{"message":"unauthenticated probe","sessionId":"acme__<the id the application built>"}

→ 200, text/event-stream
   "SAW 2 USER TURN(S): remember the code ALPHA-111 | unauthenticated probe"
```

`ALPHA-111` was written once, by an authenticated request carrying tenant `acme`'s session cookie,
through the application's own route. It comes back to a caller holding nothing. The transcript the
framework then wrote for that request contains only the attacker's own turn, so the prior content did
not come from a file the caller could name — it came from the process's live conversation for that id.

Three things make this the family `docs/adr/0002-an-abnormal-ending-is-never-reported-as-normal.md`
names, in its most expensive form:

- **The status is `200` and the stream is ordinary.** Nothing in the response, and nothing in the
  server's request log, distinguishes it from a legitimate turn.
- **It also defeats criterion 2's property.** An unauthenticated caller can tell an existing
  conversation from a non-existent one by whether the answer enumerates prior turns. Existence leaks,
  on the same build, through a different door.
- **The same run reconfirmed the HITL half on `0.48.14` from npm**: `GET /api/agents/chat/approvals`
  answered `200` with a live pending approval to an unauthenticated caller, and
  `POST /api/agents/chat/approve/<id>` answered `200` and the gated tool's side effect landed in the
  recorder.

This went to a security advisory rather than to a public issue. The source-level version of the agent
half is already tracked publicly, by the maintainers, as usetheokit/theokit#365 — which states that
the attack was not exercised. It is now exercised, and the transcript is in the advisory.

### What the fifth metric found, and both sides fail the same way

Per `../dx-benchmark.md` § The fifth. § The deliberately broken state names two breaks; both were
injected and run on both sides.

**Break 1 — the tenant component dropped from the store key.** One line changed on each side
(`` `${tenant}__${id}` `` → `` `${id}` ``), rebuilt, re-run.

| | TheoKit | Next.js |
| --- | --- | --- |
| What the message § The deliberately broken state asks for | `thread store: key "thread:abc123" carries no tenant component. The request resolved tenant "acme"; build the key with the tenant-aware builder before writing.` | same |
| What actually happens | tenant A writes `SIERRA-777`; tenant B names the same thread and the model answers `SAW 2 USER TURN(S): remember the code SIERRA-777 \| what was the code?` — **`200`, no error anywhere** | tenant A writes `SIERRA-777`; tenant B reads the thread by id and gets `200` with A's messages — **no error anywhere** |
| Grade | **FAIL** | **FAIL** |

Neither framework has a tenant-aware key builder, so neither has a site at which that message could be
emitted. The outcome is the one this page's own precondition calls the worst: a silent 200 carrying
the other tenant's thread. Both sides also lose the thread from **both** listings, because a key with
no tenant component matches no tenant's filter — so the wrong data is readable and the evidence that
it exists is invisible.

**Break 2 — A posts a decision on B's approval.**

| | TheoKit | Next.js |
| --- | --- | --- |
| What the message asks for | `approval "ap_9f2" belongs to tenant "globex"; this session resolved tenant "acme". An approval is decided by its own tenant.` | same |
| What the application's own route produces | `404 {"error":{"code":"NOT_FOUND"}}` — the tool does not run, and the message names nothing | `200` carrying `data: {"type":"error","errorText":"An error occurred."}` — the tool does not run, and the message names nothing |
| What the **framework's** route produces | `200 {"resolved":true}`, and **the tool runs** | n/a — there is no framework approval route |
| Grade | **FAIL** on naming; the framework's own path fails on behaviour too | **FAIL** on naming |

**A tension between two criteria, which is a finding about this page rather than about either
framework.** The message Break 2 asks for names both tenants, and naming them tells the caller that
an approval with that id exists somewhere — which is exactly what criterion 2 forbids for threads.
Both implementations chose the criterion over the metric and answered "not found". A framework could
have it both ways by naming the action in a server log and refusing blankly on the wire; neither does.

### Declared judgements, with the effect of inverting each

| # | Judgement | Decided | Effect of the other choice |
| --- | --- | --- | --- |
| 1 | Which TheoKit artifact is measured — the published `0.48.14`, or this worktree, where `route().policy()` exists? | **Published.** `.claude/rules/cycle-acceptance.md` § Target kinds grades the released artifact, and J7 and J10 both measured published builds | Adding `.policy(…)` to the six routes **adds six lines and removes none**, because the handler still has to read the tenant off `ctx` to build a key, so the guard cannot go away. Glue 193 → 199 and the gap widens to 52. What the worktree would buy is not lines but the build gate (`packages/theo/src/server/scan/scan.ts:110`), which refuses a route that declares nothing — and the published artifact has neither |
| 2 | Is the gated tool counted? | **No**, on this page's own rule: *"Not counted: the tool the two tenants call"* | Ours stays free (the scaffold ships it gated); theirs gains `app/tools.ts` at 19 lines plus two lines on the route. Files 9 → 10 and glue 147 → 168 on their side, and the 46-line gap becomes a 25-line gap the other way — **this is the single most consequential judgement in the count**, and this page fixed it before either implementation existed |
| 3 | Does `.env.local` count on both sides? | **Yes, one line each** — J7's rule that credentials count, applied symmetrically | Files 8 vs 8, glue 192 vs 146. Nothing moves |
| 4 | Does `package.json` count as a file touched on the Next.js side? | **Counted**, on J3's and J7's reasoning: `jose` exists only because this journey does | Files 9 → 8 and glue 147 → 146. Metric 1 becomes a loss for us at 9 against 8 rather than a tie |
| 5 | Is `package-lock.json` counted? | **No** — tool output nobody edits by hand, the same exclusion the metric applies to scaffolder output | Files 9 vs 10 and glue 147 → 157 on theirs; the gap narrows to 36 and metric 1 inverts. It would also be counting a file the rule already excludes |
| 6 | Is the `.gitignore` line counted on either side? | **No, on both.** Ours exists because the scaffold gitignores neither `.data/` (usetheokit/theokit#395); theirs because `.chats/` is the guide's own directory. Both are run artefacts, not journey work | Files 10 vs 10, glue 195 vs 149. Nothing moves |
| 7 | Neither side builds a client surface. Is that fair? | **Yes, and it is symmetric.** Every criterion here is asserted over a parsed response body; criterion 1 says so in as many words. Neither diff touches a component | Both sides grow a client. J2's re-measurement is the reference for what that costs — 26 lines against 27 — so it would add roughly equally to both and move nothing |
| 8 | Is the Next.js approval secret allowed to be tenant-derived, when the SDK's docs show a single value? | **Yes.** § Why the protocol comes before the measurement says the Next.js side is written to win and the reviewer's job is to make it shorter | With the documented single-secret form, **criterion 3 fails on the Next.js side** — A replays B's signed approval and the tool runs, measured. Criteria would read 5 of 5 against 4 of 5 in our favour. It would not move a metric, and it would be measuring a strawman we built |
| 9 | Does TheoKit's criterion 5 count as a pass with one position unexercisable? | **Yes, with the gap named in the table.** Five positions were checked and returned A's data; the sixth cannot carry data at all on this build | Grading it a failure gives 4 of 5 against 5 of 5 and would score a framework defect twice, since #400 is already recorded against the diff's shape in judgement 10 |
| 10 | The TheoKit routes carry their input in the query string rather than the body. Is that the implementation, or a workaround? | **A workaround, forced by usetheokit/theokit#400**: a `POST` with a JSON body to an application route never returns under `theokit start`. `.query(…)` where `.body(…)` belongs | Line count is identical (`.query` for `.body`), except `+1` for `z.enum(['true','false'])` where `z.boolean()` would do. The honest alternative was not a different diff but no run at all |
| 11 | Is the unauthenticated agent endpoint scored against the criteria? | **No.** It fails no criterion as written — the criteria name the application's own read paths, and those are isolated. It is reported in full in § The leak the criteria do not grade | Scoring it fails criteria 2 and 3 on our side and gives 3 of 5 against 5 of 5. That would be grading against a criterion this page did not write, which is the exact failure § Why the protocol comes before the measurement exists to stop. It is stated instead, and it is the most important sentence in this section |
| 12 | Thread ids are client-minted UUIDs on both sides. Is that a choice that flatters criterion 1? | **It is the shape both stacks already use** — J4's TheoKit implementation mints one and the AI SDK's store uses `generateId()`. A run with tenant-local names on both sides was done first and criterion 1's set intersection reports the **name collision as a leak**, because two tenants may name a thread the same thing | With tenant-local names, criterion 1 fails on both sides for a reason that is not a leak. The criterion's oracle measures id disjointness, and only globally unique ids give it |

### Where the comparison is not apples to apples

- **Reach.** Both stores are a local directory on one machine. Neither side provisioned a database, and
  neither implementation would survive a second instance: ours because the pending-approval map is a
  process-local `Map`, theirs because `.chats/` is a local filesystem. Symmetric, and stated rather
  than scored.
- **Two transcript roots on our side.** `mountAgent` persists under `<app>/.data/agent-sessions`
  (`packages/theo/src/server/agent/mount-agent.ts:272`), and `streamAgentTurnInProcess` takes no
  `baseDir` at all (`packages/agents/src/in-process-turn.ts:44`), so the application's own route
  persists under `transcriptRoot()` — `~/.theokit` — instead. Two supported ways to run the same agent
  in the same application write to two different roots, and a thread created one way is not listed the
  other. It costs no lines here, and it is a fact a reader should have.
- **What the framework contributed.** On the Next.js side every line of the isolation is the
  application's, and the framework's absence is uniform. On ours the framework contributed the session
  cipher, the transcript format and the `ctx` seam — and then took back more than that by serving an
  unauthenticated parallel path over the same data.
- **The `secure: true` cookie.** The Next.js guide's cookie is `secure`, so over plain HTTP a browser
  would not store it. The probes read `Set-Cookie` directly, so the measurement is unaffected; a real
  deployment is over TLS and a real dev loop is not.

### What is still unmeasured, and why

- **Metric 4 (time to first green run)** was not measured on either side. It needs at least three cold
  runs from `npx create-theokit` and from `create-next-app`, and this journey adds a migration clause
  that neither side triggered because neither store has a schema. Unmeasured is not "not worse", and
  § The verdict does not treat it as one.
- **The three-target criteria (6-8)** cannot be exercised in this repository, unchanged from every
  journey before it: `@theokit/tui` and `@theokit/ui` live outside it and the north-star app does not
  exist. Criterion 7's real question — whether one shared check decides the refusal on the in-process
  path as well as over HTTP — is untouched by a diff that only writes the HTTP half. On the published
  artifact the answer is already known to be no, because there is no shared check to share.
- **The criterion this page deliberately excluded** — a leak through a cache key or a log line — was
  not looked for, and this measurement neither narrows nor widens that gap.
- **Whether the leak in § The leak the criteria do not grade is reachable when the application uses
  the framework's own agent endpoint** rather than its own route was not measured; the application
  under test does not use it. What was measured is that the endpoint answers anyone, on the same
  build, for any id it is given.

### The verdict

**J8 is lost.** It is the third journey the framework outright loses, after J2 and J10, and the first
one where both sides satisfy every gradeable criterion and the framework still loses on cost.

- **Files touched: 9 against 9 — level.** A tie.
- **Glue lines: Next.js, 147 against 193 — a 46-line absolute gap.** This page fixed in advance that
  glue is scored as an absolute count here, because business logic is the empty set and a ratio over
  zero is undefined. Forty-six lines is not inside noise: it is three files ours has and theirs does
  not, and a tighter re-implementation of our side could recover perhaps ten or fifteen of them by
  collapsing two helpers into `Response.json` one-liners. It could not recover the other thirty.
- **Concepts required: Next.js, 11 against 13 — 1.18x.** A tie by the bar, with Next.js the better
  side.
- **Criteria satisfied: 5 of 5 each**, exercised rather than inferred, with our criterion 5 checked on
  five of its six positions.

The claim under test is that building this costs less in TheoKit. On this journey it costs more, on
the one metric this page decided in advance would carry the result, and the reason is the one § The
Next.js side wrote before any code existed: *"this is the journey where a TheoKit win cannot come from
ergonomics, because there is nothing on our side to be ergonomic with yet. It comes from a primitive
that does not exist, or it does not come."* It did not come. The primitive still does not exist, and
what does exist — ADR 0001's subject and owner check — is not in anything published and answers a
different question when it ships.

**And the verdict understates the result.** A journey is lost when it costs more to build the thing
the criteria describe. Here the criteria are satisfied and the property they were written to protect
is not: the same published build that serves the isolated application also returns one tenant's
conversation to an unauthenticated caller, with a `200` and no log line. The three metrics price an
application's isolation on a server that does not have any.

### Issues and the advisory from this measurement

- **The cross-tenant read went to a security advisory**, not to a public issue. The source-level
  version of the same mechanism is already public as usetheokit/theokit#365, opened by the
  maintainers and explicitly not exercised; the end-to-end reproduction, the marker that crossed, and
  the reconfirmation of the HITL half on `theokit@0.48.14` from npm are recorded privately.
- **usetheokit/theokit#400** — reproduced a third time, and the first time it blocked a measurement:
  every `POST` with a JSON body to an application route hangs forever under `theokit start`. It forced
  every payload in the TheoKit diff into the query string and left one of criterion 5's six positions
  unexercisable. Commented on the issue with the transcript.
- **usetheokit/theokit#345** — reproduced on the published artifact: a middleware written with the
  public `middleware()` builder typechecks, builds, and then answers **500 on every request** with
  `next is not a function`, because the builder's contract is `(request: Request, next) => Response`
  (`packages/theo/src/server/define/define-middleware.ts:1`) and the runner calls it as
  `(req: IncomingMessage, res: ServerResponse, next: () => void)`
  (`packages/theo/src/server/http/middleware-runner.ts:35`). Found because middleware is the natural
  place to resolve a caller's identity; the working seam turned out to be `server/context.ts`
  (`packages/theo/src/server/http/middleware-runner.ts:117`). Commented on the issue.
- **usetheokit/theokit#402** — reconfirmed in passing: `theokit start` ignores `PORT`, so the port had
  to be moved into `theo.config.ts`.
- **usetheokit/theokit#395** — reconfirmed in passing: agent transcripts land in `git` because the
  scaffold's `.gitignore` covers neither `.data/` nor the SDK's transcript root.


## Metric 4 — measured 2026-08-21

Three runs per lane, alternating lane by lane, on the two applications this journey was measured on:

| | Next.js | TheoKit |
| --- | --- | --- |
| install | 4.67 ± 0.61 | 5.40 ± 1.13 |
| build | 10.23 ± 1.48 | **5.00 ± 0.00** |
| start | 0.60 ± 0.00 | 1.10 ± 0.00 |
| **total, mean ± 1σ** | **15.47 ± 0.92** → [14.54, 16.39] | **11.43 ± 1.07** → [10.36, 12.50] |

**The intervals do not overlap and TheoKit is the faster side, so the "not worse" clause holds.**
Install is level within noise on the pair where the Next.js side installs `jose` to sign its sessions
and the TheoKit side installs nothing extra.

This is the heaviest pair in the sweep by hand-written code — 9 files against 9, 193 glue lines
against 147 — and the build times do not track that at all: 5.00 s against 10.23 s. Worth recording,
because it is the one place a reader might expect the two to correlate and they do not. Warm npm
cache, never cold; both lanes install from a lockfile, the TheoKit lane's generated on 2026-08-21
because it carried a `pnpm-lock.yaml` npm ignores. In
[the evidence file](../evidence/j08-metric4-2026-08-21.txt).

**The verdict does not move and metric 4 could not have moved it.** J8 is an outright loss: glue at
an absolute gap of 46 lines against us, concepts 13 against 11, files level. § What counts as winning
asks for better on all three before time-to-green is reached. And the property the criteria protect
is still not protected — the same published build returns one tenant's conversation to an
unauthenticated caller.

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey whose artifact this isolates — threads: `j04-thread.md`
- The journey whose artifact this isolates — approvals: `j02-hitl.md`
- The seam both journeys sit on, now decided and half-implemented: `../three-target-parity.md` § The authorization seam
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
- The family the cross-tenant read belongs to: `../../adr/0002-an-abnormal-ending-is-never-reported-as-normal.md`
- The defect this measurement reproduced a third time, and the first time it blocked one:
  usetheokit/theokit#400
- The public, source-level version of the leak this measurement exercised: usetheokit/theokit#365 —
  the end-to-end reproduction went to a security advisory, not to that issue
