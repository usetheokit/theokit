# ADR 0010 — The conversation id is supplied by the application, not owned by the framework

- **Status:** accepted, retrospectively
- **Date:** 2026-09-20
- **Decision taken:** 2026-08-21 (`a896e4a3c`), in code, without this record
- **Context:** B-015, usetheokit/theokit#364

## Why this ADR is late, and why it is written anyway

B-015's first Definition-of-done bullet asks that the form *"be decided and recorded as an ADR
**before** any client change lands, because the two candidate answers have different blast radii."*
The change landed on 2026-08-21. This record is written on 2026-09-20.

**That bullet cannot now be satisfied and this document does not claim to satisfy it.** What it does
is stop the decision from being one nobody wrote down — the state the bullet existed to prevent,
arriving by the door it was watching. Recording it late is worth more than leaving the reasoning in
a docblock, and less than having recorded it first; both halves of that are true and neither is
worth hiding.

## The decision

`AgentClientOptions` carries an optional `chatId`, and `AgentClient` exposes a getter for it.

```ts
readonly chatId?: string                                   // agent-client.ts:212
this.#chatId = options?.chatId ?? crypto.randomUUID()      // agent-client.ts:273
get chatId(): string { return this.#chatId }               // agent-client.ts:282
```

Both halves ship together, and the docblock at `:208` argues why: *"reading without supplying lets
an application store an id it can never restore, and supplying without reading leaves it nothing to
store."*

**Where the id lives is the application's.** The framework accepts it, returns it, and sends it as
the top-level `id` of the POST body (`http-transport.ts:147`). It does not put it in a URL, a
cookie, or storage.

## The alternative that was rejected

**A framework-owned URL convention** — the id as a route segment or query parameter the framework
reads and writes itself.

It was rejected, and the reason it was rejected is the reason B-015 asked for this record in the
first place: the two answers have different blast radii. A URL convention decides, for every
application, that a conversation is addressable and shareable and appears in browser history. That
is a product decision wearing a transport decision's clothes, and a framework that takes it removes
an application's ability to decide otherwise — a chat inside a modal, a conversation that must not
be linkable, an app whose routing is not URL-shaped at all.

The option taken is the reversible one. An application that wants URL addressing builds it on top in
a few lines; an application that does not want it cannot remove a convention the framework owns.

## What it costs, measured rather than asserted

The cost is real and B-015 named it: *"an id accepted in `AgentClientOptions` leaves every
application to invent where it lives."* Every application writes that glue, and every one writes it
slightly differently.

`docs/program/journeys/j04-thread.md:220` measured it against a peer on the same journey:
**4 files and 59 glue lines here, against 5 files and 74 lines** on the comparison. So the glue is
real, it is smaller than the alternative's, and all five of the journey's web criteria pass on both
sides.

## Consequences

- An application that never supplies a `chatId` keeps today's behaviour exactly: a fresh id per
  `new AgentClient(...)`. The option is additive and nothing had to change to keep working.
- The 59 glue lines are the standing cost, paid per application. If a future measurement shows
  applications converging on one shape, that shape is a candidate for a helper — **not** for a
  framework-owned convention, which is the thing rejected here.
- `docs/program/journeys/j04-thread.md` § the 2026-08-21 correction is now stale on this point: it
  states *"what changed is not the framework — `readonly #chatId = crypto.randomUUID()` is still a
  field initializer and `AgentClientOptions` still carries only an emitter"*. True when written,
  false since `a896e4a3c`. A dated note is added there rather than an edit.
