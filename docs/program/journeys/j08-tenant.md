# J8 — Tenant

The eighth of the ten benchmark journeys (`../dx-benchmark.md`). Criteria written before either
implementation exists; a journey whose criteria change after code exists is void and must be re-run
from scratch.

**Scheduling status:** hold. The blocker is named in § Current state and blockers, and it is not the
one the sequencing section left blank.

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

## Cross-references

- The benchmark this journey belongs to: `../dx-benchmark.md`
- The journey whose artifact this isolates — threads: `j04-thread.md`
- The journey whose artifact this isolates — approvals: `j02-hitl.md`
- The seam both journeys sit on, now decided and half-implemented: `../three-target-parity.md` § The authorization seam
- Acceptance contract that grades these criteria: `../../../.claude/rules/cycle-acceptance.md`
- Criterion shape these follow: `../../../ROADMAP.md` § Wave 1
