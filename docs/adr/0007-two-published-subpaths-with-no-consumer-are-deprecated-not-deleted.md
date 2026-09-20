# 0007 — Two published subpaths with no consumer are deprecated, not deleted

- **Status:** accepted
- **Date:** 2026-09-19
- **Decides:** B-012's third DoD bullet, which asks for a recorded decision on whether the
  `server-inserted-html` capability is wanted.

## Context

`@theokit/http` exports eight subpaths. Two of them have **zero consumers anywhere**:

| Subpath | Symbol | Importers in `packages/*/src` + `apps/*/src` |
|---|---|---|
| `./server-inserted-html` | `createServerInsertedHTML` (`src/server-inserted-html.ts:38`) | 0 |
| `./css-resource` | `renderCssResource` (`src/css-resource.ts:63`) | 0 |

Measured 2026-09-19, and the negative is controlled rather than assumed: the identical query
over `renderToStream` returns 6 production sites, and `@theokit/http/app` returns 50 — so the
zero is a statement about these two symbols, not about the query. The project's own
`docs/program/capability-matrix.md:106-107` already records both as "no SSR path consumes it"
and "test-only".

The parsimony ladder's first rung asks whether a thing needs to exist, and for unreferenced
internal code the answer here would be no. **These are not internal.** `@theokit/http` is
published — `npm view @theokit/http version` returns `2.1.0` — so the set of importers is not
the set I can enumerate.

`renderCssResource` emits `precedence="…"`, which is React 19's native stylesheet-hoisting
attribute. Under React 19 the helper is redundant. But `packages/http/package.json:63` declares
the peer range as `react >=18.0.0`, and React 18 has no such hoisting — so the helper is
redundant for *some* of the range this package promises to support, not for all of it. That
distinction is the reason this ADR does not simply delete it.

## Decision

**Both subpaths are marked deprecated and both keep working.** Neither is removed in the 2.x
line. Removal, if it happens, is a 3.0 change with the deprecation already published ahead of
it.

Each deprecation states the condition under which the thing is still the right tool:

- `./css-resource` — redundant under React 19, which hoists `<link precedence>` natively.
  Retained for the React 18 half of the declared peer range.
- `./server-inserted-html` — a flush-once keyed HTML buffer for SSR. No path in this repository
  inserts server HTML that way today; that is a statement about this repository, not about
  every consumer of a published package.

## What would break, and what would not

**Nothing breaks.** A deprecation notice is additive: the exports stay in `package.json`, stay
in `tsup.config.ts:12-14`, and keep their tests. Existing imports keep resolving and keep
behaving identically.

What changes is what a reader learns: today the capability matrix records the orphan status in
a document consumers do not receive, while the package itself says nothing.

## Who is affected

- **Consumers of `@theokit/http@2.x` importing either subpath** — unknown and unenumerable,
  which is the whole reason for choosing deprecation. Found by asking npm, not by recalling.
- **This monorepo** — no one. Zero internal importers, measured above.
- **`packages/http`'s own tests** — `tests/unit/server-inserted-html.test.ts` and
  `tests/unit/css-resource.test.ts` keep passing; a deprecation is not a behaviour change.

## What was rejected

**Delete both now.** It is what the parsimony ladder's first rung suggests and what the
zero-consumer measurement invites. Rejected because the measurement covers the repository and
the package is published: "no importer I can see" and "no importer" are different claims, and
only the first is supported. Deleting on the first would break consumers I cannot name, which
is the failure a published surface exists to prevent.

**Delete `css-resource` only, since React 19 supersedes it.** Rejected because the package
declares `react >=18.0.0`. Removing it would silently narrow the supported range without
saying so in the peer declaration — a break disguised as a cleanup.

**Leave both undocumented and decide later.** Rejected because that is the state B-012 was
filed against. An orphan nobody has decided about is re-measured by the next person at full
cost; this ADR is cheaper than that measurement was.

## What this ADR does NOT settle

Whether `server-inserted-html` is a capability the framework should GROW a consumer for, rather
than eventually drop. Nothing measured here answers that — it is a product question, and
`cycle-brainstorm` is where it belongs. Deprecation is reversible: a capability that finds a
consumer un-deprecates.
