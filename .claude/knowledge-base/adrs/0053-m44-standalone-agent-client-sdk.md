# ADR 0053 — M44: standalone typed agent client-SDK (no React) over the same store

**Status:** Accepted (2026-07-12) — design GATE for M44 (accepted BEFORE code). The LAST step of the DX track.
**Extends:** ADR-0050 (M41 `AgentClient` store + seam), ADR-0052 (M43 context), ADR-0040 (runtime-vs-home).

## Context

`useAgent` is a thin React binding over the framework-agnostic `AgentClient` store (ADR-0050 D6). Node
scripts, CLIs, tests, and non-React UIs cannot use a React hook — but they CAN use the store directly.
The store already exposes `subscribe`/`getSnapshot`/`send`/`abort`/`reset`/`approve`/`reconnect`; the
only gaps are (1) a plain, documented public handle for non-React consumers, and (2) an ergonomic
`stream(input): AsyncIterable<UIMessage>` for the common scripting shape, and (3) a React-FREE entry so
a node consumer never pulls React into its bundle.

## Decision

**D1 — `createAgentClient(transport, options?)` is a thin wrapper over the EXISTING `AgentClient` store
(no new store, no duplicated logic).** It returns an `AgentClientHandle` delegating to the store
(`send`/`abort`/`reset`/`approve`/`reconnect`/`subscribe`, `getState` = the store's `getSnapshot`) plus a
`stream(input): AsyncIterable<UIMessage>`. G12 — one store; the ADR bans a parallel implementation.

**D2 — `stream(input)` yields progressive assistant snapshots.** It subscribes, sends, and yields the
latest assistant `UIMessage` on each streaming update; iteration ends when the turn settles; a failed
turn rejects the iterator with the run error. A `for await` script takes the last yielded value as the
final result. Backpressure: a queue + a notify-promise bridges the push store to the pull iterator; the
subscription is torn down in `finally`.

**D3 — A React-FREE entry: `theokit/client/core`.** A new barrel `src/client/core.ts` re-exports the
store + the three transports + `createAgentClient` + types — but NOT `useAgent` (the only React
importer). A node consumer imports `theokit/client/core` and pulls no React. `theokit/client` (the React
entry) is a superset that adds `useAgent` and also re-exports `createAgentClient` for convenience. A new
tsup entry (`client/core`) + a `./client/core` package export ship it.

**D4 — Works over ANY transport.** `createAgentClient` takes an `AgentTransport`, so a node script hits
an HTTP agent (`HttpTransport` over node fetch) and a test drives an in-process agent
(`InProcessTransport`) with the SAME API. M43 context is supported via `options.context`.

**D5 — Runtime UNCHANGED (G2).** M44 adds a client entry + a wrapper over the existing store. No
`server/` change, no `@theokit/sdk` change, no new dependency.

## Consequences

- An agent is consumable from any JS runtime on the same seam — the "write once, consume anywhere"
  promise the DX track set out to deliver. Completes M41–M44.
- No new store, no duplicated logic, no React in the node consumer's bundle, no runtime change.

## Alternatives rejected

- **A parallel store for the standalone client** — duplicates the M41 store logic (G12 breach). Rejected;
  `createAgentClient` wraps the existing `AgentClient`.
- **Ship `createAgentClient` only from `theokit/client`** (the React entry) — a node consumer would pull
  React transitively. Rejected; the React-free `theokit/client/core` entry is the point (D3).
- **A callback-only API (no `AsyncIterable`)** — `for await` is the idiomatic scripting shape for a
  stream; `subscribe`/`getState` remain for event-driven consumers. Both are provided.
